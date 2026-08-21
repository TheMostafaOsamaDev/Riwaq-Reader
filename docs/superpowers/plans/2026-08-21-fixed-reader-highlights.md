# Fixed-Reader Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user text-highlighting to the fixed-layout reader (DOCX and PDF), matching the EPUB reader's create / render / panel / notes behavior.

**Architecture:** Reuse the EPUB highlight store, colors, `SelectionPopover`, and `HighlightsPanel`. Do NOT change the reflow highlight data model. Add an optional discriminated `fixed?` anchor to `Highlight`: DOCX anchors by stable block-id + intra-block char range (survives re-pagination); PDF anchors by page + rectangles normalized 0..1 to page size (survives zoom). Selection is captured in `FixedPageViewer`; DOCX renders `<mark>` into its DOM cards, PDF draws translucent rects over a newly-added pdf.js text layer.

**Tech Stack:** React 19, TypeScript, Vite, Tauri v2, pdfjs-dist 4.7, mammoth (DOCX→HTML). Tests: Vitest (pure logic only; DOM-coupled parts verified live on the Android emulator / browser).

**Spec:** Embedded below (design captured in the 2026-08-21 brainstorming session; no separate spec file).

## Global Constraints

- Reflow (EPUB) highlight pipeline MUST remain byte-for-byte behaviorally unchanged — the `fixed` anchor is additive and optional; reflow highlights never set it.
- All new user-facing strings go through i18n (`src/i18n/en.ts` + `ar.ts`, identical key sets — `Messages = Record<MsgKey,string>` enforces parity).
- Highlight colors reuse the existing 4: `yellow | blue | pink | green` (`HIGHLIGHT_COLORS`, `hlBg`).
- Branch: `feat/fixed-highlights` (NOT folded into `feat/reading-colors`).
- No pixel-reprocessing regressions to the PDF duotone: the text layer and highlight rects sit in their own overlay, `pointer-events` managed so page-turn edge zones still work in paged flow.

---

## Anchor model (the core type change)

`src/store/library.ts` — add to `Highlight` (keep all existing reflow fields untouched):

```ts
/** Fixed-layout (PDF/DOCX) anchor. When present, this highlight belongs to a
 *  fixed book and the reflow fields (chapter/paragraphIndex/charStart/charEnd)
 *  are unused (0). Absent on every reflow highlight. */
fixed?: DocxHighlightAnchor | PdfHighlightAnchor;
```
```ts
export interface DocxHighlightAnchor {
  fmt: "docx";
  blockId: string;   // matches data-block-id stamped on the DOCX block
  charStart: number; // inclusive char offset within the block's text content
  charEnd: number;   // exclusive
}
export interface NormRect { x: number; y: number; w: number; h: number } // 0..1 of page box
export interface PdfHighlightAnchor {
  fmt: "pdf";
  page: number;      // 0-based
  rects: NormRect[]; // union of client rects for the selection, page-normalized
}
```

---

## File Structure

- `src/reader/fixed/highlightAnchors.ts` *(new)* — pure helpers: mark-segment splitting, PDF rect normalize/denormalize. Unit-tested.
- `src/reader/fixed/highlightAnchors.test.ts` *(new)* — Vitest.
- `src/store/library.ts` *(modify)* — `Highlight.fixed`, anchor types. `saveHighlight` already accepts a full `Highlight`; extend the create signature to carry `fixed`.
- `src/reader/fixed/DocxPageSource.ts` *(modify)* — stamp `data-block-id` on every block; accept a highlights getter; inject `<mark>` in `renderPage`.
- `src/reader/fixed/FixedPageViewer.tsx` *(modify)* — selection capture on the scroll container; DOCX anchor resolution; expose selection to the reader shell; render PDF highlight rects + text layer overlay.
- `src/reader/fixed/PdfPageSource.ts` + `src/pdf/pdfjs.ts` *(modify, Phase 2)* — render a pdf.js text layer into the host.
- `src/reader/fixed/FixedPageReader.tsx` *(modify)* — accept highlight callbacks + `highlights`; add `"highlights"` to `Panel`; mount real `HighlightsPanel` + `SelectionPopover`; drop the empty stub.
- `src/App.tsx` *(modify)* — pass `onCreateHighlight`/`onDeleteHighlight`/`onUpdateHighlightNote`/`onJumpToHighlight` + `state.highlights` to `FixedPageReader` (mirror the EPUB wiring at `App.tsx:713-747`).
- `src/panels/HighlightsPanel.tsx` *(modify)* — jump handler branches on `fixed` anchor (page jump for fixed vs chapter/paragraph for reflow).
- `src/i18n/en.ts` + `ar.ts` *(modify)* — any new strings (e.g. "No selectable text in this PDF").

