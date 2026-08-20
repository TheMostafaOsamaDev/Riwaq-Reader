# Fixed-layout reading mode — PDF + DOCX in a shared reader shell

Status: **design approved — ready for implementation plan** (open decisions resolved 2026-08-14)
Owner: Mostafa Osama
Scope: add a **fixed-page** reading mode that serves **two** formats through one viewer —
**PDF** (rendered with the already-bundled `pdfjs-dist`) and **DOCX** (mammoth → HTML →
paginated into fixed page-cards, keeping **real selectable text**). Both open into the
**same reader shell** as EPUB — top bar, Contents, Highlights/bookmarks, Progress,
Settings, gestures, theming, RTL — differing **only** in the viewer inside the shell.
Imports go through the **same** entry points (single-file picker **and** folder scan,
widened to mixed `epub` + `pdf` + `docx`), each book gets a format badge, and the whole
**DOCX→EPUB conversion + curation/editing feature is removed with its leftovers**. EPUB
(and streamed source novels) stay reflowable, unchanged. **No new dependencies. No Rust.**

New: `src/pdf/` (pdf.js load + page-render manager), `src/docx/toFixedDoc.ts` (DOCX →
sanitized HTML + images + outline), `src/reader/fixed/` (`FixedPageViewer` + the
`FixedPageSource` abstraction with `PdfPageSource` / `DocxPageSource`),
`src/store/fixedImport.ts` (import + storage for pdf & docx). Touches
`src/store/library.ts` (`kind:"pdf"|"docx"`, `importPdfBytes`/`importDocxBytes`, folder
scan, `loadBook`, progress calc, `BookState`), `src/types/reader.ts` (normalized reader
types + fixed-page `Tweaks`), `src/App.tsx` (viewer branch on `kind`, resume plumbing),
`src/components/LibrarySidebar.tsx` + `Library.tsx` (import filters, format badge, `kind`
routing), `src/components/DesktopReader.tsx` + `MobileReader.tsx` (host the viewer slot +
normalized panel data), `src/panels/{TOCPanel,HighlightsPanel,ProgressOverlay,
SettingsPanel}.tsx` (consume normalized data), `src/components/SettingsSection.tsx` +
`SettingsPage.tsx` (format-gated controls), `src/hooks/useTweaks.ts` (fixed-page defaults),
`src/i18n/en.ts` + `src/i18n/ar.ts` (new keys / removed curation keys, both catalogs).
**Removed (with leftovers):** `src/docx/buildEpub.ts`, `src/docx/splitChapters.ts`,
`src/docx/stage.ts`; `src/components/DocxManageView.tsx`; `src/components/ImportChoiceModal.tsx`;
`library.ts` `pickAndStageDocx` / `commitStagedDocx` / `docxToEpubBytes`; and all their
wiring (Library/LibrarySidebar buttons, `settings/docx.*` i18n keys, imports). `mammoth`
and `src/docx/detectDirection.ts` are **kept** (reused by the new DOCX→HTML path).

## Problem / motivation

The library imports EPUB and DOCX but can't read a PDF, and it reads DOCX as a
reflowable ebook via a heavy DOCX→EPUB conversion plus a curation/editing UI. The user
wants:

1. **PDF support** — many books (scans, typeset light novels) are fixed-layout and cannot
   be faithfully reflowed. The 298-page Arabic volume used to prototype this is exactly
   that case (portrait text pages + landscape art spreads, RTL).
2. **DOCX read as fixed pages, not reflowable** — DOCX joins PDF in the fixed-page reader,
   and the DOCX→EPUB conversion and the editing/curation feature are **removed entirely**.

The binding constraint: **the reader shell — Contents, Highlights, Progress, Settings —
stays identical across formats; only the center viewer (reflowable text vs fixed pages)
differs.** This design is built around that.

## Facts this design rests on (verified by code reconnaissance)

