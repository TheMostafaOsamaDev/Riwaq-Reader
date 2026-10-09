// A text selection on fixed-layout pages (PDF / DOCX), turned into the
// highlights it should become — and, on the phone, where a finger is in the
// text.
//
// Both readers' selections end up here as a plain DOM Range: the desktop's
// comes from `window.getSelection()`, the phone's is built by hand from a
// long-press (see FixedPageViewer). A Range may cross page and block
// boundaries freely, so it is cut into one part per PDF page or DOCX block,
// each anchored the way that format stores a highlight. The parts are saved as
// one group, exactly as a multi-paragraph EPUB selection is, and delete
// together. Selecting across a page break used to produce nothing at all.

import type {
  DocxHighlightAnchor,
  PdfHighlightAnchor,
} from "../../store/library";
import { charOffsetInBlock } from "./docxHighlight";
import { mergeRects } from "./pdfHighlight";
import {
  caretFromPoint,
  pointInside,
  type TextEndpoint,
} from "../selection/textCaret";

export interface FixedSelectionPart {
  text: string;
  fixed: DocxHighlightAnchor | PdfHighlightAnchor;
}

/** A pending selection: what to copy, where to put the toolbar, and the
 *  highlights it becomes. */
export interface FixedSelection {
  text: string;
  /** Viewport-coordinate box of the whole selection. */
  rect: DOMRect;
  parts: FixedSelectionPart[];
}

/** The part of `range` inside `el`, or null when they do not overlap. */
export function clipRange(range: Range, el: Node): Range | null {
  if (!range.intersectsNode(el)) return null;
  const r = document.createRange();
  r.selectNodeContents(el);
  if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0)
    r.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0)
    r.setEnd(range.endContainer, range.endOffset);
  return r.collapsed ? null : r;
}

/** One part per PDF page the range touches: the page plus the rectangles it
 *  covers, normalized to the page box. */
function pdfParts(range: Range, root: HTMLElement): FixedSelectionPart[] {
  const parts: FixedSelectionPart[] = [];
  for (const wrap of root.querySelectorAll<HTMLElement>("[data-page-index]")) {
    // Clipped to the TEXT layer: the marks layer beside it holds no text,
    // and the canvas none either.
    const layer = wrap.querySelector(".textLayer");
    const sub = layer ? clipRange(range, layer) : null;
    if (!sub) continue;
    const text = sub.toString();
    if (!text.trim()) continue;
    const page = Number(wrap.getAttribute("data-page-index"));
    const box = wrap.getBoundingClientRect();
    if (!Number.isFinite(page) || box.width <= 0 || box.height <= 0) continue;
    const rects = mergeRects(
      Array.from(sub.getClientRects(), (r) => ({
        x: (r.left - box.left) / box.width,
        y: (r.top - box.top) / box.height,
        w: r.width / box.width,
        h: r.height / box.height,
      })),
    );
    if (rects.length === 0) continue;
    parts.push({ text, fixed: { fmt: "pdf", page, rects } });
  }
  return parts;
}

/** One part per DOCX block the range touches: the block id plus a char range
 *  into its text. */
function docxParts(range: Range, root: HTMLElement): FixedSelectionPart[] {
  const parts: FixedSelectionPart[] = [];
  for (const block of root.querySelectorAll<HTMLElement>("[data-block-id]")) {
    const sub = clipRange(range, block);
    if (!sub) continue;
    const text = sub.toString();
    if (!text.trim()) continue;
    const blockId = block.getAttribute("data-block-id");
    if (!blockId) continue;
    const a = charOffsetInBlock(block, sub.startContainer, sub.startOffset);
    const b = charOffsetInBlock(block, sub.endContainer, sub.endOffset);
    const charStart = Math.min(a, b);
    const charEnd = Math.max(a, b);
    if (charEnd <= charStart) continue;
    parts.push({ text, fixed: { fmt: "docx", blockId, charStart, charEnd } });
  }
  return parts;
}

/** The selection `range` makes inside `root`, or null if it selects nothing
 *  that can be highlighted. */
export function selectionFromRange(
  range: Range,
  root: HTMLElement,
  kind: "pdf" | "docx",
): FixedSelection | null {
  if (range.collapsed) return null;
  if (!root.contains(range.commonAncestorContainer)) return null;
  const parts = kind === "pdf" ? pdfParts(range, root) : docxParts(range, root);
  if (parts.length === 0) return null;
  return {
    text: range.toString(),
    rect: range.getBoundingClientRect(),
    parts,
  };
}

