// Throw a scroll container with Android's own fling curve.
//
// The curve is touchPan.ts's port of SplineOverScroller, so a list flung from
// script decelerates exactly like the native fling beside it. Shared by the
// reader's pan fallback (a swipe the browser declined) and the bottom sheet's
// "expand, then keep scrolling" gesture (a swipe the sheet owned), so the two
// coast alike.

import { flingOffset, planFling } from "./touchPan";

export interface Fling {
  cancel(): void;
  /** Still moving: not stopped, cancelled, or at an end. */
  readonly active: boolean;
}

/** Fling `scroller` at `velocity` px/s of scrollTop (positive = towards the
 *  end) from requestAnimationFrame time `t0`, starting at `from` (default: the
 *  current scrollTop; the pan fallback passes its unrounded position). It
 *  stops at either end, when anything else moves the scroller, or on
 *  `cancel()`. Null when the release is too slow to fling at all. */
export function flingScroller(
  scroller: HTMLElement,
  velocity: number,
  t0: number,
  from = scroller.scrollTop,
): Fling | null {
  const plan = planFling(velocity);
  if (!plan) return null;
  let lastRead = scroller.scrollTop;
  let raf = 0;
  let active = true;
  const stop = () => {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    active = false;
  };
  const frame = (now: number) => {
    raf = 0;
    // A chapter turn, scroll anchoring, a new finger: someone else moved it.
    if (Math.abs(scroller.scrollTop - lastRead) > 1) return stop();
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const next = from + flingOffset(plan, now - t0);
    const clamped = Math.min(max, Math.max(0, next));
    scroller.scrollTop = clamped;
    lastRead = scroller.scrollTop;
    // At an end, stop rather than push against it.
    if (clamped !== next || now - t0 >= plan.durationMs) return stop();
    raf = window.requestAnimationFrame(frame);
  };
  raf = window.requestAnimationFrame(frame);
  return {
    cancel: stop,
    get active() {
      return active;
    },
  };
}
