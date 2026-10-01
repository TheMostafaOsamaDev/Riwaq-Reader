// How a tap or a swipe turns a page, for both paged readers: the EPUB
// reader's 1-page and 2-page modes and the PDF/DOCX reader's paged mode.
//
// One set of rules so the two can't drift apart. The EPUB paged modes belong
// to the desktop layout, which is what an Android tablet gets in landscape —
// they used to turn only by wheel and arrow keys, so on a tablet the rest of a
// chapter was out of reach.

import type { Tap } from "./chrome/focusGesture";
import { isPageTap } from "./chrome/pageTap";
import { gestureAxis } from "./gestureAxis";

/** The share of the reader's width, from each side, that turns on a tap. */
const PAGE_EDGE_FRACTION = 0.18;

/** How far a sideways drag must travel to be a swipe. Past the 8px touch slop
 *  with room to spare, so a tap that wobbles never turns twice as far. */
const SWIPE_MIN_PX = 40;

type Turn = -1 | 1;

/** Which outer edge of a box `x` lands in, on screen: -1 left, 1 right, 0 the
 *  middle. Not yet a direction — see {@link forwardFor}. */
export function edgeSide(x: number, left: number, width: number): -1 | 0 | 1 {
  if (width <= 0) return 0;
  const frac = (x - left) / width;
  if (frac <= PAGE_EDGE_FRACTION) return -1;
  if (frac >= 1 - PAGE_EDGE_FRACTION) return 1;
  return 0;
}

/** An on-screen side as a reading direction: the right is forward in an LTR
 *  book, the left in an RTL one — the same way the arrow keys go. */
export function forwardFor(side: Turn, rtl: boolean): Turn {
  return rtl ? (side === 1 ? -1 : 1) : side;
}

/** The turn a horizontal drag of `dx` asks for. Dragging left pulls the next
 *  page in from the right, which is forward in an LTR book. */
export function turnFromDrag(dx: number, rtl: boolean): Turn {
  return forwardFor(dx < 0 ? 1 : -1, rtl);
}

/** The page turn a touch gesture asks for: 1 forward, -1 back, 0 none.
 *
 *  `left` and `width` are the reader's own box, so a docked panel beside it
 *  does not shift the edges. A sideways swipe wins over the edge it started
 *  on; a tap only counts if it was a tap, not a hold (text selection). */
export function pagedTouchTurn(
  down: Tap,
  up: Tap,
  left: number,
  width: number,
  rtl: boolean,
): -1 | 0 | 1 {
  const dx = up.x - down.x;
  const dy = up.y - down.y;
  if (gestureAxis(dx, dy) === "x" && Math.abs(dx) >= SWIPE_MIN_PX) {
    return turnFromDrag(dx, rtl);
  }
  if (!isPageTap(down, up)) return 0;
  const side = edgeSide(up.x, left, width);
  return side === 0 ? 0 : forwardFor(side, rtl);
}
