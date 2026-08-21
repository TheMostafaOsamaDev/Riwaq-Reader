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
   *  for DOCX. The viewer owns `host`; the source owns its contents. */
  renderPage(i: number, host: HTMLElement, scale: number): Promise<void>;
  /** DOCX only — the page a block id currently lives on, for jumping to a
   *  highlight. Undefined for PDF (highlights carry their own page). */
  pageForBlock?(blockId: string): number | undefined;
  /** DOCX only — give the source the current highlights + theme so `renderPage`
   *  can inject `<mark>` spans. The viewer calls this then re-renders. */
  setHighlights?(highlights: Highlight[], themeKey: ThemeKey): void;
  destroy(): void;
}