- **Every format currently converges on one reflowable model.** `parseEpub`
  (`src/epub/parser.ts:39`) yields `EpubBook` (chapters → `ChapterItem[]`); DOCX is
  *converted* to an EPUB (`src/docx/import.ts` → `importEpubBytes`) and read identically;
  streamed novels build a *virtual* `EpubBook`. The readers only know `EpubBook`. Fixed
  pages are not reflowable, so they need their own viewer — but it plugs into the same shell.
- **DOCX today = curation flow, not a live editor.** `mammoth` (docx→HTML, lazy-loaded
  `src/docx/import.ts:49`) → `createBlocksFromHtml` → `DocxManageView.tsx` (trim blocks,
  pick cover, edit title/author) → `buildEpub` assembles an EPUB3 zip. `StagingEdits`
  (`src/docx/stage.ts:86`) is the only user editing. `docxToEpubBytes` (`import.ts:80`) is
  the direct path. **All of this is being removed**; only mammoth's DOCX→HTML step and
  `detectDirection` survive into the new fixed-page path.
- **`kind` is the format seam.** `BookIndexEntry.kind?: "epub" | "source"`
  (`src/store/library.ts:95`; `undefined ⇒ "epub"`). Routing branches on it (`App.tsx:269`,
  `Library.tsx:174–186`). We add `"pdf"` and `"docx"`; both branch sites gain cases.
- **`pdfjs-dist ^4.7.76` is installed and Vite-wired.** `src/sources/pdf/pdfChapter.ts:248`
  `extractPdfLines()` lazy-loads pdf.js + its worker (`pdf.worker.min.mjs?url`, lines 30–43)
  for text extraction. We reuse that load/worker pattern for **canvas page rendering**. No
  new dep; files read via `@tauri-apps/plugin-fs` (already used). No Rust.
- **A CSS-multicol paginator already exists.** `PaginatedView.tsx` flows reflowable content
  into fixed-size columns (pages) via multicol + transform, exposing `page`/`totalPages`.
  The DOCX fixed-page paginator reuses this *technique* with a fixed page box and no reflow
  controls.
- **The panels are already separate components.** `src/panels/{TOCPanel,HighlightsPanel,
  ProgressOverlay,SettingsPanel}.tsx` behind `PanelShell.tsx`; `ActivePanel =
  null|"toc"|"highlights"|"settings"|"progress"` (`types/reader.ts:4`). They're fed
  `EpubBook`-shaped data today; feeding them **normalized** data makes the shell
  format-agnostic without rewriting them.
- **Layout mode vs format are orthogonal.** `ReadingMode = "paginated-2"|"paginated-1"|
  "scroll"` (`types/reader.ts:23`) is reflowable typography layout and is meaningless for
  fixed pages, which get their **own** flow (`scroll` | `paged`). Reflowable typography
  tweaks (font, size, line height, hyphenation, contentWidth, alignment) don't apply to a
  fixed page and must be **gated off** — no gating mechanism exists today.
- **Progress & resume are text-anchored.** `entry.progress = (currentChapter+1)/chapterCount`
  (`library.ts:962`); `BookState { currentChapter, paragraphIndex, paragraphOffset? }` in
  `state.json`. Fixed pages need a **page-based** progress/resume, mirroring the
  within-chapter progress bar spec (2026-06-09) with `currentPage/pageCount`.
- **No router; state-driven views.** `App.tsx` `AnimatedSwap` `viewKey` = `library` /
  `reader-mobile` / `reader-desktop` / `settings` (`538–547`). Fixed-page reading is the
  **same** reader view with a different viewer inside — not a new top-level view.
- **i18n build gate.** Every user string is a key in **both** `en.ts` and `ar.ts`; the
  completeness gate fails the build on a missing key. RTL uses logical properties +
  `direction` throughout the recent i18n work.

## Architecture — one shell, normalized contract, swappable viewer

The reader = **shared shell** (chrome + panels) + a **viewer slot** chosen by `kind`:

