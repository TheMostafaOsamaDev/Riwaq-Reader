// DOM-coupled helpers for PDF highlighting — the counterpart to docxHighlight.ts.
//
// A PDF page is a bitmap, so a highlight cannot be a `<mark>` wrapped around
// text the way it is for DOCX. It is stored instead as the page number plus the
// rectangles the selection covered, normalized to the page box (0..1 on each
// axis) so they survive zoom, a window resize and a fit-mode change without
// re-anchoring. Painting them back is PdfPageSource's job; capturing them is
// fixedSelection.ts's, with the rect merging here.

import type { NormRect } from "../../store/library";

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

/** Which link, if any, sits under a viewport point — found the same way as a
 *  highlight, for the same reason: the link areas are `pointer-events: none`
 *  so they never stand between a finger and the text it wants to select. */
export function pdfLinkAt(
  x: number,
  y: number,
): { page?: number; url?: string } | null {
  const wrap = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
    "[data-page-index]",
  );
  if (!wrap) return null;
  for (const el of wrap.querySelectorAll<HTMLElement>("[data-pdf-link]")) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const page = el.getAttribute("data-link-page");
      const url = el.getAttribute("data-link-url");
      if (page != null) return { page: Number(page) };
      if (url) return { url };
    }
  }
  return null;
}
