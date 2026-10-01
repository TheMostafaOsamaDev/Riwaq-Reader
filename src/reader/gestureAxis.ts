// Which way is a touch drag going?
//
// One rule, shared by everything that has to tell a scroll from a sideways
// drag — the chapter slider (a scrub is sideways, a scroll is not) and the
// phone reader's pan fallback — so two handlers watching the same finger can
// never reach different answers about it.

/** Android's touch slop: 8dp, and a CSS px in a WebView is a dp. Movement
 *  inside it is a tap still settling, not a direction. */
export const TOUCH_SLOP = 8;

/** Has a finger that moved `dx, dy` stayed put, for a given slop?
 *
 *  Euclidean, not per axis: slop on both axes at once is 1.41x slop away, and
 *  a per-axis test would wave that through as "close enough". Shared so that
 *  every gesture measuring thumb wobble — the tap test, the double-tap test,
 *  the axis test below — answers that the same way. */
export function stayedPut(dx: number, dy: number, slop = TOUCH_SLOP): boolean {
  return Math.hypot(dx, dy) <= slop;
}

/** Which axis a drag `dx, dy` from its start is on, or null while it is still
 *  inside the slop. Ties go to vertical, as Chromium's pan-y rule does (it
 *  calls a gesture horizontal only when |dx| > |dy|). */
export function gestureAxis(dx: number, dy: number): "x" | "y" | null {
  if (stayedPut(dx, dy)) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}
