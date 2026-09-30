# DOCX/PDF import: filename titles, reading modes, background import

**Date:** 2026-10-01
**Status:** Approved design, pending implementation plan
**Branch:** `feat/import-modes`

## Context

Three improvements to how PDF and DOCX files enter the library, agreed in
brainstorming on 2026-10-01:

1. The import dialog should prefill the title from the **file's name**, not
   from the document's embedded metadata.
2. A DOCX should be readable **either** as fixed pages (as written) **or** as
   reflowing text, switchable at any time, with reading position preserved
   across the switch.
3. Import should run **in the background** and survive the app being killed.

### What already exists

This is not greenfield. The relevant machinery is largely in place:

| Concern | Where | State |
| --- | --- | --- |
| Filename sanitization | `src/store/importName.ts` | Complete. Handles SAF URIs, Windows paths, extension stripping, `_`/`-` collapsing, and rejects bare provider row ids. |
| Fixed DOCX rendering | `src/reader/fixed/DocxPageSource.ts` | Complete. Already stamps `data-block-id="b{N}"` per top-level block and exposes `pageForBlock()`. |
| Chapter splitting | `src/docx/splitChapters.ts` | Complete. `splitHtmlIntoChapters()` walks `body.children` in order. |
| Progress store | `src/store/importProgress.ts` | Complete, including a `minimized` ("continue in background") flag. |
| Android keep-alive | `src/store/backgroundTasks.ts` | Complete. Runs the foreground service while `isImportActive()`. |
| Import indicator | `src/store/importIndicator.ts` | Complete. Drives the FAB ring. |
| Segmented control | `src/components/SettingsSection.tsx` (`SegRow`) | Complete. 44px targets, 8px gaps, selection marked by border + weight, `aria-pressed`, reduced-motion aware. |
| Skeletons | `src/components/Skeleton.tsx` | Complete. |

A previous branch (`feat/import-title-from-filename`, merged) built the
filename-title *infrastructure* but left document metadata winning the
precedence. Only the precedence changes here.

### What does not exist

- Any notion of a reading **mode** for a DOCX.
- Any **durability** for an in-flight import. The draft holds parsed HTML and
  images in memory, the run lives inside one `runImport()` call in
  `Library.tsx`, and a kill leaves an orphan in `riwaq/staging/` forever.

## Goals

- Filename is the default title for PDF and DOCX.
- A DOCX can be read as fixed pages or reflowing text, switched freely, with
  the same paragraph and scroll fraction on both sides of the switch.
- Chapters in reflow mode come from the DOCX's own heading structure.
- Import runs unattended and recovers from process death without leaking disk.

## Non-goals

- **PDF reflow.** Decided out of scope. pdf.js text extraction yields
  positioned glyph runs with no paragraph or heading structure; multi-column
  documents interleave, and Arabic shaping/RTL reconstruction is a project of
  its own. PDF remains fixed-page only.
- **Exact cross-mode highlight offsets.** See Decision 4.
- **More aggressive filename cleanup.** Decided against; see Decision 3.

## Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Reflow mode is **DOCX-only** | mammoth emits real semantic HTML; PDF extraction does not. |
| 2 | Mode is chosen **in the reader**, not at import | Zero added import friction (serves goal 3), user sees the document first, and it is reversible. |
| 3 | `filenameTitle()` is **unchanged** | Precedence only. The field is editable; aggressive stripping risks eating real titles, and `Vol. 2` is already a protected test case. |
| 4 | Cross-mode highlights are **block-accurate, offsets best-effort** | Flow mode stores text with inline HTML stripped; pages mode keeps markup, so character offsets cannot match for blocks containing bold/links/footnotes. The highlight lands on the correct paragraph either way. |
| 5 | Resume from the **staged copy** | Once copied into `riwaq/staging/`, the app owns the bytes outright — no Android SAF grant needed, so resume works after process death. A kill *during* the copy cannot be resumed honestly and is swept instead. |

## Architecture

### Approach: mode as a render setting, not a conversion

`books/<id>/content.html` is the single source of truth for a DOCX. Both
modes render **the same file**:

```
                  books/<id>/content.html  +  images/
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
      DocxPageSource                  flowDoc.ts
      (exists, unchanged)             (new)
              │                             │
      fixed page cards            EpubChapter[] ──▶ reflow reader
                                                    (unchanged)
```

The decisive fact: **`book.json` stores chapters inline**
(`src/epub/types.ts:51`, `chapters: EpubChapter[]`) and `loadBook()` simply
reads that JSON. The EPUB zip is parsed once at import and flattened; no zip
is touched at read time. So reflow mode needs no EPUB, no `buildEpub()`, no
second copy of any image.

