# Import: one loader, and half the work

Date: 2026-09-04

Two complaints, one flow. While a book is importing, the app shows two
progress indicators at the bottom of the screen, and a large book makes the
whole app sluggish. This design removes one indicator and removes a whole pass
over the book's bytes.

## The measurement that shaped this

The file that prompted the work is a 206 MB illustrated EPUB
(`لعبة العروش - الطبعة المصورة.epub`): 224 zip entries, of which 114 are HTML
chapters totalling well under a megabyte, and 96 are images totalling ~206 MB.
The book *is* its images.

What the import does with it today:

| Phase | Work | Cost for this book |
|---|---|---|
| copy | Rust streams the picked file into app-data, hashing as it goes | 206 MB read + 206 MB written |
| parse | 114 × `DOMParser` in one unbroken main-thread run | UI frozen for the duration; ring parked at "parse" |
| write | `zip_extract` copies every image out of the archive onto disk | ~206 MB written again |
| after | `books/<id>/` holds `book.epub` *and* every image | ~412 MB on disk for a 206 MB book |

So the slowness is not the Android IPC bridge — `nativeStaging.ts` already
keeps book bytes out of the webview. It is (a) a second full pass over the
whole book at import time, and (b) a main-thread parse loop that never yields.

PDFs have a separate defect with the same symptom. `stagePaths` does
`readFile(stagedPath)` to hand pdf.js the bytes, and `openPdfDocument` then
does `bytes.slice()` because pdf.js may detach the buffer. A 200 MB PDF
therefore costs ~400 MB of JS heap during staging. `createPdfPageSource` does
the same whole-file read every time a PDF book is *opened*. On Android that is
enough memory pressure to make the entire app crawl.

## Part 1 — one loader

### Current state

Two indicators can be on screen at once:

1. `ImportProgress`'s `Dock` — a 64 px circular progress chip, `position: fixed`,
   `insetInlineEnd: 24`, which under the app's RTL locale renders at the
   bottom **left**. This is the orange arc in the report.
2. `NavFabButton`'s ring — the centre button of the mobile bottom bar, driven
   by `Library`'s local `importing` / `importPct` state.

`createImportReporter` calls `startImport(...)` immediately followed by
`setMinimized(true)`, so every device import starts minimized: the dock is
always what the user sees, and the modal only appears if they tap it.

### Change

- Delete `Dock`, `DockSpinner`, `DockCheck`, `DockBang` and the
  `import-dock-in` keyframe from `ImportProgress.tsx`. When the store is
  `minimized`, `ImportProgress` renders nothing.
- Delete the three now-unused i18n keys (`import.progress.dockAriaLabel`,
  `dockFailedHint`, `dockImportingHint`) from `i18n/en.ts` and `i18n/ar.ts`.
- `NavFabButton` becomes the single indicator. It reads the shared
  `importProgress` store (via `useImportProgress`) in addition to the
  `importing` / `importPct` props it takes today, so a **source/Store import
  also lights it up** — today those imports have no FAB indicator at all and
  relied entirely on the dock.
- The FAB stays enabled while an import is active. Tapping it calls
  `setMinimized(false)`, which opens the detailed stepper modal. That
  preserves the dock's only real job: a route back to the step list and to
  error text.

### Indicator coverage after the change

| Surface | Indicator |
|---|---|
| Library / Store / Shelves (mobile) | FAB ring, tap to open the modal |
| Library (desktop sidebar, empty-state CTA) | existing button spinners, unchanged |
| Inside the reader | none on screen; the import keeps running, and on Android the foreground-service notification shows progress |
| App backgrounded (Android) | notification, unchanged |

Losing the in-reader indicator is deliberate: it is the price of not having a
floating chip, and the notification already covers the case that matters
(leaving the app while a long import runs).

Error visibility does not regress. `runImport`'s catch already calls
`setError(errorLabel(...))`, which renders in the library's own error surface,
and the modal — reachable from the FAB — still holds the failed step and
message until dismissed.

## Part 2 — performance

Four changes, in descending order of measured value. They are independent;
each can ship on its own.

### 2a. Stop extracting images at import time

`commitEpubAt` currently calls `src.extract(...)` for every image the parser
collected. For the 206 MB book that is the entire book, written a second time.

Instead:

- At import, write `books/<id>/images.json` — a manifest mapping each stored
  href (`images/img-007.png`) to its zip entry name. `EpubImageRef` already
  carries exactly `{ href, entry, mimeType }`, so this is the parser's output
  serialized as-is.
- Extract nothing but the cover (small, needed by the library grid
  immediately).
- At read time, extract a chapter's images on first view.
  `BookBody`'s `useChapterImageUrls` already resolves image srcs
  asynchronously per chapter and already tolerates a brief flash on first
  render; the new step slots in ahead of `chapterImageSrcFor`.

New store function, `ensureEpubImages(bookId, srcs)`:

1. No `images.json` → return immediately. This is what every already-imported
   book hits, and their images are on disk from the eager pass, so they keep
   working untouched.
2. Look up each src in the manifest; skip any whose file already exists.
3. If anything is missing, one `zip_extract` call against
   `books/<id>/book.epub` for just those entries.

