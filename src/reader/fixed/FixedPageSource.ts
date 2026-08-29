import type { TocEntry } from "../../types/reader";
import type { Highlight } from "../../store/library";
import type { ThemeKey } from "../../styles/tokens";

/**
 * Abstracts the two fixed-layout page sources — PDF (pdf.js canvas) and DOCX
 * (paginated HTML) — behind one interface so `FixedPageViewer` renders either
 * without caring which. Pages are 0-based.
 */
export interface FixedPageSource {
  /** Which backend this is. Drives how reading colors are applied: DOCX cards
   *  take real CSS `color`/`background` (crisp), PDF canvases get a GPU
   *  duotone approximation. */
  kind: "pdf" | "docx";
  pageCount: number;
  outline: TocEntry[];
  /** True when pages carry selectable text (enables selection / in-page search). */
  hasTextLayer: boolean;
  /** Intrinsic page size (CSS px) at scale 1 — used to reserve height so the
   *  scroll view doesn't jump as pages render (no layout shift). */
  pageSize(i: number): Promise<{ w: number; h: number }>;
  /** Mount page `i` into `host` at `scale`. A <canvas> for PDF, a DOM subtree
   *  for DOCX. The viewer owns `host`; the source owns its contents.
   *
   *  Must leave something in `host` SYNCHRONOUSLY (before its first `await`),
   *  even if the pixels arrive later — the viewer treats an empty host as "this
   *  page needs rendering" and would otherwise ask again every frame. */
  renderPage(i: number, host: HTMLElement, scale: number): Promise<void>;
  /** The pages the viewer currently has mounted. A source that caches page
   *  bitmaps must not evict any of these: dropping one out of a live host
   *  leaves a blank page sitting on screen. Called whenever the set changes. */
  retain?(pages: readonly number[]): void;
  /** DOCX only — the page a block id currently lives on, for jumping to a
   *  highlight. Undefined for PDF (highlights carry their own page). */
  pageForBlock?(blockId: string): number | undefined;
  /** Give the source the current highlights + theme so it can show them.
   *
   *  How each backend uses it differs. DOCX weaves `<mark>` spans into the text
   *  during `renderPage`, so the viewer must force a re-render afterwards. PDF
   *  paints an overlay above the bitmap and updates it in place, so the call
   *  alone is enough. */
  setHighlights?(highlights: Highlight[], themeKey: ThemeKey): void;
  /** PDF only — whether the selectable text layer takes the pointer. The
   *  viewer turns it off in paged mode, where a horizontal drag is a page turn
   *  and would otherwise start a text selection instead. */
  setSelectable?(on: boolean): void;
  destroy(): void;
}