Approaches rejected:

- **Build a real EPUB** via `buildEpub()` → `importEpubBytes()`. Zips content
  only to immediately flatten it back into `book.json`, duplicates every image
  on disk, makes switching a slow rebuild, and needs either a second library
  entry or a destructive in-place replace.
- **Dual-write both representations at import.** Doubles disk and doubles
  import work for a mode most books will never use. Directly contradicts
  goal 3.

## Section 1 — Title prefill

Precedence inverts. Nothing else changes.

| | Today | After |
| --- | --- | --- |
| PDF (`fixedImportStage.ts:150`) | `doc.meta.title \|\| fallback` | `fallback \|\| doc.meta.title` |
| PDF commit (`:168`) | `title.trim() \|\| doc.meta.title \|\| fallback` | `title.trim() \|\| fallback \|\| doc.meta.title` |
| DOCX (`:231`) | `fixed.title` | `fallback \|\| fixed.title` |
| DOCX commit (`:241`) | `title.trim() \|\| fixed.title` | `title.trim() \|\| fallback \|\| fixed.title` |

`stageDocx` hoists `const fallback = fallbackTitle || filenameTitle(filename)`
to mirror `stagePdf`, which already does this at `:109`.

**Why the empty-string convention makes this safe:** `filenameTitle()` returns
`""` (not `"Untitled"`) when it cannot recover a name — a bare SAF row id, a
filename that is only digits. So a document's own title still wins over
nothing, and the localized `common.untitled` display fallback still applies
when both are empty.

`docxToFixedDoc()` is **not** touched. A document's title is a property of the
document; only the dialog's prefill changes.

## Section 2 — Reading mode

### Data model

`BookState` gains:

```ts
/** How this DOCX is rendered. Absent means "pages", so every DOCX
 *  imported before this feature keeps its current behaviour with no
 *  migration pass. Meaningless for other kinds. */
readingMode?: "pages" | "flow";
```

In **state**, not `book.json`: this is a user preference about how to read the
book, in the same family as reading position — not a property of the document.
`loadBook()`/`loadFixedBook()` already return `{ book, state }` together, so it
is available at open time for routing with no extra read.

### `src/docx/flowDoc.ts` (new)

```ts
export interface FlowDoc {
  chapters: EpubChapter[];
  /** blockMap[chapterIndex][itemIndex] = index of the top-level block in
   *  content.html that produced this item. The mapping is RECORDED during
   *  the split, never inferred from arithmetic. */
  blockMap: number[][];
}

export function docxHtmlToFlowDoc(
  html: string,
  outline: DocxOutlineEntry[],
  meta: { title: string; author: string; dir: Dir },
): FlowDoc;
```

Chapters break at the top heading level present in `outline`; deeper headings
nest as sub-entries, so **both modes present the same TOC** built from the
same `docx-h-N` anchors. `pickBreakLevel()`'s existing "no headings at all"
fallback still yields a single chapter for plain-text-style documents.

`blockMap` stays in this module and is deliberately **not** added to
`EpubChapter` — the shared EPUB type must not grow a DOCX-only field.

### Routing

`App.tsx` currently routes on `entry.kind`. It gains one condition:
`kind === "docx" && state.readingMode === "flow"` renders the reflow reader
against a synthesized `EpubBook`. The reflow reader itself is unchanged: it
already consumes inline chapters and never knew where they came from.

**Image hrefs must be verified**, not assumed: `content.html` uses
`images/img-NNN.ext`, and the reflow path resolves chapter images through
`chapterImageSrcFor(id, href)`. DOCX images are stored at
`books/<id>/images/…`, the same shape EPUB extraction produces, so this should
work unchanged — but it is an explicit check in the plan, not a claim.

## Section 3 — Position across the switch

### The shared coordinate

Both modes index **block-level elements in document order**:

- Fixed: `blockId = "b{N}"`, N = index into the top-level blocks of
  `content.html` (`DocxPageSource.ts:108-110`).
- Flow: `paragraphIndex` = index into `EpubChapter.paragraphs`, which
  `epub/types.ts:37-39` documents as "block-level items in document order …
  this list must not be re-indexed after the book is saved".

These are the same coordinate **only if** the block→item conversion is
strictly 1:1. Relying on that silently would be fragile — one dropped empty
block or one flattened `<ul>` and every position after it shifts. Hence
`blockMap`, which is looked up rather than computed:

```
flow → pages :  blockMap[c][p]  →  "b{N}"  →  pageForBlock("b{N}")
pages → flow :  "b{N}"  →  reverse lookup  →  { chapter, itemIndex }
                (nearest preceding block if N produced no item)
```

`paragraphOffset` (flow) and the fixed anchor's `frac` are both intra-block
fractions and carry across directly.

Result: **same paragraph, same scroll fraction, both directions** — and it
stays correct regardless of what the block→item conversion decides to do.

### Highlights

Highlights already anchor to `{ blockId, frac }` in fixed mode
(`library.ts:149`, `library.ts:160`) and to `(chapter, paragraphIndex)` in
flow mode. `blockMap` maps between them mechanically, so a highlight made in
either mode is visible in the other, on the correct paragraph.

Per Decision 4, the character range within that paragraph is best-effort:
flow mode stores text with inline HTML stripped, so offsets diverge for any
paragraph containing bold, links, or footnotes. Accepted. The highlight never
disappears and never lands on the wrong paragraph.

## Section 4 — Background import

### The manifest

Alongside each staged file, `riwaq/staging/<token>.job.json`:

```ts
interface StagedJob {
  v: 1;
  token: string;
  kind: "pdf" | "docx";
  srcName: string;
  /** The copy finished and the hash is trustworthy. */
  copyComplete: boolean;
  hash?: string;
  /** The user pressed Import. THE RESUME GATE. */
  confirmed: boolean;
  title?: string;
  cover?: CoverChoice;
  phase: "copy" | "parse" | "commit";
}
```

Written before the copy starts, rewritten at each transition. Deleted when the
commit succeeds (for a PDF the staged file is renamed into place, so both
disappear together).

### Launch sweep

`sweepStagedJobs()` runs once at startup:

| Manifest state | Action |
| --- | --- |
| `copyComplete: false` | Delete file + manifest. Report "didn't finish", offer retry. Cannot resume: the SAF grant may be gone. |
| `copyComplete && !confirmed` | Killed while the dialog was open. Sweep and report — the user never chose a title or cover. |
| `copyComplete && confirmed` | **Resume in background**: parse → commit, using the bytes the app already owns. |
| Book dir with no index entry | Delete orphan. |

**The atomicity rule that makes the last row safe already holds.**
`commitPdfBook` and `commitDocxBook` both append the index entry **last**
(`fixedImport.ts` — `appendIndexEntry` is the final statement in each). So the
index append *is* the commit point, and a half-written book is always
identifiable as "directory present, no entry". This will be asserted by a test
rather than left as an implicit invariant.

### The queue

Jobs run **serially**. The bottleneck is I/O, and parsing two large files
concurrently is a known route to an Android OOM (see the memory note on
emulator OOM and the IPC byte ceiling). Serial also matches the existing
`stagePaths` loop, so this is a relocation rather than a rewrite.

The queue holds `importProgress` active for its whole lifetime, which keeps
`backgroundTasks.ts`'s Android foreground service alive with **no changes to
that file**.

### Flow

```
pick 3 files
   │  manifest written per file; copy starts
   ▼
dialog opens IMMEDIATELY (title from filename — no parse needed)
   │  cover grid fills in as each file becomes readable
   │  answer 1, 2, 3 back to back  →  confirmed: true
   ▼
library: skeleton cards, filling in as each job commits
```

This is why Section 1 is a prerequisite for Section 4 rather than an
independent change: taking the title from the filename is what lets the dialog
open before the parse has produced anything.

## UI surfaces

Per `CLAUDE.md`, designed with the `ui-ux-pro-max` skill. All three are reuse,
not new components.

### 1. Mode toggle — reader settings panel

Reuse `SegRow` from `SettingsSection.tsx:206`. Two options, labelled for
meaning rather than mechanism (Arabic strings in `src/i18n/ar.ts`,
English in `en.ts`):

```
Layout
┌──────────────────┐  ┌──────────────────┐
│  Pages           │  │  Flowing text    │
│  (as written)    │  │                  │
└──────────────────┘  └──────────────────┘
```

`SegRow` already satisfies the rules the skill flagged as CRITICAL:
`touch-target-size` (44px), `touch-spacing` (8px), `color-not-only`
(border + weight, not fill alone), `aria-pressed`, `reduced-motion`.

Shown **only** for `kind === "docx"`. PDF never sees it.

**The toggle must exist in both readers.** It lives in the fixed reader's
settings sheet *and* in the reflow reader's settings panel. Putting it only in
the fixed reader would make flow mode a one-way door — the user could switch
to flowing text and have no way back. This is the single most likely thing to
be missed during implementation, so it is called out here rather than left to
"the reader settings panel".

