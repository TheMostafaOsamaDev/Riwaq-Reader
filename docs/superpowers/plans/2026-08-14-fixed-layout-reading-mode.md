# Fixed-Layout Reading Mode (PDF + DOCX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed-page reading mode that serves **PDF** (pdf.js canvas) and **DOCX** (mammoth→HTML paginated into page-cards, real selectable text) through the **same reader shell** as EPUB — differing only in the center viewer — and remove the old DOCX→EPUB conversion + curation/editing feature.

**Architecture:** One shared reader shell (top bar, Contents/Highlights/Progress/Settings panels, gestures) with a viewer slot chosen by `BookIndexEntry.kind`. Reflowable books (`epub`/`source`) keep the existing `DesktopReader`/`MobileReader`. Fixed books (`pdf`/`docx`) render a new `FixedPageReader` that reuses `PanelShell` + the panels fed **normalized** data (`TocEntry`, `ReaderProgress`, page-based `ReaderLocation`), and a `FixedPageViewer` driven by a `FixedPageSource` abstraction (`PdfPageSource` | `DocxPageSource`). Import, storage, settings, theming, i18n and RTL are reused.

**Tech Stack:** React 19 + Vite + Tauri 2 (desktop + Android). `pdfjs-dist ^4.7.76` (already installed), `mammoth` (already installed), `jszip` (already installed), `@tauri-apps/plugin-fs` / `plugin-dialog`. **No new runtime dependencies. No Rust changes.**

**Spec:** `docs/superpowers/specs/2026-08-14-pdf-reading-mode-design.md` (read it alongside this plan).

## Global Constraints

