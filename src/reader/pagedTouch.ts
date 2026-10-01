// How a finger turns a page in the EPUB reader's 1-page and 2-page modes.
//
// Those modes belong to the desktop layout, and an Android tablet in landscape
// gets the desktop layout — it is wider than the phone breakpoint. Wheel and
// arrow keys were the only ways to turn, so on a tablet the rest of a chapter
// was out of reach. The rules follow the PDF reader's paged mode
// (FixedPageViewer): the outer 18% of the page turns on a tap, a sideways
// swipe turns in reading direction, and RTL mirrors both.

import { isPageTap } from "./chrome/pageTap";
import type { Tap } from "./chrome/focusGesture";

/** The share of the reader's width, from each side, that turns on a tap. */
export const PAGE_EDGE_FRACTION = 0.18;

/** How far a sideways drag must travel to be a swipe. Past the 8px touch slop
 *  with room to spare, so a tap that wobbles never turns twice as far. */
export const SWIPE_MIN_PX = 40;

/** A swipe must be this much more sideways than vertical. */
const SWIPE_AXIS_RATIO = 1.5;

/** The page turn a touch gesture asks for: 1 forward, -1 back, 0 none.
 *
 *  `left` and `width` are the reader's own box, so a docked panel beside it
 *  does not shift the edges. Forward is the reading direction: in RTL the left
 *  edge and a rightward swipe go forward, matching the left arrow key. */
export function pagedTouchTurn(
  down: Tap,
  up: Tap,
  left: number,
  width: number,
  rtl: boolean,
): -1 | 0 | 1 {
  const dx = up.x - down.x;
  const dy = up.y - down.y;
  const mirror = rtl ? -1 : 1;

  if (
    Math.abs(dx) >= SWIPE_MIN_PX &&
    Math.abs(dx) > SWIPE_AXIS_RATIO * Math.abs(dy)
  ) {
    // Dragging left advances an LTR book.
    return ((dx < 0 ? 1 : -1) * mirror) as -1 | 1;
  }

  if (!isPageTap(down, up) || width <= 0) return 0;
  const frac = (up.x - left) / width;
  if (frac <= PAGE_EDGE_FRACTION) return (-1 * mirror) as -1 | 1;
  if (frac >= 1 - PAGE_EDGE_FRACTION) return (1 * mirror) as -1 | 1;
  return 0;
}
