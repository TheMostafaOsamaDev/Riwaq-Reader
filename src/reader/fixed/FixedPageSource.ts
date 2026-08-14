import type { TocEntry } from "../../types/reader";

/**
 * Abstracts the two fixed-layout page sources — PDF (pdf.js canvas) and DOCX
 * (paginated HTML) — behind one interface so `FixedPageViewer` renders either
 * without caring which. Pages are 0-based.
 */
export interface FixedPageSource {
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
  destroy(): void;
}