- **No new dependencies** (runtime or dev). No test framework is added — this repo has none.
- **No Rust changes** — everything is JS/TS in the webview; files read via `@tauri-apps/plugin-fs`.
- **i18n build gate:** every user-facing string is a key present in **both** `src/i18n/en.ts` and `src/i18n/ar.ts`; removing a feature means deleting its keys from **both**. A missing/extra key fails the build.
- **RTL:** use logical CSS properties (`inset-inline-*`, `border-inline-*`) and `direction`; the shell direction follows the UI language, book/page content keeps its own direction (mirror `App.tsx` / `PanelShell` conventions).
- **Design tokens only:** colors/spacing from `src/styles/tokens.ts` (`THEMES`, `ACCENT`, `FONT_STACKS`), motion from `src/styles/motion.ts` (`MOTION`, `EASE`, `useReducedMotion`). No raw hex in components.
- **Verification per task (this repo's convention, no test runner):**
  - **Typecheck/build:** `pnpm exec tsc --noEmit` (fast gate) and, before a phase's final commit, `pnpm build` (`tsc && vite build`).
  - **UI-only behavior** (viewer, panels, settings gating, RTL, themes): drive in a plain browser via `pnpm dev` + Playwright/screenshots (Tauri APIs stubbed) per the browser-UI-verification approach.
  - **Tauri-backed behavior** (import, file read/write, storage): drive the desktop app via `pnpm tauri dev` (or `pnpm android:dev`) and exercise the real flow.
- **Commit after every task** with a Conventional-Commit message authored as the user (no AI/Claude attribution).

---

## Phase 0 — Foundations (types, tweaks, storage discriminators)

### Task 0.1: Normalized reader types + fixed-page tweaks

**Files:**
- Modify: `src/types/reader.ts` (append new types; extend `Tweaks`)
- Modify: `src/hooks/useTweaks.ts:6-29` (`DEFAULT_TWEAKS`)

**Interfaces:**
- Produces: `ReaderLocation`, `TocEntry`, `ReaderProgress`, `FixedFlow`, `FixedFit`, `FixedPageTint`, and three new `Tweaks` fields `fixedFlow`/`fixedFit`/`fixedPageTint`. Every later task consumes these.

- [ ] **Step 1: Add the normalized reader vocabulary** to the end of `src/types/reader.ts`:

```ts
// ── Normalized, format-agnostic reader vocabulary ───────────────────────────
// The reader shell + panels speak these instead of EpubBook, so the same
// Contents/Progress/Highlights UI serves reflowable and fixed-page books.

/** Where the reader is / can go, independent of format. */
export type ReaderLocation =
  | { fmt: "reflow"; chapter: number; paragraphIndex: number; paragraphOffset?: number }
  | { fmt: "page"; page: number; pageOffset?: number }; // fixed page (pdf or docx), pageOffset 0..1

/** One entry in a Contents/outline list. `level` is 0-based nesting depth. */
export interface TocEntry {
  title: string;
  dest: ReaderLocation;
  level: number;
}

/** Progress the shell renders in the header bar + counter + Progress panel. */
export interface ReaderProgress {
  fraction: number; // 0..1
  label: string;    // localized, e.g. "٧ / ٢٩٨"
}

export type FixedFlow = "scroll" | "paged";
export type FixedFit = "width" | "page";
export type FixedPageTint = "none" | "dim" | "invert";
```

- [ ] **Step 2: Extend `Tweaks`** — add these fields inside the `Tweaks` interface in `src/types/reader.ts` (after `wifiOnlyDownloads`), with doc comments matching the file's style:

```ts
  /** Fixed-page (PDF/DOCX) default flow: continuous scroll or one page at a
      time. Reflowable books ignore it (they use `readingMode`). */
  fixedFlow: FixedFlow;
  /** Fixed-page fit: fit the page width, or the whole page, to the viewport. */
  fixedFit: FixedFit;
  /** Fixed-page tint: keep page colors, dim them (glare in dark themes), or
      invert (text-only PDFs; wrecks color art, so opt-in). */
  fixedPageTint: FixedPageTint;
```

- [ ] **Step 3: Add defaults** in `src/hooks/useTweaks.ts` `DEFAULT_TWEAKS` (after `wifiOnlyDownloads: false,`):

```ts
  fixedFlow: "scroll",
  fixedFit: "width",
  fixedPageTint: "none",
```

No migration code needed — `load()`'s `{ ...DEFAULT_TWEAKS, ...parsed }` back-fills existing users (verified `useTweaks.ts:56`).

- [ ] **Step 4: Verify** — `pnpm exec tsc --noEmit`. Expected: PASS (no consumers yet).
- [ ] **Step 5: Commit** — `feat(reader): add normalized reader types + fixed-page tweaks`.

### Task 0.2: Library `kind` + page-based state discriminators

**Files:**
- Modify: `src/store/library.ts` — `BookIndexEntry` (67-102), `BookState` (104-117), `readState` (190-226), `updateReadingPosition` (946-969), add `updatePagePosition`, add page-based progress.

**Interfaces:**
- Produces: widened `BookIndexEntry.kind`, `BookIndexEntry.pageCount?`, `BookState.currentPage?`/`pageOffset?`/`fixedAnchor?`, `updatePagePosition(id, page, pageOffset?, fixedAnchor?)`, `updatePageProgress(id, page, pageCount)`.

- [ ] **Step 1:** Widen `kind` and add `pageCount` in `BookIndexEntry`:

```ts
  kind?: "epub" | "source" | "pdf" | "docx";
  /** Total fixed pages. Present only on kind "pdf" | "docx"; drives page-based
      progress and the page counter. */
  pageCount?: number;
```
Update the `kind` doc comment to mention pdf/docx are fixed-page formats.

- [ ] **Step 2:** Add page-resume fields to `BookState` (after `paragraphOffset?`):

```ts
  /** Fixed-page (PDF/DOCX) resume: current page (0-based). Absent on reflow. */
  currentPage?: number;
  /** 0..1 scroll offset within `currentPage` (scroll flow only). */
  pageOffset?: number;
  /** DOCX only — a reflow-stable content anchor (nearest block id + intra-block
      fraction) so resume survives re-pagination when the page box changes. */
  fixedAnchor?: { blockId: string; frac: number };
```

- [ ] **Step 3:** Carry the new fields through `readState` (parse them defensively like `paragraphOffset`) and keep `writeState` unchanged (it serializes the whole object).

- [ ] **Step 4:** Add page persistence + progress functions (after `updateParagraphPosition`, ~line 1011):

```ts
/** Persist fixed-page resume position (debounced by the caller). Doesn't touch
 *  the library index — page-level progress goes through updatePageProgress. */
export async function updatePagePosition(
  id: string,
  currentPage: number,
  pageOffset?: number,
  fixedAnchor?: { blockId: string; frac: number },
): Promise<void> {
  const state = await readState(id);
  state.currentPage = currentPage;
  state.pageOffset = pageOffset ?? 0;
  if (fixedAnchor) state.fixedAnchor = fixedAnchor;
  await writeState(state);
}

/** Stamp page-based progress + lastReadAt on the index entry for a fixed book. */
export async function updatePageProgress(
  id: string,
  currentPage: number,
  pageCount: number,
): Promise<void> {
  const idx = await readIndex();
  const entry = idx.books.find((b) => b.id === id);
  if (!entry) return;
  entry.progress = pageCount > 0 ? Math.min(1, (currentPage + 1) / pageCount) : 0;
  entry.lastReadAt = Date.now();
  await writeIndex(idx);
}
```

- [ ] **Step 5: Verify** — `pnpm exec tsc --noEmit`. Expected: PASS.
- [ ] **Step 6: Commit** — `feat(library): page-based kind + reading-state discriminators`.

---

## Phase A — PDF reading (end-to-end, shippable)

### Task A.1: Shared pdf.js loader + document facade

**Files:**
- Create: `src/pdf/pdfjs.ts`

**Interfaces:**
- Produces: `loadPdfjs()`, `openPdfDocument(bytes): Promise<PdfDoc>`, `PdfDoc { pageCount, meta, outline: TocEntry[], pageViewport(i), renderPage(i, canvas, scale), hasTextLayer }`.
- Consumes: the worker-load pattern from `src/sources/pdf/pdfChapter.ts:30-44` (copy it; do **not** import that scraping module).

- [ ] **Step 1: Write `src/pdf/pdfjs.ts`.** Reuse the exact worker-load pattern (verified in `pdfChapter.ts`), then wrap a document:

```ts
import type { TocEntry } from "../types/reader";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
export async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export interface PdfMeta { title?: string; author?: string; }

export interface PdfDoc {
  pageCount: number;
  meta: PdfMeta;
  outline: TocEntry[];
  hasTextLayer: boolean;
  pageViewport(i: number, scale: number): Promise<{ width: number; height: number }>;
  renderPage(i: number, canvas: HTMLCanvasElement, scale: number): Promise<void>;
  destroy(): void;
}

export async function openPdfDocument(bytes: Uint8Array): Promise<PdfDoc> {
  const pdfjs = await loadPdfjs();
  // pdf.js takes ownership of the buffer; hand it a fresh copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const info = (await doc.getMetadata().catch(() => null))?.info as
    | { Title?: string; Author?: string }
    | undefined;
  const outline = await buildOutline(pdfjs, doc);
  // Cheap text-layer probe: page 1 has any text content?
  let hasTextLayer = false;
  try {
    const tc = await (await doc.getPage(1)).getTextContent();
    hasTextLayer = tc.items.length > 0;
  } catch { /* image-only pdf */ }

  return {
    pageCount: doc.numPages,
    meta: { title: info?.Title || undefined, author: info?.Author || undefined },
    outline,
    hasTextLayer,
    async pageViewport(i, scale) {
      const page = await doc.getPage(i + 1); // pdf.js is 1-based
      const vp = page.getViewport({ scale });
      return { width: vp.width, height: vp.height };
    },
    async renderPage(i, canvas, scale) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${Math.floor(vp.width)}px`;
      canvas.style.height = `${Math.floor(vp.height)}px`;
      await page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
    },
    destroy() { void doc.destroy(); },
  };
}