```
kind "epub" | "source"  → Reflowable viewer   (existing BookBody + PaginatedView/scroll)
kind "pdf"              → Fixed-page viewer  ← FixedPageSource = PdfPageSource   (pdf.js canvas)
kind "docx"            → Fixed-page viewer  ← FixedPageSource = DocxPageSource (paginated HTML)
```

### Normalized reader contract (`types/reader.ts`)

The shell/panels stop speaking `EpubBook` and speak a small format-agnostic vocabulary:

```ts
type ReaderLocation =
  | { fmt: "reflow"; chapter: number; paragraphIndex: number; paragraphOffset?: number }
  | { fmt: "page";  page: number; pageOffset?: number };   // fixed page (pdf or docx)

type TocEntry       = { title: string; dest: ReaderLocation; level: number };
type BookmarkOrHl   = { id: string; color?: HighlightColor; snippet?: string; loc: ReaderLocation };
type ReaderProgress = { fraction: number; label: string }; // 0.03 · "Page 7 / 298" | "Ch. 3 · 24%"
```

### The fixed-page viewer + `FixedPageSource`

One `FixedPageViewer` renders the fixed-page shell interactions (scroll / single-page,
zoom, fit-width / fit-page, page nav, RTL mirroring, virtualization) against a **page-source**
that abstracts the two formats:

```ts
interface FixedPageSource {
  pageCount: number;
  pageSize(i: number): { w: number; h: number };   // intrinsic, for height reservation (no CLS)
  renderPage(i: number, host: HTMLElement, scale: number): void | Promise<void>;
  outline: TocEntry[];
  hasTextLayer: boolean;                            // enables selection/search when true
}
```

- **`PdfPageSource`** (pdf.js): renders each page to a `<canvas>` at `scale`; `pageSize`
  from `page.getViewport`; `outline` from `getOutline()`; optional text layer when present.
- **`DocxPageSource`** (HTML): the DOCX's sanitized HTML is paginated into fixed page-cards
  (fixed page geometry, no reflow controls) using the `PaginatedView` multicol technique;
  `renderPage` mounts the page-card node; `pageSize` is the fixed page box; `outline` from
  headings (`h1..h3`); `hasTextLayer = true` (real selectable Arabic text — the whole point
  of choosing HTML over rasterization).

**Least-churn path:** `DesktopReader`/`MobileReader` keep the chrome + panel set they
already render; their central content branches Reflowable vs `FixedPageViewer` on `kind`,
and the panels receive normalized `toc` / `bookmarks` / `progress`. A standalone
`ReaderShell` extraction is optional cleanup, not required for v1.

## Import & storage (parallels `importEpubBytes`)

- **Single file:** the picker filter widens to `["epub","pdf","docx"]`; `.pdf` →
  `importPdfBytes`, `.docx` → `importDocxBytes`, `.epub` → existing.
