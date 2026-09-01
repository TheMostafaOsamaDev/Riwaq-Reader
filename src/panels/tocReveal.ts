// Reveal math for the Contents panel's "scroll the current chapter into view".
//
// Why this exists instead of `Element.scrollIntoView`: that API walks up
// EVERY scrollable ancestor and scrolls each one so the element lands at the
// requested block position. Inside the mobile bottom sheet the row starts off
// the bottom of the screen (the sheet is translated below the viewport for
// its enter animation), and the sheet's own clip wrapper counts as a
// scrolling box, so the browser satisfied the request by scrolling that
// wrapper — yanking the whole sheet up over its enter transition and leaving
// it settled ~140px too high, with its tail off-screen. Computing the target
// ourselves keeps the scroll inside the list it belongs to.

export interface RevealInput {
  /** Current scroll offset of the list's scroll container. */
  scrollTop: number;
  /** Visible height of the scroll container. */
  clientHeight: number;
  /** Total scrollable content height of the container. */
  scrollHeight: number;
  /** Row's top edge in the container's content coordinates. */
  rowOffsetTop: number;
  /** Row's own height. */
  rowHeight: number;
}

/** scrollTop that puts `row` in the vertical middle of the scrollport,
 *  clamped to the container's real scroll range. */
export function centerScrollTop(input: RevealInput): number {
  const { clientHeight, scrollHeight, rowOffsetTop, rowHeight } = input;
  const max = Math.max(0, scrollHeight - clientHeight);
  const target = rowOffsetTop - (clientHeight - rowHeight) / 2;
  return Math.round(Math.min(max, Math.max(0, target)));
}

/** Row top in the scroller's CONTENT coordinates, derived from live rects so
 *  it is correct regardless of which element happens to be the row's
 *  `offsetParent`. Both rects sit under the same transformed ancestor (the
 *  sheet only ever translates, never scales), so their difference is exact. */
export function contentOffsetTop(
  rowTop: number,
  scrollerTop: number,
  scrollTop: number,
): number {
  return rowTop - scrollerTop + scrollTop;
}

/** Nearest ancestor that is a real vertical scroller — one whose computed
 *  `overflow-y` scrolls AND that has range to scroll. Deliberately skips
 *  `hidden` / `clip` boxes: those are the ones `scrollIntoView` was happy to
 *  scroll even though nothing about them is meant to move. */
export function nearestScrollableAncestor(el: Element): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight - node.clientHeight > 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
