/**
 * Where a finger is in the text, for the phone reader's own selection.
 *
 * The phone reader draws its own selection (native selection would raise
 * Android's toolbar, which some skins will not let us suppress), so it has to
 * answer "which character is under this point" itself. The browser's
 * `caretRangeFromPoint` answers it for points ON text. The trouble is every
 * other point, and a dragging finger is on one of those half the time:
 *
 *   - In the gap between two paragraphs (their `margin`), the hit test lands
 *     on the column itself and the browser picks a position by its own rules.
 *     In practice that is the START of the next paragraph. A reader dragging
 *     to the end of a paragraph had the selection leap into the next one the
 *     moment their finger crossed the last line's foot.
 *   - Under a handle's dot. The end handle's dot hangs below the line, so the
 *     finger holding it is a whole line lower than the caret it moves. Asked
 *     "what is under the finger", the browser answered with the next line —
 *     or, on a paragraph's last line, the next paragraph.
 *
 * So the point is first moved onto text: into the paragraph it is nearest,
 * and inside that paragraph's box. Only then is the browser asked.
 *
 * The geometry is pure (plain rects in, numbers out) so it is testable without
 * layout; the DOM half is the thin `caretInBody`.
 */

export interface TextEndpoint {
  node: Text;
  offset: number;
}

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Index of the paragraph a vertical position belongs to.
 *
 *  Inside a paragraph, that one. In the gap between two, whichever edge is
 *  nearer — so the selection crosses into the next paragraph only once the
 *  finger is past the middle of the gap, not the instant it leaves a line.
 *  Above the first or below the last, the end one.
 *
 *  Boxes are asked for by index, in document order — which for a single
 *  column is also top to bottom — and only the few the search visits: a
 *  chapter runs to hundreds of paragraphs, this runs per pointermove, and
 *  each box is a layout read. -1 only for an empty list. */
export function paragraphAt(
  count: number,
  boxAt: (i: number) => Box,
  y: number,
): number {
  if (count === 0) return -1;
  // Binary search for the first paragraph whose bottom is at or below y: the
  // one containing y, or the one just after the gap y is in.
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (boxAt(mid).bottom < y) lo = mid + 1;
    else hi = mid;
  }
  const after = lo;
  if (y >= boxAt(after).top || after === 0) return after;
  // y is in the gap above `after`.
  const before = after - 1;
  return y - boxAt(before).bottom <= boxAt(after).top - y ? before : after;
}

/** The point moved inside `box`, one pixel in from each edge — the edges
 *  themselves belong to whichever box the browser decides, and are exactly
 *  where it decides wrong. */
export function pointInside(
  box: Box,
  x: number,
  y: number,
): { x: number; y: number } {
  const inset = (v: number, lo: number, hi: number) =>
    hi - lo <= 2 ? (lo + hi) / 2 : Math.min(hi - 1, Math.max(lo + 1, v));
  return { x: inset(x, box.left, box.right), y: inset(y, box.top, box.bottom) };
}

/** Word characters: everything that is not whitespace, punctuation or a
 *  symbol. Arabic letters and their diacritics are all word characters. */
const BOUNDARY = /[\s\p{P}\p{S}]/u;

function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || BOUNDARY.test(ch);
}

/** The word around `offset`, as [start, end). A point on a boundary
 *  character gives that one character, so a long-press on punctuation still
 *  selects something. */
export function wordAround(text: string, offset: number): [number, number] {
  let start = offset;
  let end = offset;
  while (start > 0 && !isBoundary(text[start - 1])) start--;
  while (end < text.length && !isBoundary(text[end])) end++;
  if (start === end) return [offset, Math.min(offset + 1, text.length)];
  return [start, end];
}

/** Snap a moving selection edge out to a whole word.
 *
 *  A finger is ~40px wide and Arabic letters are ~8, so asking for a
 *  character is asking for luck: the selection ends one letter short, or one
 *  letter into the next word, and the reader nudges back and forth to fix it.
 *  Highlighting is about words. The start edge snaps to the start of the word
 *  it lands in and the end edge to its end; an offset already on a boundary
 *  is left where it is. */
export function snapOffset(
  text: string,
  offset: number,
  edge: "start" | "end",
): number {
  const inWord = !isBoundary(text[offset - 1]) && !isBoundary(text[offset]);
  if (!inWord) return offset;
  const [start, end] = wordAround(text, offset);
  return edge === "start" ? start : end;
}

