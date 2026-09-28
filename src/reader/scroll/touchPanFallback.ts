/**
 * The DOM half of the pan fallback: see touchPan.ts for why it exists.
 *
 * Listens on the reader's root for touch pointers, lets the browser have every
 * gesture it wants, and scrolls the page itself only for one the browser
 * turned down. After a release in motion it carries the page on with
 * Android's fling curve, and gives that fling up the moment anything else
 * happens: a finger landing, a wheel, or the page being moved by someone else
 * (a chapter turn resetting the scroller, a resume jump).
 *
 * Which gestures are candidates is declared in the markup, not here:
 *
 *   - `data-pan-scroller` on the scroller. global.css gives it
 *     `touch-action: pan-y`, which is what makes Chromium DECLINE a
 *     sideways-leaning start cleanly — no pointercancel, so the pointer stream
 *     keeps coming and this can take over.
 *   - `data-pan-zone` on anything outside the scroller whose swipes should
 *     scroll it (the reader's floating bars). global.css gives it
 *     `touch-action: none`, so the browser never claims those gestures.
 *   - `data-pan-axis="x"` on a control that owns sideways drags (the chapter
 *     slider): a gesture starting there is taken only if it goes vertical.
 *
 * Positions are kept unrounded here and written absolutely. The scroller
 * quantises what it stores — Chromium to device pixels, WebKit by flooring —
 * so accumulating `scrollTop += delta` would drop every sub-pixel step, and a
 * slow drag would not move the page at all.
 */

import {
  createPanGesture,
  flingOffset,
  type PanDownOptions,
  planFling,
} from "./touchPan";

/** Where a gesture started decides whether it is ours to consider. */
function panZoneOf(
  scroller: HTMLElement,
  target: Element,
): PanDownOptions | null {
  if (!scroller.contains(target) && !target.closest("[data-pan-zone]")) {
    return null; // sheets, popovers, anything else floating over the reader
  }
  return { verticalOnly: target.closest('[data-pan-axis="x"]') !== null };
}

export function attachTouchPanFallback(
  root: HTMLElement,
  scroller: HTMLElement,
  /** Another handler owns the pointer right now (a text selection). */
  blocked: () => boolean,
): () => void {
  const gesture = createPanGesture();
  let pointerId: number | null = null;

  /** The page position being driven, unrounded. */
  let pos = 0;
  /** What the scroller reported right after our last write — anything else
   *  on the next read means somebody else moved the page. */
  let lastRead = 0;

  let raf = 0;
  const stopFling = () => {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
  };

  /** Write `next`, clamped to the scroller. False when the clamp bit, i.e.
   *  the page is at an end. */
  const drive = (next: number): boolean => {
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const clamped = Math.min(max, Math.max(0, next));
    scroller.scrollTop = clamped;
    lastRead = scroller.scrollTop;
    pos = clamped;
    return clamped === next;
  };
  const movedByOthers = () => Math.abs(scroller.scrollTop - lastRead) > 1;

  const fling = (velocity: number, t0: number) => {
    const plan = planFling(velocity);
    if (!plan) return;
    const from = pos;
    const frame = (now: number) => {
      raf = 0;
      if (movedByOthers()) return;
      const inBounds = drive(from + flingOffset(plan, now - t0));
      if (!inBounds || now - t0 >= plan.durationMs) return;
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
  };

  const release = () => {
    gesture.cancel();
    pointerId = null;
  };

  const onDown = (e: PointerEvent) => {
    pointerId = null;
    if (e.pointerType !== "touch" || !e.isPrimary) return;
    const zone =
      e.target instanceof Element ? panZoneOf(scroller, e.target) : null;
    if (!zone) return;
    pointerId = e.pointerId;
    pos = lastRead = scroller.scrollTop;
    gesture.down(e.clientX, e.clientY, e.timeStamp, zone);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    // Decided against (a scrub on the slider), or taken by a selection.
    if (gesture.state === "idle" || blocked()) return release();
    // Touch pointermoves are dispatched once per frame; the coalesced list
    // carries the samples in between, which is what the release velocity
    // wants to see.
    const coalesced = e.getCoalescedEvents?.() ?? [];
    let delta = 0;
    for (const s of coalesced.length > 0 ? coalesced : [e]) {
      delta += gesture.move(s.clientX, s.clientY, s.timeStamp);
    }
    if (delta === 0) return;
    // Scroll anchoring, a late layout, or the tail of a native fling moved the
    // page under the finger: follow it rather than drag the page back.
    if (movedByOthers()) pos += scroller.scrollTop - lastRead;
    drive(pos + delta);
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    const velocity = gesture.up(e.timeStamp);
    if (velocity !== 0) fling(velocity, e.timeStamp);
  };

  // The browser started its own scroll, or the system took the touch for a
  // back gesture. Either way it is not ours, and nothing flings.
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === pointerId) release();
  };

  const listeners = new AbortController();
  const opts = { passive: true, signal: listeners.signal };
  root.addEventListener("pointerdown", onDown, opts);
  root.addEventListener("pointermove", onMove, opts);
  root.addEventListener("pointerup", onUp, opts);
  root.addEventListener("pointercancel", onCancel, opts);
  // Any finger, anywhere — the reader, a sheet, a popover — catches a running
  // fling, as it does a native one; so does the wheel. Capture, so it runs
  // before anything on the way can swallow the event, and before onDown.
  window.addEventListener("pointerdown", stopFling, { ...opts, capture: true });
  scroller.addEventListener("wheel", stopFling, opts);

  return () => {
    listeners.abort();
    stopFling();
  };
}