async function buildOutline(pdfjs: Awaited<ReturnType<typeof loadPdfjs>>, doc: any): Promise<TocEntry[]> {
  const raw = await doc.getOutline().catch(() => null);
  if (!raw) return [];
  const out: TocEntry[] = [];
  const walk = async (items: any[], level: number) => {
    for (const it of items) {
      const page = await destToPageIndex(doc, it.dest).catch(() => 0);
      out.push({ title: String(it.title ?? ""), dest: { fmt: "page", page }, level });
      if (it.items?.length) await walk(it.items, level + 1);
    }
  };
  await walk(raw, 0);
  return out;
}

async function destToPageIndex(doc: any, dest: any): Promise<number> {
  const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || !explicit[0]) return 0;
  return doc.getPageIndex(explicit[0]); // 0-based
}
```

- [ ] **Step 2: Verify** — `pnpm exec tsc --noEmit`. If pdf.js types complain on `any`, keep the `any` casts (the scraper file uses `TextItemLike` shims; matching that pragmatism is fine).
- [ ] **Step 3: Commit** — `feat(pdf): shared pdf.js loader + document facade`.

### Task A.2: `importPdfBytes` + storage + loadBook branch

**Files:**
- Create: `src/store/fixedImport.ts`
- Modify: `src/store/library.ts` — export a `FixedBook` type + branch `loadBook` (252-258) and `readBookJson` on `kind`.

**Interfaces:**
- Consumes: `openPdfDocument` (A.1).
- Produces: `importPdfBytes(bytes, fallbackTitle): Promise<BookIndexEntry>`; `PdfBook` descriptor persisted as `book.json`; `loadFixedBook(id): Promise<{ book: FixedBook; state: BookState }>`.

- [ ] **Step 1:** Define descriptors. In `src/store/library.ts` add and export:

```ts
export interface PdfBook { id: string; kind: "pdf"; title: string; author: string; pageCount: number; outline: TocEntry[]; }
export interface DocxBook { id: string; kind: "docx"; title: string; author: string; dir: "ltr" | "rtl"; outline: TocEntry[]; }
export type FixedBook = PdfBook | DocxBook;
```
(Import `TocEntry` from `../types/reader`.)

- [ ] **Step 2: Write `importPdfBytes`** in `src/store/fixedImport.ts` — mirror `importEpubBytes` (library.ts:488) for the fs/index parts, render page 1 → cover:

```ts
import { BaseDirectory, mkdir, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { openPdfDocument } from "../pdf/pdfjs";
import { appendIndexEntry, ensureRoot, bookDir, writeInitialState, type BookIndexEntry, type PdfBook } from "./library";

export async function importPdfBytes(bytes: Uint8Array, fallbackTitle: string): Promise<BookIndexEntry> {
  await ensureRoot();
  const doc = await openPdfDocument(bytes);
  const id = crypto.randomUUID();
  const dir = bookDir(id);
  await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeFile(`${dir}/book.pdf`, bytes, { baseDir: BaseDirectory.AppData });

  // Cover = page 1 rendered to JPEG via an offscreen canvas.
  let coverFile: string | undefined;
  try {
    const canvas = document.createElement("canvas");
    await doc.renderPage(0, canvas, 1.2);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (blob) {
      coverFile = "cover.jpg";
      await writeFile(`${dir}/${coverFile}`, new Uint8Array(await blob.arrayBuffer()), { baseDir: BaseDirectory.AppData });
    }
  } catch { /* cover is best-effort */ }

  const book: PdfBook = { id, kind: "pdf", title: doc.meta.title || fallbackTitle, author: doc.meta.author || "", pageCount: doc.pageCount, outline: doc.outline };
  await writeTextFile(`${dir}/book.json`, JSON.stringify(book), { baseDir: BaseDirectory.AppData });
  await writeInitialState(id);
  doc.destroy();

  return appendIndexEntry({
    id, title: book.title, author: book.author, language: "", chapterCount: 0,
    pageCount: book.pageCount, kind: "pdf", addedAt: Date.now(), progress: 0,
    ...(coverFile ? { coverFile } : {}),
  });
}
```

- [ ] **Step 3: Expose the small helpers** `importPdfBytes` needs from `library.ts` by exporting existing internals (`ensureRoot`, `bookDir`) and adding thin helpers `writeInitialState(id)` (writes the default `state.json`) and `appendIndexEntry(entry)` (reads index, pushes, writes, returns entry) — extracted from the tail of `importEpubBytes` so both importers share them (DRY).

- [ ] **Step 4: Branch `loadBook`** so fixed books don't go through the EPUB `readBookJson` typing. Add `export async function loadFixedBook(id): Promise<{ book: FixedBook; state: BookState }>` reading `book.json` as `FixedBook`, and have callers pick by `entry.kind` (App.tsx, Task A.8).

- [ ] **Step 5: Verify** — `pnpm exec tsc --noEmit`; then `pnpm tauri dev`, import a `.pdf` via a temporary dev button (or the Task A.3 wiring) and confirm `books/<id>/book.pdf`, `book.json`, `cover.jpg` are written and the entry appears with a cover.
- [ ] **Step 6: Commit** — `feat(library): import PDFs to fixed-page storage`.

### Task A.3: Import wiring — picker filter, folder scan, PDF badge

**Files:**
- Modify: `src/store/library.ts` — `pickAndImportEpub` filter (265-269) → add pdf; `pickAndImportFolder` scan (709-712).
- Modify: `src/components/LibrarySidebar.tsx` (import button label/handlers) + `src/components/Library.tsx` (import handler wiring, ~190/214/324) + `src/components/BookCover.tsx` or the card (format badge).

- [ ] **Step 1:** Rename/repurpose the single-file picker to accept both, routing by extension:

```ts
// pickAndImportEpub → pickAndImportBook
const picked = await open({ multiple: false, directory: false, filters: [
  { name: "Books", extensions: ["epub", "pdf"] },
] });
if (!picked) return null;
const bytes = await readFile(picked);
if (/\.pdf$/i.test(picked)) return importPdfBytes(bytes, filenameTitle(picked));
return importEpubBytes(bytes);
```
(Generalize `filenameTitle` to strip `.epub`/`.pdf`/`.docx`.)

- [ ] **Step 2:** Widen folder scan (`library.ts:710`) to `/\.(epub|pdf)$/i` and dispatch per extension; update `ImportFolderResult.empty` comment to "no importable files".

- [ ] **Step 3:** In `LibrarySidebar`/`Library`, wire the primary "Import book" button to `pickAndImportBook` and update copy to "EPUB / PDF"; add a small **PDF** badge on the library card driven by `entry.kind === "pdf"` (reuse the `ACCENT` token; mirror the mockup's badge).

- [ ] **Step 4: Verify** — `pnpm tauri dev`: single-file import of a `.pdf` and an `.epub` both work; a folder with mixed epub+pdf imports both; the pdf card shows the PDF badge.
- [ ] **Step 5: Commit** — `feat(library): import PDFs via file + folder, badge in library`.

### Task A.4: `FixedPageSource` + `PdfPageSource`

**Files:**
- Create: `src/reader/fixed/FixedPageSource.ts` (interface) + `src/reader/fixed/PdfPageSource.ts`

**Interfaces:**
- Produces: `FixedPageSource` (from the spec) and `createPdfPageSource(book: PdfBook): Promise<FixedPageSource>`.

- [ ] **Step 1:** `FixedPageSource.ts`:

```ts
import type { TocEntry } from "../../types/reader";
export interface FixedPageSource {
  pageCount: number;
  outline: TocEntry[];
  hasTextLayer: boolean;
  /** Intrinsic page size at scale 1, for height reservation (no CLS). */
  pageSize(i: number): Promise<{ w: number; h: number }>;
  /** Mount page i into `host` at `scale` (canvas for pdf, DOM for docx). */
  renderPage(i: number, host: HTMLElement, scale: number): Promise<void>;
  destroy(): void;
}
```

- [ ] **Step 2:** `PdfPageSource.ts` wraps `openPdfDocument`, reads `book.pdf` off disk via `plugin-fs`, caches `pageSize`, and `renderPage` mounts/reuses a `<canvas>` inside `host`. Apply `fixedPageTint` as a CSS `filter` on the canvas (`none` / `brightness(.9)` / `invert(1) hue-rotate(180deg)`). Include LRU eviction of rendered canvases (keep a small window) to bound memory.

- [ ] **Step 3: Verify** — `pnpm exec tsc --noEmit`. Commit — `feat(reader): FixedPageSource + PdfPageSource`.

### Task A.5: `FixedPageViewer` (virtualized scroll/paged, zoom, fit, RTL)

**Files:**
- Create: `src/reader/fixed/FixedPageViewer.tsx` + `src/reader/fixed/useVirtualPages.ts`

**Interfaces:**
- Consumes: `FixedPageSource` (A.4), `Tweaks` fixed fields (0.1).
- Produces: `<FixedPageViewer source flow fit zoom tint dir onProgress onLocationChange resume />`.

- [ ] **Step 1: `useVirtualPages.ts`** — given `pageCount` + a `pageSize(i)` provider + the scroll container, reserve each page's height (fit-width scale from container width), maintain a visible window `[start,end]` from `scrollTop`, and expose the window + a `currentPage` (nearest to viewport center) + total height. Debounce `pageSize` fetches; cache sizes.

- [ ] **Step 2: `FixedPageViewer.tsx`** — a scroll container that:
  - **scroll flow:** absolutely positions each in-window page host at its reserved offset; renders a shimmer skeleton (tokens: `--chrome` gradient) for not-yet-rendered pages; calls `source.renderPage(i, host, scale)` when a page enters the window.
  - **paged flow:** shows one page centered; ← → / side tap-zones / keyboard step; **RTL:** "next" decrements x / goes left (mirror the mockup logic: in RTL, ArrowLeft = next).
  - Emits `onProgress({fraction: (currentPage+1)/pageCount, label})` and `onLocationChange({fmt:"page", page, pageOffset})` (debounced).
  - Honors `fit` (width/page → scale), `zoom` multiplier, `useReducedMotion()` (no page-turn animation when reduced), touch targets ≥44px.
  - `resume` prop: on mount, scroll to `resume.page` (+ `pageOffset`).

- [ ] **Step 3: Verify (browser)** — a dev harness route renders `FixedPageViewer` with `PdfPageSource` over a bundled sample PDF; `pnpm dev` + Playwright: scroll shows pages lazily, counter updates, paged flow flips, RTL mirrors, no horizontal body scroll. Screenshot light + dark.
- [ ] **Step 4: Commit** — `feat(reader): virtualized fixed-page viewer`.

### Task A.6: `FixedPageReader` — the shared shell for fixed books

**Files:**
- Create: `src/reader/fixed/FixedPageReader.tsx`
- Read-then-reuse: `src/panels/PanelShell.tsx`, `TOCPanel.tsx`, `ProgressOverlay.tsx`, `HighlightsPanel.tsx`, `panels/SettingsPanel.tsx`.

**Interfaces:**
- Consumes: `FixedBook`, `BookState`, `Tweaks`, `FixedPageViewer` (A.5), the panels.
- Produces: `<FixedPageReader book state t setTweak layout activePanel setActivePanel resume onLocationChange onOpenFullSettings onBack />`.

- [ ] **Step 1:** Build the shell mirroring `DesktopReader`/`MobileReader` chrome (top bar: back, title, panel buttons for `toc`/`highlights`/`settings`; bottom bar: page counter [taps → `progress`], scrubber, zoom/fit) — reuse the tokens + `PanelShell`. Center = `<FixedPageViewer>`; theme restyles chrome, `fixedPageTint` restyles pages.
- [ ] **Step 2:** Feed the panels **normalized** data: build `TocEntry[]` from `book.outline`; `ReaderProgress` from the viewer; Contents `onSelect(dest)` → viewer `goTo`. For Contents/Progress, if a panel currently requires `EpubBook`-shaped props, add a normalized prop path (small edit to that panel; keep the reflow path working). Highlights panel in v1 lists **page bookmarks** only.
- [ ] **Step 3:** Wire `fixedFlow`/`fixedFit`/`fixedPageTint`/zoom to the viewer; RTL from `book.dir` (docx) / UI dir (pdf).
- [ ] **Step 4: Verify (browser harness)** — panels open/close, Contents jumps, counter opens Progress, settings gating shows fixed controls. Screenshot RTL + LTR.
- [ ] **Step 5: Commit** — `feat(reader): shared fixed-page reader shell`.

### Task A.7: App integration — discriminated `Loaded`, routing, resume, progress

**Files:**
- Modify: `src/App.tsx` — `Loaded` (49-75), `openBook` (218-262), the `AnimatedSwap` render (544-621), add page-position debounce.

- [ ] **Step 1:** Make `Loaded` a discriminated union:

```ts
type Loaded =
  | ({ fmt: "reflow"; book: EpubBook } & ReflowState)   // existing fields
  | { fmt: "fixed"; kind: "pdf" | "docx"; book: FixedBook; state: BookState;
      resume: { page: number; pageOffset: number } };
```
- [ ] **Step 2:** In `openBook`, read the index entry's `kind` (via `listBooks` cache or a `getEntry(id)` helper); for `pdf`/`docx` call `loadFixedBook(id)` and set the fixed `Loaded`; else the existing reflow path.
- [ ] **Step 3:** In the `AnimatedSwap`, when `loaded.fmt === "fixed"` render `<FixedPageReader …>` for both mobile and desktop (it's responsive); keep `viewKey` `reader-mobile`/`reader-desktop`. Pass a debounced `onLocationChange` that calls `updatePagePosition` + `updatePageProgress` (mirror `onParagraphChange`/`updateReadingPosition`).
- [ ] **Step 4:** Update the startup-resume branch (278) — it already filters `kind !== "source"`; keep it (fixed books resume fine).
- [ ] **Step 5: Verify** — `pnpm tauri dev`: open a PDF → the fixed reader shows; scroll, close, reopen → resumes the same page; library progress bar reflects page progress.
- [ ] **Step 6: Commit** — `feat(reader): route fixed-page books through the shared shell`.

### Task A.8: Settings gating (reflow vs fixed controls)

**Files:**
- Modify: `src/components/SettingsSection.tsx` — add `FixedPageControls`; export it.
- Modify: `src/panels/SettingsPanel.tsx` + `src/components/SettingsPage.tsx` — render `ReadingControls` or `FixedPageControls` based on the open book's `kind` (thread a `format: "reflow" | "fixed"` prop; SettingsPage's global context = reflow default).

- [ ] **Step 1:** Add `FixedPageControls({ theme, t, setTweak })` using the existing `Field`/`SegRow` primitives: Flow (`scroll`/`paged`), Fit (`width`/`page`), Page tint (`none`/`dim`/`invert`). Labels via new i18n keys (Task A.9).
- [ ] **Step 2:** In `SettingsPanel` (reader quick-panel), pick controls by the open book format; the fixed reader passes `format="fixed"`.
- [ ] **Step 3: Verify (browser)** — open the fixed reader's settings → font/size/etc. hidden, Flow/Fit/Tint shown; reflow reader unchanged.
- [ ] **Step 4: Commit** — `feat(settings): format-gated reading controls`.

### Task A.9: i18n keys (PDF)

**Files:**
- Modify: `src/i18n/en.ts` + `src/i18n/ar.ts` (both, in lockstep).

- [ ] **Step 1:** Add keys (both catalogs): `library.import.books` ("EPUB / PDF"), `library.badge.pdf`, `reader.page.counter` ("{n} / {total}"), `settings.fixed.flow`/`.scroll`/`.paged`, `settings.fixed.fit`/`.width`/`.page`, `settings.fixed.tint`/`.none`/`.dim`/`.invert`, `reader.outline.empty`. Arabic translations included.
- [ ] **Step 2: Verify** — `pnpm build` (the i18n catalog gate runs in build). Expected: PASS.
- [ ] **Step 3: Commit** — `feat(i18n): fixed-page reader strings (en+ar)`.

### Task A.10: Phase-A verification (PDF end-to-end)

- [ ] `pnpm build` green. `pnpm tauri dev`: import the 298-page Arabic test PDF (`~/Downloads/__السنة 1 - المجلد 1.pdf`), read it (scroll smooth over landscape spreads, no layout jump), fit/zoom, single-page flip RTL-mirrored, outline jumps, dark tint, resume, progress, mixed-folder import. Screenshot desktop + mobile, light + dark. Commit any fixes.

---

## Phase B — DOCX as fixed pages + remove the old DOCX path (shippable)

### Task B.1: DOCX → sanitized fixed-doc (HTML + images + outline)

**Files:**
- Create: `src/docx/toFixedDoc.ts` (reuses `mammoth` load + `convertImage` from the current `import.ts:192-227`, and `detectDirection.ts`).

**Interfaces:**
- Produces: `docxToFixedDoc(bytes, fallbackTitle): Promise<{ html: string; images: {href:string;bytes:Uint8Array}[]; title: string; author: string; dir: "ltr"|"rtl"; outline: TocEntry[] }>`.

- [ ] **Step 1:** mammoth → HTML with images rewritten to `images/img-NNN.ext` (adapt the existing `convertImage` to emit final hrefs directly instead of `staging://`). Detect `dir` via `detectDocDirection`. Sanitize the HTML (strip scripts/event handlers; keep structural tags + `src`). Build `outline` from `h1..h3` (assign a temporary `dest {fmt:"page",page:0}`; real page is resolved after pagination at read time — store heading anchors instead: `{ title, headingId, level }`, mapped to pages by `DocxPageSource`).
- [ ] **Step 2: Verify** — `pnpm exec tsc --noEmit`. Commit — `feat(docx): convert docx to sanitized fixed-doc html`.

### Task B.2: `importDocxBytes` + storage

**Files:** Modify `src/store/fixedImport.ts`.

- [ ] **Step 1:** `importDocxBytes(bytes, fallbackTitle)`: call `docxToFixedDoc`, write `content.html`, `images/*`, `book.json` (`DocxBook` with heading-anchor outline + `dir`), cover = first image (else generated), append index entry `kind:"docx"`, `pageCount` left 0 until first read (or compute lazily; store 0 and update on first pagination via `updatePageProgress`).
- [ ] **Step 2: Verify** — `pnpm tauri dev`: import a `.docx`, confirm files written and entry appears with DOCX badge.
- [ ] **Step 3: Commit** — `feat(library): import DOCX to fixed-page storage`.

### Task B.3: `DocxPageSource` (HTML paginator)

**Files:** Create `src/reader/fixed/DocxPageSource.ts`.

- [ ] **Step 1:** Load `content.html`, resolve `images/*` to `asset://` via `chapterImageSrcFor` (library.ts:858). Paginate into fixed page-cards using the **CSS-multicol technique from `PaginatedView.tsx`** (fixed page box = `fixedFit` width × derived height; `column-width` = page width, translate by page index) so line-breaking is clean and no reflow controls apply. `pageCount` = measured columns; `pageSize` = the fixed box; `renderPage(i, host)` mounts the windowed page. `outline` heading anchors → page via each heading element's column index. `hasTextLayer = true`.
- [ ] **Step 2:** Resume anchor: expose the nearest block id + intra-block fraction for `onLocationChange` (feeds `BookState.fixedAnchor`), and map an anchor back to a page after (re)pagination.
- [ ] **Step 3: Verify (browser harness)** — a sample docx-derived HTML paginates into page-cards; Arabic text is selectable and shapes correctly; headings jump; re-sizing the page box re-paginates and resume anchor holds.
- [ ] **Step 4: Commit** — `feat(reader): DocxPageSource html paginator`.

### Task B.4: Wire DOCX into import + reader (no manage choice)

**Files:** Modify `src/store/library.ts` (folder scan → `/\.(epub|pdf|docx)$/i`, single picker → add `docx`), `Library.tsx`/`LibrarySidebar.tsx` (the "Word doc" action now calls `importDocxBytes` directly; remove the manage/choice branch), `App.tsx`/`FixedPageReader` (docx uses `createDocxPageSource`), DOCX badge.

- [ ] **Step 1:** Route `.docx` in `pickAndImportBook` and folder scan to `importDocxBytes`; the sidebar "Word doc" entry calls it directly (no `ImportChoiceModal`).
- [ ] **Step 2:** `FixedPageReader` picks `DocxPageSource` when `book.kind === "docx"`.
- [ ] **Step 3: Verify** — `pnpm tauri dev`: import a `.docx` and read it as fixed pages in the shared shell; mixed folder (epub+pdf+docx) imports all three.
- [ ] **Step 4: Commit** — `feat(docx): read DOCX as fixed pages in the shared shell`.

### Task B.5: Remove DOCX→EPUB + curation (with leftovers)

**Files:**
- Delete: `src/docx/buildEpub.ts`, `src/docx/splitChapters.ts`, `src/docx/stage.ts`, `src/components/DocxManageView.tsx`, `src/components/ImportChoiceModal.tsx`.
- Modify: `src/store/library.ts` — remove `pickAndStageDocx` (371-430), `commitStagedDocx` (439-471), `docxToEpubBytes` usage + the `docx/import` imports (30-35); `src/docx/import.ts` — reduce to only what `toFixedDoc` reuses or delete if fully superseded; `Library.tsx`/`LibrarySidebar.tsx` — remove manage-view/choice-modal mounts + handlers; `src/i18n/en.ts`+`ar.ts` — remove the `docx`/manage/`ImportChoice` keys from both.

- [ ] **Step 1:** Delete the files; remove the imports/functions/mounts. `EditBookModal` stays (generic).
- [ ] **Step 2:** Dead-reference sweep: `git grep -n "DocxManageView\|ImportChoiceModal\|buildEpubFromStaging\|convertDocxToStaging\|docxToEpubBytes\|splitHtmlIntoChapters\|StagedDocx\|StagingEdits\|pickAndStageDocx\|commitStagedDocx"` returns nothing. Remove any now-orphaned i18n keys (build gate will flag mismatches).
- [ ] **Step 3: Verify** — `pnpm build` green (tsc + i18n gate); `pnpm tauri dev`: importing a docx no longer offers a manage step and reads as fixed pages; no console errors.
- [ ] **Step 4: Commit** — `refactor(docx): remove docx→epub conversion + curation feature`.

### Task B.6: Phase-B verification (DOCX end-to-end)

- [ ] `pnpm build` green. `pnpm tauri dev`: import a real `.docx` (with headings + images + Arabic) → fixed pages, selectable text, in-page search, outline jumps, resume; the old manage/edit flow is gone; mixed-folder import of all three formats works. Screenshot RTL + LTR, light + dark. Commit fixes.

---

## Phase C — In-page search + cross-format verification

### Task C.1: In-page search (text-layer formats)

**Files:** Modify `src/reader/fixed/FixedPageReader.tsx` (top-bar search affordance + results overlay), `PdfPageSource`/`DocxPageSource` (add `search(query): Promise<{page:number}[]>`), i18n en+ar.

- [ ] **Step 1:** Add `search(query)` to `FixedPageSource`. `DocxPageSource` searches the HTML text nodes → page indices. `PdfPageSource` searches `getTextContent()` per page (only when `hasTextLayer`). Scanned PDFs (`hasTextLayer === false`) → the search button shows a disabled/empty state (`reader.search.noTextLayer`).
- [ ] **Step 2:** Top-bar search opens a query field; results jump the viewer to the matching page via `goTo({fmt:"page",page})`. Match-highlighting within the page is out of scope for v1 (jump-to-page only).
- [ ] **Step 3: Verify** — text PDF + DOCX: search jumps to the right page; scanned PDF shows the no-text-layer state. Commit — `feat(reader): in-page search for text-layer fixed books`.

### Task C.2: Cross-format verification & polish

- [ ] EPUB still opens reflowable (regression); PDF + DOCX open the identical shell with only the viewer differing; settings gating correct per format; progress/resume correct for all; RTL + LTR chrome, all four themes, 375px + desktop. `pnpm build` green. Final commit — `test: verify fixed-layout reading across formats`.

---

## Notes for the executor

- Follow existing patterns: module-level store fns (no React in `store/`), `useSyncExternalStore` for shared reactive state, logical CSS props for RTL, tokens for color/motion, i18n keys in both catalogs.
- Keep files focused: `src/reader/fixed/` holds the fixed-page viewer/shell/sources; `src/pdf/` holds pdf.js glue; `src/docx/toFixedDoc.ts` is the only surviving DOCX transform.
- The browser harness (a temporary dev-only route/flag rendering `FixedPageViewer` over a bundled sample) is the fastest loop for the pure-UI tasks; delete it before the phase's final commit or guard it behind `import.meta.env.DEV`.
