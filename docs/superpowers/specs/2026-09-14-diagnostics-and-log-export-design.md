# Diagnostics: a log that survives the launch it is describing

Date: 2026-09-14

The app sometimes opens to a blank screen on a phone, most often on the first
launch after install. It has been diagnosed twice by reasoning from
screenshots, and fixed twice — `main.tsx` no longer gates the mount on
`migrateLegacyRoot()`, and `fix/blank-screen-on-failed-open` adds a render-error
boundary and stops entering views holding an invisible first frame. It still
happens.

The reason it keeps costing whole sessions is that the app records nothing a
user can hand over. `src/lib/devLog.ts` exists and is good, but every one of its
entry points opens with `if (!import.meta.env.DEV) return;` — `log()`,
`snapshotReader()` and `logSessionStart()` alike. A release APK on a real phone
writes no diagnostics at all. So each report arrives as a sentence ("it was
blank"), and the only way to learn anything is to reproduce it locally on an
emulator that does not reliably reproduce it.

This design makes the app record its own launches, keep the record across
restarts, and hand it over as a single file.

## The constraint that shapes everything

`devLog` writes through `@tauri-apps/plugin-fs` — `mkdir` and `writeTextFile`,
both of which cross the Tauri IPC bridge.

That bridge is the prime suspect. The comment `main.tsx` carries about the bug
it already fixed says so directly: `migrateLegacyRoot()`'s first act is
`exists()` over IPC, "and on Android that bridge can stall at cold start",
observed "blank past 70s having made three IPC calls and created no app-data
directory at all".

A log written over IPC therefore cannot record an IPC stall. If the bridge
hangs, `mkdir` never resolves, `ensureDir()` never returns, and `flush()` writes
nothing — the log is silent about precisely the failure it was built to explain.
Any design that records the boot through the Tauri fs plugin is unable in
principle to catch this bug.

So the earliest record must not touch IPC, and it must outlive the process that
wrote it.

## Two tracks

### Track A — boot breadcrumbs

Four marks, each one synchronous `localStorage.setItem`. No IPC, no promises,
no await. `localStorage` is in-webview and persists across launches, which is
exactly the pair of properties needed.

| Mark | Written from | Proves |
|---|---|---|
| `html` | the inline script already in `index.html` | webview alive, theme/dir applied |
| `module` | top of `src/main.tsx` | the JS bundle parsed and executed |
| `render` | immediately after `createRoot().render()` | React was handed the tree |
| `mounted` | a mount effect in `App` (`src/App.tsx:145`) | a frame actually reached the screen |

Each mark stores a monotonic timestamp alongside the name. The sequence is
strictly increasing, so the last mark present is how far the launch got.

The read happens on the *next* launch. Before the current session overwrites
them, the recorder lifts the previous session's marks and classifies them:

- all four present → normal launch, recorded with its timings
- `html` present, `mounted` absent → **blank launch**, recorded with the last
  mark reached and how long the session lasted before it died

That classification is the whole point. It converts "it was blank sometimes"
into "the previous launch reached `module` at 340ms and never reached `render`",
which names the failing stage without a reproduction.

`index.html` is the right home for the first mark because its inline script
already runs synchronously before the bundle — it is documented there as
deliberately dependency-free, and one `setItem` keeps it that way.

### Track B — the session log

Everything after the bridge proves alive, written to
`$APPDATA/diagnostics/session-<n>.jsonl`, one JSON event per line.

This is `devLog`'s existing machinery, kept: a ring buffer in memory, a
debounced flush, a cap so a long session cannot fill the disk. Three changes:

- the `import.meta.env.DEV` gate is replaced by a **tier** check, so release
  builds record the cheap tier
- files are per-session and rotated — the last 3 are retained, rather than
  today's single file truncated on every start (`truncateForSession()`), because
  the session that matters is usually the one *before* the one you are in
- the flush interval moves from 700ms to 2s, since nothing in the cheap tier is
  scroll-adjacent

## Tiers

Always-on must be cheap enough to leave running on every phone forever.

**Cheap tier (always on).** Boot marks, route changes, errors, IPC failures,
coarse timings (import, download, chapter open). Plain objects, no DOM reads.

**Verbose tier (Settings toggle, default off).** Adds `snapshotReader()` — the
`getComputedStyle` walk up 14 ancestors, the hit test, the per-paragraph rects.
That function is genuinely expensive and exists for a specific class of bug, so
it stays behind a switch the user flips when asked to.

This is why `devLog.ts`, `ReaderDiagnostics.tsx` and `ReaderLogMarker.tsx` are
kept and re-pointed rather than deleted. They already do the hard part well;
what they lack is a way to run outside a dev build and a way to get the file
off the device.

## Redaction

The export is meant to be pasted into a chat or attached to an issue, and a raw
log carries the user's library: Arabic novel titles, local file paths with the
account name in them, and source URLs identifying the sites they read from.

Redaction is applied **at write time**, not at export time, so the file on disk
is already safe and there is no unredacted copy to leak:

- book and chapter titles → a stable short hash, so the same book is
  recognisable across events without being named
- file paths → basename only
- source URLs → host only

Stability matters more than reversibility. `book:a3f1` appearing in twelve
events is enough to follow one book through a session.

## Export

A new **Diagnostics** section in Settings, following the page's existing
`ActionRow` + `Field` composition (`src/components/SettingsPage.tsx`):

- **Detailed diagnostics** — the verbose-tier switch
- **Recent sessions** — the retained sessions, each with its launch
  classification; a blank launch is badged so it is findable without reading
  the file
- **Export** — mirrors `exportSettings` (`SettingsPage.tsx:103`) exactly: the
  `save()` dialog from `@tauri-apps/plugin-dialog`, then `writeTextFile`. One
  `riwaq-diagnostics-<date>.txt` containing a device/app header, the boot
  timeline for every retained session, and the session events
- **Copy to clipboard** — the existing `copyText()` (`src/lib/clipboard.ts`),
  which already carries the `execCommand` fallback for the Android WebView's
  non-secure context. This is the fast path for handing a log to a chat

Mirroring `exportSettings` is deliberate. Tauri's `save()` maps to the Storage
Access Framework on Android, so one code path covers the share-to-file case on
both platforms and no native Kotlin intent is needed. The repo does have a JNI
bridge (`MainActivity.kt`, `DownloadNotifier.kt`) if a true share sheet is ever
wanted, but adding one now would be work in service of no additional outcome.

## Error capture

Three sources feed error events into the cheap tier:

- `window.onerror`
- `unhandledrejection`
- `ReaderErrorBoundary` (`src/components/ReaderErrorBoundary.tsx`), which
  already catches render failures and is already wired at two call sites in
  `App.tsx`

## Modules

New, under `src/lib/diagnostics/`:

| Module | Responsibility |
|---|---|
| `breadcrumbs.ts` | write a mark; read and classify the previous launch |
| `recorder.ts` | ring buffer, tiers, debounced flush |
| `sessions.ts` | session file naming, rotation, retention |
| `redact.ts` | title hashing, path and URL narrowing |
| `bundle.ts` | assemble the export text from header + breadcrumbs + sessions |

Each is a pure module with one job and no React. `bundle.ts` takes data and
returns a string; it does not know about dialogs. `breadcrumbs.ts` takes a
storage object, so the classifier is testable without a browser.

Modified: `index.html`, `src/main.tsx`, `src/App.tsx`,
`src/components/SettingsPage.tsx`, `src/i18n/ar.ts`, `src/i18n/en.ts`,
`src/lib/devLog.ts`.

## Testing

Every piece above is a pure function reachable from vitest, which is how the
repo already covers `bootGate`, `redact`-shaped logic and the store.

- **breadcrumbs** — the classifier over each truncation of the sequence:
  `html` only, `html+module`, `html+module+render`, all four. The three partial
  cases must classify as blank launches naming the right last mark.
- **the IPC-stall case** — the test that matters most, written in the style of
  `src/bootGate.test.ts`: with every `@tauri-apps/plugin-fs` call mocked to a
  promise that never settles, the breadcrumbs must still be readable. This is
  the regression guard for the constraint the whole design is built around.
- **recorder** — ring-buffer eviction at the cap; verbose events dropped while
  the tier is off.
- **redact** — same title hashes to the same token twice; paths reduce to
  basenames; URLs reduce to hosts; no raw title survives a round trip.
- **sessions** — rotation keeps exactly 3 and deletes the oldest.
- **bundle** — a known set of sessions renders a stable, readable document.

## What this does not do

No network, no auto-upload, no crash reporting service. The user exports a file
and sends it however they like. Auto-upload was considered and dropped: it needs
consent handling and somewhere to receive reports, and it does not make the
blank launch any more diagnosable than Track A already does.

## Why this is sequenced first

The blank screen is the motivating bug, but it cannot honestly be fixed next.
Two fixes have already shipped against it and it persists, which means the
remaining cause is not the one that reasoning from a screenshot suggests. Track
A turns the next occurrence into a timestamped statement about which boot stage
failed. Building it first replaces a third guess with a measurement.