- **Folder (mixed):** `pickAndImportFolder` scan widens from `/\.epub$/i` to
  `/\.(epub|pdf|docx)$/i` (`library.ts:711`), dispatching each file to the right importer —
  **mixed folders import in one batch** (the user's explicit ask). The `importProgress`
  stepper reports per-file progress unchanged.
- **`importPdfBytes`** (`src/store/fixedImport.ts`): lazy-load pdf.js → read `numPages`,
  `getMetadata()`, `getOutline()` (→ `TocEntry[]` `{fmt:"page",page}`); render page 1 →
  `cover.jpg`. Persist `books/<id>/`: `book.pdf` (original), `book.json` = `PdfBook
  {id,title,author,pageCount,outline,kind:"pdf"}`, `state.json`, `cover.jpg`. Append
  `BookIndexEntry{kind:"pdf",pageCount}`. Pages render lazily at read time — never all in memory.
- **`importDocxBytes`** (`src/store/fixedImport.ts` + `src/docx/toFixedDoc.ts`): mammoth →
  **sanitized HTML**, extracting embedded images to `images/img-NNN.ext` (reuse the existing
  `convertImage`/`staging://`→`images/` rewrite, minus the staging UI); `detectDirection`
  for RTL. Cover = first embedded image, else a generated `BookCover`. Persist: the HTML +
  `images/`, `book.json` = `DocxBook {id,title,author,htmlRef,dir,outline,kind:"docx"}`,
  `state.json`, `cover.*`. Pagination happens at **read time** (depends on viewport/page box).
- `loadBook` (`library.ts:252`) branches on `kind`: `"pdf"`/`"docx"` return their
  descriptors; the fixed-page viewer builds the right `FixedPageSource`.

## Fixed-page viewer behavior (PDF + DOCX)

- **Virtualized (mandatory — 298-page books):** reserve each page's height up front from
  `pageSize` (no layout shift / CLS across the landscape spreads), render only the visible
  window + a small buffer, recycle offscreen page hosts; un-rendered pages show a shimmer
  **skeleton** (ui-ux-pro-max `virtualize-lists`, `content-jumping`, `progressive-loading`).
- **Flow:** `scroll` (stacked page-cards — **default**) or `paged` (one page; ← →, side
  tap-zones, keyboard; **RTL-mirrored** so "next" is the left page in RTL). `MobileReader`
  is scroll-only today, so scroll is the low-risk default and reuses its scroll container.
- **Fit / zoom:** `fit-width` (default) / `fit-page` compute scale from the container;
  pinch / +− adjust a zoom multiplier (re-render PDF at scale; CSS-scale the DOCX page box).
  Touch targets ≥44px.
- **Page tint:** `none` (default) / `dim` (glare reduction in dark theme); `invert` offered
  for PDF text-only pages, **off by default** (wrecks color art). The reader **chrome**
  re-themes with the app theme; the fixed page's content does not (DOCX pages can optionally
  adopt the paper/ink theme since they're real HTML — a small win over PDF; default keeps
  document styling).
- **Text layer:** DOCX always has one (selection + in-page search). PDF has one only when
  the PDF carries extractable text; scanned PDFs (like the test file) degrade to
  selection/search unavailable, with a clear empty state.

## Progress, resume, TOC, bookmarks

- **Progress:** `entry.progress = currentPage / pageCount`; `ReaderProgress.label` =
  localized "Page N / Total" (tabular / Arabic-Indic digits). The header within-chapter bar
  fraction = `currentPage/pageCount` (or live scroll fraction), reusing the imperative
  `progressFillRef` mechanism from the 2026-06-09 spec.
- **Resume:** `BookState` gains additive `currentPage?: number` (+ `pageOffset?: 0–1` in
  scroll), written debounced like `updateParagraphPosition`. Absent ⇒ page 1. Reflow fields
  untouched; a book uses one set. DOCX page indices are viewport-dependent, so resume stores
  a **content anchor** (nearest block id + intra-block offset) and maps it back to a page
  after pagination — reflow-stable if the page box changes.
- **TOC:** PDF from `getOutline()`, DOCX from headings; empty ⇒ TOCPanel empty state.
- **Bookmarks / highlights:** the HighlightsPanel is shared. **v1 ships page bookmarks**
  (`BookmarkOrHl` with `loc={fmt:"page",page}`, no snippet) for both formats, and
  **selection/search** where a text layer exists. **Page+rect / range text-highlighting on
  fixed pages is deferred** to a later phase (resolved decision #2).

## Settings — shared panel, format-gated controls

`SettingsPanel` + `SettingsPage` receive the open book's `kind` and gate controls (the
missing mechanism, added in `SettingsSection.tsx`):

- **Shared always:** Theme, UI language, keep-screen-awake, reduce-motion, startup, etc.
- **Reflow-only (hidden for fixed-page):** font family, size, line height, letter spacing,
  paragraph spacing, hyphenation, content width, alignment, `readingMode`.