/** The live window selection as a FixedSelection — the desktop path. */
export function selectionFromWindow(
  root: HTMLElement,
  kind: "pdf" | "docx",
): FixedSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  return selectionFromRange(sel.getRangeAt(0), root, kind);
}

// ── Where a finger is in the text (phone) ──────────────────────────────────

/** The pieces of text a caret can land in: pdf.js's text-run spans, or a
 *  DOCX page's blocks. Only those in a page the viewer has on screen — the
 *  warm and peek hosts hold pages too, and none of their text is touchable. */
function textUnits(page: HTMLElement, kind: "pdf" | "docx"): HTMLElement[] {
  const sel =
    kind === "pdf"
      ? ".textLayer span:not(.markedContent):not([role='img'])"
      : "[data-block-id]";
  return Array.from(page.querySelectorAll<HTMLElement>(sel)).filter(
    (el) => (el.textContent ?? "").trim().length > 0,
  );
}

/** Squared distance from a point to a box, with vertical distance counting
 *  double — a finger between two lines belongs to the nearer LINE far more
 *  than to whatever is nearest sideways. */
function distanceTo(r: DOMRect, x: number, y: number): number {
  const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
  const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
  return dx * dx + 4 * dy * dy;
}

/** The on-screen page host nearest to `y`. */
function pageAt(hosts: HTMLElement[], y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  for (const h of hosts) {
    const r = h.getBoundingClientRect();
    if (r.height <= 0) continue;
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

/** First or last text position inside `el`. */
function edgeOf(el: HTMLElement, which: "first" | "last"): TextEndpoint | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let first: Text | null = null;
  let last: Text | null = null;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!(t as Text).data.length) continue;
    if (!first) first = t as Text;
    last = t as Text;
  }
  if (which === "first") return first ? { node: first, offset: 0 } : null;
  return last ? { node: last, offset: last.data.length } : null;
}

/**
 * The text position nearest a viewport point, on the page under it.
 *
 * The fixed-page counterpart of textCaret's `caretInBody`, which assumes one
 * column of paragraphs top to bottom. A PDF page is a scatter of text runs —
 * several to a line, columns, captions — so the nearest run is found by
 * distance instead, and the point moved inside it before the browser is asked
 * which character it is on. A point the browser still resolves outside that
 * run takes the run's nearer end.
 *
 * `reach` caps how far from any text the point may be: a long-press on a
 * margin or a picture is not a request to select the nearest word.
 */
export function caretNear(
  hosts: HTMLElement[],
  kind: "pdf" | "docx",
  x: number,
  y: number,
  reach = Infinity,
): TextEndpoint | null {
  const page = pageAt(hosts, y);
  if (!page) return null;
  let unit: HTMLElement | null = null;
  let box: DOMRect | null = null;
  let bestD = Infinity;
  for (const el of textUnits(page, kind)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const d = distanceTo(r, x, y);
    if (d < bestD) {
      bestD = d;
      unit = el;
      box = r;
    }
  }
  if (!unit || !box || bestD > reach * reach) return null;
  const p = pointInside(box, x, y);
  const hit = caretFromPoint(p.x, p.y);
  if (hit && unit.contains(hit.node)) return hit;
  // Which end: for a DOCX block (many lines) the half it is in; for a PDF run
  // (one line) the side, mirrored for a right-to-left run.
  let before: boolean;
  if (kind === "docx") before = y < (box.top + box.bottom) / 2;
  else {
    const mid = (box.left + box.right) / 2;
    before = getComputedStyle(unit).direction === "rtl" ? x > mid : x < mid;
  }
  return edgeOf(unit, before ? "first" : "last");
}

/** True if `a` lies strictly before `b` in document order. */
export function comesBefore(a: TextEndpoint, b: TextEndpoint): boolean {
  if (a.node === b.node) return a.offset < b.offset;
  return !!(
    a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING
  );
}

/** A Range between two endpoints, whichever order they come in. */
export function orderedRange(a: TextEndpoint, b: TextEndpoint): Range {
  const range = document.createRange();
  const [s, e] = comesBefore(b, a) ? [b, a] : [a, b];
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  return range;
}
