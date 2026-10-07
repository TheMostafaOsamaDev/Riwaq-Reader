/**
 * Smooth scrolling for a MOUSE wheel on macOS. Trackpads are left alone.
 *
 * WKWebView does not animate a mouse wheel. A trackpad sends a stream of
 * small pixel deltas at the display rate, which the browser applies as they
 * come — that is already smooth, and the reader said so. A wheel notch is one
 * event carrying 40px or more (macOS accelerates a fast spin to hundreds),
 * and WebKit applies it in a single frame: the page jumps a line or three per
 * notch. Measured in a bare WKWebView on macOS 26, a 3-line notch: scrollTop
 * 0 → 120 between one frame and the next, with no frames in between. Chrome
 * and Firefox animate the same input; WebKit's own "scroll animator" feature
 * flag exists but changed nothing when switched on.
 *
 * So for a mouse — and only a mouse — the reader takes the notch and plays it
 * out over a short ease. The last attempt at this (removed in f31386d) took
 * EVERY wheel event, trackpad included, and drifted 22% of the gap per frame
 * for ~350ms; it read as heavy and laggy, and it was right to remove it. The
 * differences here are the two that mattered:
 *
 *   - Trackpad input is never touched. Which device sent an event is not
 *     visible in the DOM — WebKit reports a notch and a trackpad swipe with
 *     the same fields and the same 3:1 `wheelDelta` ratio — so the native side
 *     tells the page (`window.__riwaqWheel`, set from AppKit's
 *     `hasPreciseScrollingDeltas`; see src-tauri/src/wheel_device.rs). Until
 *     it has said "mouse", nothing here runs.
 *   - The ease is short and front-loaded: a third of the notch lands in the
 *     first frame and 90% within ~95ms, so a notch still answers at once and
 *     simply arrives instead of teleporting.
 */

import { wheelDeltaToPixels } from "./turnGate";

/** Time constant of the exponential approach, in ms. */
export const SMOOTH_WHEEL_TAU_MS = 40;

declare global {
  interface Window {
    /** Set by the macOS shell from the last scroll event's device. */
    __riwaqWheel?: "mouse" | "trackpad";
  }
}

/** Is the wheel in hand a mouse, as far as the native side has told us? */
export function wheelIsMouse(): boolean {
  return typeof window !== "undefined" && window.__riwaqWheel === "mouse";
}

/** The next position of a glide towards `target`, `dt` ms on.
 *  Pure, for the tests. Lands exactly once within half a pixel. */
export function glideStep(pos: number, target: number, dt: number): number {
  const next = target - (target - pos) * Math.exp(-dt / SMOOTH_WHEEL_TAU_MS);
  return Math.abs(target - next) < 0.5 ? target : next;
}

export function attachSmoothWheel(
  scroller: HTMLElement,
  options: {
    /** Which device sent this event. Injected for the tests. */
    isMouse?: () => boolean;
    reducedMotion?: () => boolean;
  } = {},
): () => void {
  const isMouse = options.isMouse ?? wheelIsMouse;
  const reducedMotion = options.reducedMotion ?? (() => false);

  /** Unrounded position being driven, and where it is heading. */
  let pos = 0;
  let target = 0;
  /** What the scroller held after our last write. Anything else on the next
   *  read means the page was moved by someone else — the scrollbar, the
   *  keyboard, a chapter jump — and the glide gives way to it. */
  let lastRead = 0;
  let raf = 0;
  let lastT = 0;

  const maxScroll = () =>
    Math.max(0, scroller.scrollHeight - scroller.clientHeight);

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const frame = (now: number) => {
    raf = 0;
    if (Math.abs(scroller.scrollTop - lastRead) > 1) return; // moved by others
    const dt = Math.min(64, Math.max(1, now - lastT));
    lastT = now;
    pos = glideStep(pos, target, dt);
    scroller.scrollTop = pos;
    lastRead = scroller.scrollTop;
    // Watch rather than model the scroller's rounding (WebKit floors,
    // Chromium rounds): if the write did not move it and we have arrived,
    // stop; the remainder is below the pixel grain.
    if (pos !== target) raf = requestAnimationFrame(frame);
  };

  const onWheel = (e: WheelEvent) => {
    // Pinch-zoom arrives as a ctrl+wheel; sideways input is not ours; and a
    // trackpad is already smooth.
    if (e.ctrlKey || !isMouse() || reducedMotion()) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode);
    if (dy === 0) return;
    e.preventDefault();
    if (!raf) {
      // Starting fresh: from wherever the page actually is now.
      pos = target = lastRead = scroller.scrollTop;
      lastT = performance.now();
    }
    target = Math.min(maxScroll(), Math.max(0, target + dy));
    if (!raf) raf = requestAnimationFrame(frame);
  };

  scroller.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    stop();
    scroller.removeEventListener("wheel", onWheel);
  };
}