### 2. Skeleton library cards

Reuse `Skeleton.tsx` inside the existing card frame, at `BookCover`'s
`aspectRatio` (`BookCover.tsx:101`). Reserving the exact final dimensions is
what satisfies the HIGH-severity **Content Jumping** rule — the grid must not
reflow when a real cover replaces a placeholder.

Skeleton carries the title the user typed, so the card is identifiable while
it imports. Not interactive; `aria-busy="true"`.

### 3. Import dialog

`ImportDetailsDialog` opens immediately. Title field is populated from the
filename. Cover tiles render as `Skeleton` at the candidate tile's fixed
dimensions until `candidate.thumb()` resolves — again, reserved space, no
reflow. Confirm is enabled throughout; pressing it before candidates arrive
selects the default cover.

## Error handling

| Case | Behaviour |
| --- | --- |
| Storage full mid-copy | Job fails, manifest + partial file deleted, reported per-file. Other queued jobs continue. |
| `content.html` missing when switching to flow | Fall back to pages mode, report once. Does not strand the book. |
| DOCX with zero headings | Single chapter via `pickBreakLevel()`'s existing null branch. Mode toggle still works. |
| `blockMap` lookup misses | Nearest preceding block. Never throws, never resets to page 0. |
| Job manifest unreadable / wrong `v` | Treat as unresumable: sweep and report. |
| Two app instances sweeping | Sweep goes through `withIndexLock` (`src/store/indexLock.ts`), the existing mechanism. |

## Testing

Unit tests (happy-dom, no browser — the `fixed-reader-geometry-in-jsdom`
precedent shows this geometry is testable):

- `filenameTitle` precedence for PDF and DOCX, including the empty-string
  fallthrough to document metadata.
- `docxHtmlToFlowDoc`: chapter boundaries match the `outline`; `blockMap` is
  total over items; TOC identical to fixed mode's.
- **Round-trip position**: for a fixture document, every `(chapter, item)`
  maps to a block and back to itself. This is the test that proves the user's
  "same place" requirement.
- Round-trip with a deliberately non-1:1 conversion (a dropped empty block) —
  proves `blockMap` is doing the work, not arithmetic that happens to line up.
- `sweepStagedJobs`: one test per row of the sweep table.
- Commit atomicity: an index entry never exists without its files.

Per the `false-green-tests` note, each test is verified by **tampering** —
break the implementation, confirm the test fails — not by reading it.

## Risks

| Risk | Mitigation |
| --- | --- |
| `chapterImageSrcFor` may not resolve DOCX image hrefs identically | Explicit verification step in the plan before building on it. |
| Reflow reader may assume EPUB-specific `EpubChapter` fields (`id`, `href`, `order`) | Synthesize all of them; covered by a rendering test. |
| Serial queue feels slow for a large multi-file pick | Accepted deliberately over OOM risk. Revisit with measurement, not assumption. |
| Sweep deleting a book dir being written by a live import | Sweep runs once at startup, before the queue starts. |

## Delivery

Three phases, each independently shippable and independently valuable. The
plan should not interleave them.

| Phase | Scope | Depends on |
| --- | --- | --- |
| 1 | Title precedence (Section 1) | Nothing. ~4 call sites + tests. |
| 2 | Reading mode + position mapping (Sections 2, 3) | Nothing. The largest phase. |
| 3 | Background import + durability (Section 4) | Phase 1 — the dialog can only open before the parse once the title comes from the filename. |

Phase 1 is deliberately tiny and lands first: it is a prerequisite for phase 3
and is worth having on its own regardless of what follows.

## Files

**New:** `src/docx/flowDoc.ts`, `src/store/stagedJobs.ts` (manifest + sweep),
`src/store/importQueue.ts`, plus tests.

**Modified:** `src/store/fixedImportStage.ts` (precedence), `src/store/library.ts`
(manifest writes in `stagePaths`), `src/store/library.ts` `BookState`
(`readingMode`), `src/App.tsx` (routing), `src/components/library/Library.tsx`
(queue + skeletons), `src/components/ImportDetailsDialog.tsx` (lazy cover
tiles), reader settings panel (SegRow), `src/i18n/{ar,en}.ts`.

**Untouched:** `src/docx/buildEpub.ts`, `src/docx/toFixedDoc.ts`,
`src/reader/fixed/DocxPageSource.ts`, `src/store/backgroundTasks.ts`,
`src/store/importName.ts`.
