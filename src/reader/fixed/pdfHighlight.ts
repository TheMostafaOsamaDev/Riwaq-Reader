// DOM-coupled helpers for PDF highlighting — the counterpart to docxHighlight.ts.
//
// A PDF page is a bitmap, so a highlight cannot be a `<mark>` wrapped around
// text the way it is for DOCX. It is stored instead as the page number plus the
// rectangles the selection covered, normalized to the page box (0..1 on each
// axis) so they survive zoom, a window resize and a fit-mode change without
// re-anchoring. Painting them back is PdfPageSource's job; capturing them is
// this file's.

import type { NormRect } from "../../store/library";

/** Nearest ancestor that is a rendered PDF page (see PdfPageSource). */
function pageWrapOf(node: Node | null): HTMLElement | null {
  let el: Element | null =
    node && node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node?.parentElement ?? null);
  while (el) {
    if (el instanceof HTMLElement && el.hasAttribute("data-page-index")) return el;
    el = el.parentElement;
  }
  return null;
}

export interface PdfSelectionAnchor {
  page: number;
  rects: NormRect[];
  text: string;
  /** Viewport-coordinate rect of the selection, for popover placement. */
  rect: DOMRect;
}

/** Two rects are on the same line when their vertical centres sit within half a
 *  line height of each other. Comparing tops alone splits a line wherever a
 *  superscript or a different font size shifts the box. */
function sameLine(a: NormRect, b: NormRect): boolean {
  const ca = a.y + a.h / 2;
  const cb = b.y + b.h / 2;
  return Math.abs(ca - cb) < Math.max(a.h, b.h) * 0.5;
}

/** Largest horizontal gap, as a fraction of page width, still treated as "these
 *  are the same run of text". Wide enough to swallow the space between two
 *  adjacent text spans, narrow enough to leave a column gutter alone. */
const GAP = 0.012;

/** Collapse the many small rects a text selection produces — pdf.js emits one
 *  span per text run, so a single selected line can arrive as a dozen boxes —
 *  into one band per line.
 *
 *  Runs are merged only when they are on the same line AND horizontally
 *  adjacent, so a selection spanning two columns keeps a gap between them
 *  instead of painting a bar across the gutter.
 *
 *  Exported for tests. */
export function mergeRects(rects: readonly NormRect[]): NormRect[] {
  const usable = rects.filter((r) => r.w > 0 && r.h > 0);
  if (usable.length === 0) return [];
  // Reading order: down the page, then across each line.
  const sorted = [...usable].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: NormRect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && sameLine(last, r) && r.x <= last.x + last.w + GAP) {
      // Union, not append: overlapping runs are common where a span ends and
      // the next begins mid-glyph.
      const right = Math.max(last.x + last.w, r.x + r.w);
      const top = Math.min(last.y, r.y);
      const bottom = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x);
      last.w = right - last.x;
      last.y = top;
      last.h = bottom - top;
      continue;
    }
    out.push({ ...r });
  }
  return out;
}

/** Resolve the current window selection to a single-page PDF anchor, or null if
 *  there is no usable selection (collapsed, outside `root`, or spanning more
 *  than one page — multi-page is deferred, matching the DOCX single-block
 *  rule). */
export function resolvePdfSelection(root: HTMLElement): PdfSelectionAnchor | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }
  const wrap = pageWrapOf(range.startContainer);
  if (!wrap || wrap !== pageWrapOf(range.endContainer)) return null;
  const page = Number(wrap.getAttribute("data-page-index"));
  if (!Number.isFinite(page)) return null;
  const box = wrap.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const rects = mergeRects(
    Array.from(range.getClientRects(), (r) => ({
      x: (r.left - box.left) / box.width,
      y: (r.top - box.top) / box.height,
      w: r.width / box.width,
      h: r.height / box.height,
    })),
  );
  if (rects.length === 0) return null;
  return { page, rects, text, rect: range.getBoundingClientRect() };
}

/** Which highlight, if any, sits under a viewport point.
 *
 *  A hit test rather than a DOM `closest()`: the painted marks live UNDER the
 *  text layer and are `pointer-events: none`, because letting them take the
 *  pointer would make already-highlighted text the one text on the page you
 *  could not select. So the click lands on a text span, and the mark it
 *  overlaps has to be found geometrically. */
export function pdfHighlightAt(
  x: number,
  y: number,
): { id: string; rect: DOMRect } | null {
  const wrap = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
    "[data-page-index]",
  );
  if (!wrap) return null;
  for (const el of wrap.querySelectorAll<HTMLElement>("[data-h-id]")) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const id = el.getAttribute("data-h-id");
      if (id) return { id, rect: r };
    }
  }
  return null;
}
