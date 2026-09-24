// Is this tap the second half of a double-tap?
//
// Split out of MobileReader and made pure so the window and the slop can be
// tested at their boundaries without a DOM. Both numbers are judgement calls
// about thumbs, and a judgement call that cannot be tested at its edges is one
// nobody will dare change later.

/** A tap, as the reading surface's click handler sees it. */
export interface Tap {
  /** `event.timeStamp`, in ms. */
  t: number;
  x: number;
  y: number;
}

/** How long after the first tap a second one still reads as one gesture.
 *
 *  300ms is the platform's own double-tap window. Shorter and a deliberate
 *  double-tap misses; longer and two unrelated taps start merging. */
export const DOUBLE_TAP_MS = 300;

/** How far from the first tap the second may land, in CSS px.
 *
 *  A thumb does not return to the same pixel. 24px is roughly a thumb's own
 *  wobble — wide enough that a real double-tap registers, tight enough that
 *  tapping two different words never does. */
export const DOUBLE_TAP_SLOP = 24;

export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev) return false;
  if (next.t - prev.t > DOUBLE_TAP_MS) return false;
  // Euclidean, not per-axis: slop on both axes at once is 1.41× slop away,
  // and a per-axis test would wave that through as "close enough".
  return Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_SLOP;
}