---

## Phase 0 — Shared foundation & wiring

### Task 0.1: Anchor types on `Highlight`

**Files:**
- Modify: `src/store/library.ts` (Highlight interface ~117-141)

**Interfaces:**
- Produces: `Highlight.fixed?`, `DocxHighlightAnchor`, `PdfHighlightAnchor`, `NormRect` (exact shapes above).

- [ ] **Step 1:** Add the three exported interfaces + the optional `fixed?` field to `Highlight` (code in the Anchor-model section above).
- [ ] **Step 2:** `pnpm exec tsc --noEmit` → Expected: PASS (additive optional field; no existing call sites break).
- [ ] **Step 3:** Commit `feat(highlights): add fixed-layout highlight anchor types`.

### Task 0.2: Pure mark-splitting helper (TDD)

Factor the `<mark>`-slicing logic (currently inline in `BookBody.renderParagraph`, `BookBody.tsx:273-321`) into a reusable pure function so DOCX render-back reuses it.

**Files:**
- Create: `src/reader/fixed/highlightAnchors.ts`
- Test: `src/reader/fixed/highlightAnchors.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MarkRange { id: string; charStart: number; charEnd: number; color: HighlightColor }
  export type MarkSegment =
    | { kind: "text"; text: string }
    | { kind: "mark"; text: string; id: string; color: HighlightColor };
  export function splitIntoMarkSegments(text: string, ranges: MarkRange[]): MarkSegment[];
  ```

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { splitIntoMarkSegments } from "./highlightAnchors";

