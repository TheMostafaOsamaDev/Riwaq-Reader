// Which way is a touch drag going?
//
// One rule, shared by everything that has to tell a scroll from a sideways
// drag — the chapter slider (a scrub is sideways, a scroll is not) and the
// phone reader's pan fallback — so two handlers watching the same finger can
// never reach different answers about it.

/** Android's touch slop: 8dp, and a CSS px in a WebView is a dp. Movement
 *  inside it is a tap still settling, not a direction. */
export const TOUCH_SLOP = 8;

/** Which axis a drag `dx, dy` from its start is on, or null while it is still
 *  inside the slop. Ties go to vertical, as Chromium's pan-y rule does (it
 *  calls a gesture horizontal only when |dx| > |dy|). */
export function gestureAxis(dx: number, dy: number): "x" | "y" | null {
  if (Math.hypot(dx, dy) <= TOUCH_SLOP) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}