/** The browser's own "which character is at this point". */
export function caretFromPoint(x: number, y: number): TextEndpoint | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y) ?? null;
  if (pos && pos.offsetNode.nodeType === Node.TEXT_NODE) {
    return { node: pos.offsetNode as Text, offset: pos.offset };
  }
  const range = document.caretRangeFromPoint?.(x, y) ?? null;
  if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
    return { node: range.startContainer as Text, offset: range.startOffset };
  }
  return null;
}

/** The text paragraphs of a book body, in document order. Figures carry a
 *  paragraph index too, but have no text to put a caret in. */
function textParagraphs(body: HTMLElement): HTMLElement[] {
  return Array.from(body.querySelectorAll<HTMLElement>("p[data-p-index]"));
}

/** First or last text position inside a paragraph. */
function paragraphEdge(
  p: HTMLElement,
  which: "first" | "last",
): TextEndpoint | null {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let first: Text | null = null;
  let last: Text | null = null;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!first) first = t as Text;
    last = t as Text;
  }
  if (which === "first") return first ? { node: first, offset: 0 } : null;
  return last ? { node: last, offset: last.data.length } : null;
}

/**
 * The text position for a viewport point, kept inside the book's paragraphs.
 *
 * The point goes into the nearest paragraph (see `paragraphAt`) and inside its
 * box before the browser is asked. If the browser still answers with some
 * other paragraph — a point inside the box but past a short last line can
 * resolve oddly in bidi text — the answer is replaced by that paragraph's
 * start or end, whichever side the point was on.
 */
export function caretInBody(
  body: HTMLElement,
  x: number,
  y: number,
): TextEndpoint | null {
  const paragraphs = textParagraphs(body);
  const boxes = new Map<number, DOMRect>();
  const boxAt = (i: number) => {
    let box = boxes.get(i);
    if (!box) {
      box = paragraphs[i].getBoundingClientRect();
      boxes.set(i, box);
    }
    return box;
  };
  const i = paragraphAt(paragraphs.length, boxAt, y);
  if (i < 0) return null;
  const p = paragraphs[i];
  const box = boxAt(i);
  const point = pointInside(box, x, y);
  const hit = caretFromPoint(point.x, point.y);
  if (hit && p.contains(hit.node)) return hit;
  return paragraphEdge(p, y < (box.top + box.bottom) / 2 ? "first" : "last");
}

/** `ep` with its offset snapped to a word edge — see `snapOffset`. */
export function snapEndpoint(
  ep: TextEndpoint,
  edge: "start" | "end",
): TextEndpoint {
  return { node: ep.node, offset: snapOffset(ep.node.data, ep.offset, edge) };
}

/** A caret: a vertical bar at `x`, spanning one line. */
export interface Caret {
  x: number;
  top: number;
  height: number;
}

/**
 * Where a selection edge's handle goes, given the collapsed caret the
 * browser reports for that edge and the line box it belongs on.
 *
 * The browser's caret is right except at a soft line break. There one offset
 * is both the end of a line and the start of the next, and a collapsed range
 * reports the NEXT line. So a selection ending on a wrap had its end handle
 * drawn a line below the selection, at the far end of the next line — which
 * on the phone is exactly where the toolbar opens, and the handle was drawn
 * over it. (Measured from the reader's report: one highlighted line, the end
 * handle's bar a full line lower, on top of the colour row.)
 *
 * The caret is trusted when it sits on the line; otherwise the handle goes on
 * the line's own end — its leading edge for the start handle, its trailing
 * edge for the end handle, mirrored in RTL.
 */
export function caretOnLine(
  caret: Caret,
  line: Box,
  edge: "start" | "end",
  dir: "rtl" | "ltr",
): Caret {
  const lineMid = (line.top + line.bottom) / 2;
  const onLine = caret.top <= lineMid && caret.top + caret.height >= lineMid;
  if (onLine) return caret;
  const leading = dir === "rtl" ? line.right : line.left;
  const trailing = dir === "rtl" ? line.left : line.right;
  return {
    x: edge === "start" ? leading : trailing,
    top: line.top,
    height: line.bottom - line.top,
  };
}