describe("splitIntoMarkSegments", () => {
  it("returns a single text segment when there are no ranges", () => {
    expect(splitIntoMarkSegments("hello world", [])).toEqual([
      { kind: "text", text: "hello world" },
    ]);
  });
  it("wraps a mid-string range and keeps the surrounding text", () => {
    expect(
      splitIntoMarkSegments("hello world", [
        { id: "a", charStart: 6, charEnd: 11, color: "yellow" },
      ]),
    ).toEqual([
      { kind: "text", text: "hello " },
      { kind: "mark", text: "world", id: "a", color: "yellow" },
    ]);
  });
  it("clamps out-of-range offsets to the text length", () => {
    expect(
      splitIntoMarkSegments("hi", [{ id: "a", charStart: 0, charEnd: 99, color: "blue" }]),
    ).toEqual([{ kind: "mark", text: "hi", id: "a", color: "blue" }]);
  });
  it("orders overlapping ranges by start; later wins the overlap", () => {
    const segs = splitIntoMarkSegments("abcdef", [
      { id: "a", charStart: 0, charEnd: 3, color: "yellow" },
      { id: "b", charStart: 2, charEnd: 5, color: "green" },
    ]);
    expect(segs.map((s) => s.kind === "mark" && s.id)).toContain("a");
    expect(segs.map((s) => s.kind === "mark" && s.id)).toContain("b");
    expect(segs.reduce((n, s) => n + s.text.length, 0)).toBe(6);
  });
});
```
- [ ] **Step 2:** `pnpm exec vitest run src/reader/fixed/highlightAnchors.test.ts` → Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `splitIntoMarkSegments` (port the sorting + cursor-walk from `renderParagraph`, emitting data instead of JSX; conserve total text length; later range wins overlaps).
- [ ] **Step 4:** Re-run test → Expected: PASS.
- [ ] **Step 5:** Refactor `BookBody.renderParagraph` to consume `splitIntoMarkSegments` (map segments → `<mark>`/string), keeping its existing styling. `pnpm exec tsc --noEmit` + manual: reflow highlights still render (verify live). 
- [ ] **Step 6:** Commit `feat(highlights): extract shared mark-splitting helper`.

### Task 0.3: PDF rect normalize/denormalize (TDD)

**Files:**
- Modify: `src/reader/fixed/highlightAnchors.ts`
- Modify: `src/reader/fixed/highlightAnchors.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function normalizeRect(r: {x:number;y:number;w:number;h:number}, pageW: number, pageH: number): NormRect;
  export function denormalizeRect(n: NormRect, pageW: number, pageH: number): {x:number;y:number;w:number;h:number};
  ```

- [ ] **Step 1: Failing test**
```ts
import { normalizeRect, denormalizeRect } from "./highlightAnchors";
describe("rect normalization", () => {
  it("normalizes page-px rects to 0..1 fractions", () => {
    expect(normalizeRect({ x: 50, y: 100, w: 200, h: 20 }, 500, 1000)).toEqual({
      x: 0.1, y: 0.1, w: 0.4, h: 0.02,
    });
  });
  it("round-trips through denormalize at a different scale", () => {
    const n = normalizeRect({ x: 50, y: 100, w: 200, h: 20 }, 500, 1000);
    expect(denormalizeRect(n, 1000, 2000)).toEqual({ x: 100, y: 200, w: 400, h: 40 });
  });
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (divide/multiply by page dims). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(highlights): pdf rect normalization helpers`.

### Task 0.4: Wire highlight callbacks into the fixed reader (no UI yet)

**Files:**
- Modify: `src/App.tsx` (fixed-reader mount ~689-710; reuse the existing `createHighlight`/`deleteHighlight`/`updateHighlightNote`/`jumpToHighlight` handlers already defined for EPUB ~726-747)
- Modify: `src/reader/fixed/FixedPageReader.tsx` (`FixedPageReaderProps` ~41-59; `Panel` union ~39)

**Interfaces:**
- Produces on `FixedPageReaderProps`: `highlights: Highlight[]`, `onCreateHighlight(h: NewFixedHighlight)`, `onDeleteHighlight(id, groupId?)`, `onUpdateHighlightNote(id, note)`, `onJumpToHighlight(h)`. Add `"highlights"` to `Panel`.
- Consumes: App's existing highlight handlers.

- [ ] **Step 1:** Extend `FixedPageReaderProps` + `Panel` union; accept the new props (default no-ops not needed — required, App always passes them).
- [ ] **Step 2:** In `App.tsx`, pass `state.highlights` + the four handlers to `<FixedPageReader>` (same objects EPUB uses; `createHighlight` must accept an optional `fixed` anchor — extend its param type).
- [ ] **Step 3:** `pnpm exec tsc --noEmit` → PASS.
- [ ] **Step 4:** Commit `feat(highlights): thread highlight callbacks into fixed reader`.

### Task 0.5: Replace the empty stub with the real HighlightsPanel

**Files:**
- Modify: `src/reader/fixed/FixedPageReader.tsx` (the nav button ~186 + panel body stub ~188-192)
- Modify: `src/panels/HighlightsPanel.tsx` (jump handler)

- [ ] **Step 1:** Mount `<HighlightsPanel>` when `panel === "highlights"`, fed `highlights` (filtered to `fixed` ones for this book) + `onDeleteHighlight`/`onUpdateHighlightNote`/`onJumpToHighlight`. Remove the hardcoded "No bookmarks yet." placeholder.
- [ ] **Step 2:** In `HighlightsPanel`, branch the jump: if `h.fixed` → call the fixed jump (viewer `goToPage(h.fixed.page)` for PDF, or page containing `blockId` for DOCX); else existing reflow jump. (DOCX page lookup: `DocxPageSource` exposes `pageForBlock(blockId)`.)
- [ ] **Step 3:** `tsc` PASS. Live-verify the panel opens empty (no more mislabeled stub). Commit `feat(highlights): real highlights panel in fixed reader`.

---

## Phase 1 — DOCX highlighting (end-to-end slice)

### Task 1.1: Stamp stable block ids on DOCX blocks

**Files:**
- Modify: `src/reader/fixed/DocxPageSource.ts` (pagination/measure ~80-103; `renderPage` ~118-134)

**Interfaces:**
- Produces: every top-level block clone carries `data-block-id="b<n>"` (stable across re-pagination — assigned once at parse, before pagination). `pageForBlock(blockId: string): number` on the source. `blockText(blockId): string` (the block's `textContent`) for offset math.

- [ ] **Step 1:** During parse (before measuring), assign each block element a `data-block-id`. Record `blockId → pageIndex` as blocks are bucketed into pages; expose `pageForBlock`.
- [ ] **Step 2:** Verify pagination unaffected (page counts identical) — live-check a DOCX renders the same. Commit `feat(highlights): stable block ids for docx`.

### Task 1.2: DOCX selection capture + anchor resolution

**Files:**
- Modify: `src/reader/fixed/FixedPageViewer.tsx` (add a document/scroll-container `pointerup` listener, active only when `source.kind === "docx"`)

**Interfaces:**
- Produces: on a completed selection, computes `{ blockId, charStart, charEnd, text, rect }` by walking `window.getSelection()` range endpoints up to the nearest `[data-block-id]` and summing text length before the offset (adapt `charOffsetWithin` from `src/lib/selectionAnchor.ts:42`). Emits it to the reader shell via an `onSelect` prop (mirrors DesktopReader's `selAnchor` state).

- [ ] **Step 1:** Add the listener; resolve single-block selections first (multi-block deferred to Phase 3). Guard: ignore collapsed/empty selections.
- [ ] **Step 2:** Live-verify on the emulator: selecting DOCX text logs a correct `{blockId, charStart, charEnd, text}`. Commit `feat(highlights): docx selection anchor resolution`.

### Task 1.3: SelectionPopover → create DOCX highlight

**Files:**
- Modify: `src/reader/fixed/FixedPageReader.tsx` (render `<SelectionPopover>` anchored on the selection rect; on color pick call `onCreateHighlight({ text, color, fixed: { fmt:"docx", blockId, charStart, charEnd } })`)

- [ ] **Step 1:** Wire popover + create. After create, clear the selection.
- [ ] **Step 2:** Live-verify: pick a color → a highlight is persisted (appears in the Highlights panel). Commit `feat(highlights): create docx highlights from selection`.

### Task 1.4: Render `<mark>` back onto DOCX cards

**Files:**
- Modify: `src/reader/fixed/DocxPageSource.ts` (`renderPage`; accept a `getHighlights(): Highlight[]` callback set by the viewer)

- [ ] **Step 1:** In `renderPage`, for each block with a matching-`blockId` DOCX highlight, walk the block's text nodes and wrap the `[charStart,charEnd)` range using `splitIntoMarkSegments` → `<mark data-h-id=... style="background:hlBg(color)">`. Re-render the visible pages when `highlights` changes (viewer bumps a render key).
- [ ] **Step 2:** Click on a `<mark>` (via the existing `dataset.hId` path in the viewer) opens the edit/delete popover.
- [ ] **Step 3:** Live-verify full loop: select → highlight → see the mark → reopen → delete. Commit `feat(highlights): render docx highlights`.

### Task 1.5: DOCX checkpoint

- [ ] Live-verify on emulator + browser: create (all 4 colors), persist across app relaunch, jump from panel, edit note, delete (single). RTL DOCX sanity check.
- [ ] **STOP — review checkpoint with the user before Phase 2 (PDF).**

---

## Phase 2 — PDF highlighting (OUTLINE — expand into full tasks after the Phase 1 checkpoint)

Rendering a pdf.js text layer is the load-bearing new capability; detailing it now would front-run what we learn in Phase 1. High-level tasks:

- **2.1 Render a pdf.js text layer** over each canvas host: `page.getTextContent()` → build positioned transparent spans (pdf.js `TextLayer`/`renderTextLayer`) sized to the same viewport scale as the canvas; layered above the canvas, below the duotone overlays, `user-select: text`. Gate on `hasTextLayer`. This also unlocks in-page search later.
- **2.2 PDF selection → anchor:** on `pointerup`, map `range.getClientRects()` into page-box coordinates, `normalizeRect` each, dedupe/merge lines → `PdfHighlightAnchor { page, rects }` + `text`.
- **2.3 Create + render highlight rects:** draw translucent `hlBg`-colored divs (`denormalizeRect` × current display size) in a per-page highlight overlay; click a rect → edit/delete popover.
- **2.4 Zoom/RTL/paged-flow:** rects follow zoom via normalization; ensure the text layer + overlays don't block paged-turn edge zones (pointer-events tuned).
- **2.5 Scanned PDFs:** when `hasTextLayer === false`, no selection; show a one-line i18n note in the highlights panel ("This PDF has no selectable text").

## Phase 3 — Polish (OUTLINE)

- Multi-block (DOCX) / multi-page (PDF) selections sharing a `groupId` (mirror EPUB's group-delete).
- Persistence round-trip tests; anchor-resolution edge cases.
- Final `/code-review` + `pnpm build`.

---

## Self-Review notes

- **Spec coverage:** DOCX end-to-end = Phase 1; PDF = Phase 2; panel/wiring/stub-fix = Phase 0; both anchor kinds = Task 0.1. Colors/notes/persistence reuse EPUB store — covered by wiring (0.4/0.5).
- **Reflow safety:** only additive change to reflow is Task 0.2 Step 5 (refactor `renderParagraph` onto the shared helper) — guarded by keeping reflow highlight rendering visually identical and re-verifying live.
- **Type consistency:** `fixed` anchor shape, `NormRect`, `MarkRange`/`MarkSegment`, `pageForBlock`, `splitIntoMarkSegments`, `normalizeRect`/`denormalizeRect` are used consistently across tasks.
