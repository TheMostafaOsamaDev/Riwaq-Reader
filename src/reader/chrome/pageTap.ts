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
// Split out and made pure for the same reason `isDoubleTap` was: both numbers
// below are judgement calls about thumbs, and a judgement call that cannot be
// tested at its edges is one nobody will dare change later.

/** One end of a gesture, as a pointer event reports it. */
export interface Press {
  /** `event.timeStamp`, in ms. */
  t: number;
  x: number;
  y: number;
}

/** How long a press has to last before it becomes a text selection instead.
 *
 *  Also the selection timer's own delay — they are the same instant by
 *  definition, which is why this lives here and MobileReader imports it
 *  rather than keeping a second copy that could drift. */
export const LONG_PRESS_MS = 400;

/** How far a press may travel and still be a press rather than a scroll, in
 *  CSS px. Past this the selection timer is cancelled and the browser is
 *  panning the page. */
export const LONG_PRESS_MOVE_TOLERANCE = 8;

/** True when the gesture that ran from `down` to `up` was a plain tap.
 *
 *  `down` is null when no press was recorded for this click — a synthesised
 *  one, or a press that some other handler took ownership of. Nothing to
 *  vouch for the gesture means it is not treated as a tap. */
export function isPageTap(down: Press | null, up: Press): boolean {
  if (!down) return false;
  // `>=`, not `>`: at exactly LONG_PRESS_MS the selection timer has fired, so
  // the gesture is already a hold.
  if (up.t - down.t >= LONG_PRESS_MS) return false;
  // Euclidean, matching the cancel test in the selection code — a gesture must
  // never read as both a scroll and a tap.
  return Math.hypot(up.x - down.x, up.y - down.y) <= LONG_PRESS_MOVE_TOLERANCE;
}
