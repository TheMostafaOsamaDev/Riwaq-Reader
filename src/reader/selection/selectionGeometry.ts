/**
 * What the phone reader draws for a selection: its line boxes and its two
 * handles, in the SCROLLER's content coordinates.
 *
 * Content coordinates, not viewport ones, because that is what lets the paint
 * scroll with the text for free. The selection used to be drawn
 * `position: fixed` from viewport rects and re-measured on every scroll
 * event. On Android the page scrolls on the compositor and the scroll event
 * reaches the main thread a frame or more later, so the tint and the handles
 * trailed the words they belonged to — the selection "floated" over the page
 * while it moved. Drawn inside the scroller, absolutely, the compositor moves
 * them in the same frame as the text, and nothing runs on scroll at all.
 *
 * They only need re-measuring when LAYOUT changes: a new selection, a resize,
 * a font change.
 */

import { dirOf } from "../../lib/selectionAnchor";
import { type Caret, caretOnLine } from "./textCaret";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SelectionGeometry {
  /** One box per line of selected text. */
  lines: Rect[];
  start: Caret;
  end: Caret;
}

/** Viewport → content coordinates of `scroller`. Its padding box at scroll
 *  position 0 is the origin an absolutely positioned child is placed from. */
export function contentOrigin(scroller: HTMLElement): { x: number; y: number } {
  const r = scroller.getBoundingClientRect();
  return {
    x: r.left + scroller.clientLeft - scroller.scrollLeft,
    y: r.top + scroller.clientTop - scroller.scrollTop,
  };
}

function collapsedCaret(node: Node, offset: number): Caret | null {
  const r = document.createRange();
  r.setStart(node, offset);
  r.setEnd(node, offset);
  const b = r.getBoundingClientRect();
  // An unlaid-out caret reports an all-zero rect. That is "unknown", not a
  // caret at the window's corner.
  if (b.top === 0 && b.left === 0 && b.height === 0) return null;
  return { x: b.left, top: b.top, height: b.height };
}

/** Measure `range` and express it relative to `origin` (see contentOrigin). */
export function measureSelection(
  range: Range,
  origin: { x: number; y: number },
): SelectionGeometry | null {
  const rects = Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 && r.height > 0,
  );
  if (rects.length === 0) return null;
  const first = rects[0];
  const last = rects[rects.length - 1];

  const lineBox = (r: DOMRect) => ({
    top: r.top,
    bottom: r.bottom,
    left: r.left,
    right: r.right,
  });
  const place = (
    caret: Caret | null,
    line: DOMRect,
    edge: "start" | "end",
    node: Node,
  ): Caret => {
    const dir = dirOf(node);
    const fallback = { x: 0, top: Number.NaN, height: 0 };
    return caretOnLine(caret ?? fallback, lineBox(line), edge, dir);
  };
  const start = place(
    collapsedCaret(range.startContainer, range.startOffset),
    first,
    "start",
    range.startContainer,
  );
  const end = place(
    collapsedCaret(range.endContainer, range.endOffset),
    last,
    "end",
    range.endContainer,
  );

  const shift = (c: Caret): Caret => ({
    x: c.x - origin.x,
    top: c.top - origin.y,
    height: c.height,
  });
  return {
    lines: rects.map((r) => ({
      left: r.left - origin.x,
      top: r.top - origin.y,
      width: r.width,
      height: r.height,
    })),
    start: shift(start),
    end: shift(end),
  };
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
const sameCaret = (a: Caret, b: Caret) =>
  near(a.x, b.x) && near(a.top, b.top) && near(a.height, b.height);
const sameRect = (a: Rect, b: Rect) =>
  near(a.left, b.left) &&
  near(a.top, b.top) &&
  near(a.width, b.width) &&
  near(a.height, b.height);

/** Sub-pixel churn is not worth a render of the reader. */
export function sameGeometry(
  a: SelectionGeometry | null,
  b: SelectionGeometry | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    sameCaret(a.start, b.start) &&
    sameCaret(a.end, b.end) &&
    a.lines.length === b.lines.length &&
    a.lines.every((r, i) => sameRect(r, b.lines[i]))
  );
}
