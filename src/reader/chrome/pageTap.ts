// Was that gesture a tap on the page, or something else that happened to end
// in a click?
//
// The reading surface answers three gestures with the same pointer stream: a
// tap (which hides or shows the chrome), a drag (which scrolls), and a hold
// (which starts a text selection). The browser fires a click at the end of all
// three, so "the reader tapped the page" cannot be read off the click alone —
// reaching for a highlight took the chrome away with it, because a 700ms press
// that never moved is a click like any other.
//
// Split out and made pure for the same reason `isDoubleTap` was: the duration
// below is a judgement call about thumbs, and a judgement call that cannot be
// tested at its edges is one nobody will dare change later.

import { stayedPut, TOUCH_SLOP } from "../gestureAxis";
import type { Tap } from "./focusGesture";

/** How long a press has to last before it becomes a text selection instead.
 *
 *  Also the selection timer's own delay — they are the same instant by
 *  definition, which is why this lives here and MobileReader imports it
 *  rather than keeping a second copy that could drift. */
export const LONG_PRESS_MS = 400;

/** How far a press may travel and still be a press rather than a scroll.
 *
 *  The shared touch slop, not a number of its own: past it the browser is
 *  panning the page, and a gesture must never read as both a scroll and a
 *  tap. The selection timer is cancelled at the same boundary. */
export const LONG_PRESS_MOVE_TOLERANCE = TOUCH_SLOP;

/** True when the gesture that ran from `down` to `up` was a plain tap.
 *
 *  `down` is null when no press was recorded for this click — a synthesised
 *  one, or a press that some other handler took ownership of. Nothing to
 *  vouch for the gesture means it is not treated as a tap. */
export function isPageTap(down: Tap | null, up: Tap): boolean {
  if (!down) return false;
  // `>=`, not `>`: at exactly LONG_PRESS_MS the selection timer has fired, so
  // the gesture is already a hold.
  if (up.t - down.t >= LONG_PRESS_MS) return false;
  return stayedPut(up.x - down.x, up.y - down.y, LONG_PRESS_MOVE_TOLERANCE);
}