- **Fixed-page-only (new `Tweaks`, shown for PDF & DOCX):** `fixedFlow: "scroll"|"paged"`
  (default `"scroll"`), `fixedFit: "width"|"page"` (default `"width"`), `fixedPageTint:
  "none"|"dim"|"invert"` (default `"none"`). Added to `DEFAULT_TWEAKS`; the existing
  `{...DEFAULT_TWEAKS, ...parsed}` merge back-fills — no migration code. A **per-book flow
  override** persisted in `BookState` is planned but **deferred from v1** (resolved decision #1).

## Removing the DOCX→EPUB path (with leftovers)

- **Delete:** `src/docx/buildEpub.ts`, `splitChapters.ts`, `stage.ts`;
  `src/components/DocxManageView.tsx`; `src/components/ImportChoiceModal.tsx`; `library.ts`
  `pickAndStageDocx` / `commitStagedDocx` / `docxToEpubBytes`.
- **Rewire:** the "Word doc .docx" import path calls `importDocxBytes` directly (no
  add-directly/manage choice); remove the `ImportChoiceModal` mount + its Library/
  LibrarySidebar wiring and the `settings.docx.*` / manage i18n keys from **both** catalogs.
- **Keep:** `mammoth` (docx→HTML) and `src/docx/detectDirection.ts`, reused by
  `toFixedDoc.ts`. `EditBookModal` (generic title/author/cover editing) is unrelated and
  stays.
- A dead-reference sweep (grep for `DocxManageView`, `ImportChoiceModal`, `buildEpub`,
  `splitChapters`, staging types, removed i18n keys) is part of the plan; `tsc` + the i18n
  gate catch stragglers.

## i18n / RTL

Every new label/hint (import filter copy, PDF/DOCX badges, fit/flow/tint controls, page
counter, outline empty state) added to **both** `en.ts` and `ar.ts`; removed curation keys
deleted from both (build gate enforced). Page-turn direction, the page scrubber, tap-zones,
and panel side use logical properties / `direction` so RTL mirrors correctly.

## Decisions (resolved 2026-08-14)

1. **Default flow = continuous scroll**, with a per-book override **deferred from v1**.
2. **v1 = navigate / zoom / fit / outline / resume / search / page-bookmarks**; page+rect
   text-highlighting deferred to a later phase.
3. **DOCX → fixed HTML pages** (real selectable text), **not** a rasterized PDF and **not**
   reflowable; the DOCX→EPUB conversion + curation/editing feature removed entirely.

## Testing / verification

- `tsc --noEmit` + `vite build` green (incl. i18n catalog gate); no dead references to the
  removed DOCX modules.
- Import a `.pdf`, a `.docx`, and a **mixed folder** (epub+pdf+docx) → all land with correct
  badges; EPUBs still open reflowable.
- PDF and DOCX both open into the **same shell**: Contents, Highlights/bookmarks, Progress,
  Settings all present and visually identical to an EPUB's; only the center differs.
  Reflow-only settings hidden, fixed-page settings shown.
- **DOCX:** text is real & selectable, Arabic shapes correctly, in-page search works; pages
  are fixed (no font-size reflow); outline from headings jumps correctly.
- **PDF:** 298-page file scrolls smoothly (virtualized, no CLS on landscape spreads);
  fit/zoom behave; paged flow RTL-mirrored; scanned-PDF selection/search shows empty state.
- Resume returns to the same page (and intra-page anchor); progress bar + counter + Progress
  panel agree. Verified in both themes, RTL + LTR chrome, 375px + desktop.

## Out of scope (YAGNI)

- Page+rect text-highlighting/annotations on fixed pages (later phase).
- Per-book flow override (later; global default only in v1).
- Rasterizing DOCX to a literal `.pdf`, or converting PDF into the reflowable pipeline —
  both rejected: real-text HTML pages and faithful PDF canvas are the point.
- OS "Open with…" association routing a file into import; PDF forms / embedded JS /
  signature validation / printing/export; cloud sync; a real router / deep-linkable URL.