Keeping `book.epub` forever is existing behaviour ("lets us re-extract the
cover later"), so the archive is always there to extract from. `DocxPageSource`
and the streaming reader are unaffected — they never had a manifest and take
branch 1.

Effect for the 206 MB book: import writes ~206 MB instead of ~412 MB, the
"write" phase all but disappears, and steady-state disk use halves. Reading a
chapter costs one extraction of that chapter's images (single-digit MB).

### 2b. Yield during the EPUB parse

`parseEpubFromSource`'s spine loop awaits only already-cached text, so every
`await` resolves in a microtask and the whole 114-chapter loop runs inside one
task. The main thread cannot paint, cannot handle input, and cannot even
render the progress the reporter is being handed.

- Add `src/lib/yieldToUI.ts`: `scheduler.yield()` when the webview has it,
  otherwise a `MessageChannel` round trip (a real task, unlike
  `Promise.resolve()`), with `setTimeout(0)` as the last resort.
- In the spine loop, yield when more than ~8 ms has elapsed since the last
  yield — time-based, not every-N-chapters, so a book of tiny chapters does
  not pay for thousands of pointless yields.
- Give `parseEpubFromSource` an optional `onChapter(done, total)` callback.
  `commitEpubAt` forwards it to the reporter so the ring moves through the
  parse instead of sitting still.

`ImportReporter.progress` takes a `StageProgress` whose phase is
`"copy" | "extract"`, and `createImportReporter` maps `extract → write` and
everything else → `copy`. Rather than overload that, `ImportReporter` gains
one method, `parseProgress(ratio: number)`, which pushes
`fileFraction("parse", ratio)`. `fileFraction` — already unit-tested for
monotonicity — is unchanged, and reporters that ignore the new method (the
`ImportReporter` literal in `Library.tsx` forwards it like the others) keep
working.

### 2c. Stream PDFs instead of loading them

- New Rust command `read_file_range(path, offset, length) -> Response` in
  `archive.rs`, returning raw bytes via `tauri::ipc::Response` (Rust→JS
  responses are an octet-stream, so there is no JSON-array expansion), with
  the same `resolve()` path guard every other command uses and a cap on
  `length` per call.
- New `src/pdf/rangeSource.ts`: a `PDFDataRangeTransport` subclass whose
  `requestDataRange(begin, end)` invokes that command and feeds
  `onDataRange`. Opened with `disableAutoFetch: true` so pdf.js pulls only
  what it needs.
- `openPdfDocument` takes `Uint8Array | { path: string; length: number }`.
  The bytes form stays for the dev harness and tests; the path form drops the
  `bytes.slice()` copy entirely.
- `stagePaths` stops calling `readFile` for PDFs and passes the staged path +
  size. `createPdfPageSource` does the same for opening a stored book.

Effect: peak JS heap for a 200 MB PDF goes from ~400 MB to the working set of
the pages actually rendered, at import *and* every time the book is opened.

### 2d. DOCX conversion in a Web Worker

Lowest value — a DOCX is rarely huge — and listed last for that reason. Move
`docxToFixedDoc`'s mammoth + JSZip stage into a module worker; the
`DOMParser` sanitize pass stays on the main thread behind `yieldToUI`. Ship
only if measurement shows DOCX staging blocking long enough to matter.

## Rejected: rewrite the EPUB parser in Rust

Native XML parsing would be the fastest possible import. It also means
reimplementing 684 lines of nav/NCX resolution, cover heuristics, chapter
instruction collection and image de-duplication — all of it currently covered
by `epub/parser.test.ts` — in a second language, with the two copies free to
diverge. Once 2a removes the byte pass and 2b removes the freeze, the
remaining JS parse is a second or two of non-blocking work. Not worth the
risk.

## Verification

Unit tests (`vitest`, 137 passing at baseline):

- `ensureEpubImages`: absent manifest, present-on-disk short-circuit, partial
  miss, corrupt manifest.
- `yieldToUI`: yields via each of the three mechanisms.
- Parse progress: `onChapter` fires once per spine item, ratio monotonic to 1.
- `importReporter`: existing monotonicity tests extended over the parse path.

Real-file measurement, on a **copy** of the app-data directory — never the
live library — with the 206 MB EPUB:

- wall-clock per phase (copy / parse / write) before and after;
- bytes written to `books/<id>/` before and after;
- total main-thread long-task time during the import, via CDP.

Success looks like: bytes written roughly halved, no long task over 50 ms
during the parse, and the progress ring advancing continuously instead of
stalling.

## Measured results

Against the real files, in a real browser (Chromium, M-series Mac) or by
arithmetic over the archive. A phone is several times slower, so treat every
millisecond figure as a floor.

| Change | Before | After | How measured |
|---|---|---|---|
| Import writes (206 MB EPUB) | 411 MB | 206 MB | `unzip -l`: 96 image entries = 204,679,462 bytes, no longer extracted |
| Disk held for that book | ~411 MB | 206 MB + images read | same |
| EPUB parse, longest block | 58 ms | 11.3 ms | real 114 chapters, timestamp at every yield point |
| DOCX worst frame gap (8.9 MB, 109 images) | 62.5 ms | 10.4 ms | rAF heartbeat during conversion; identical output both ways |
| PDF bytes pulled to stage (21 MB, 298 pp) | 21 MB read + 21 MB copy | 1.5 MB (7%) | production path with `__TAURI_INTERNALS__` serving real ranges |
| Library re-renders per import | ~50 (whole tree) | 0 | `importPct` state removed; the FAB subscribes to the store itself |

`read_file_range` has its own Rust test for exact offsets, short reads at EOF,
and a missing file (`archive.rs: reads_an_exact_byte_range`).

### Not yet verified

The end-to-end run inside Tauri — importing the 206 MB file through the real
app and confirming `images.json` lands, no `images/` directory is created at
import, a chapter's images extract on first view, and exactly one indicator
appears. Everything the app-level run would exercise is covered by a unit or
browser test individually, but the wiring between them is not. Worth doing
before this ships.
