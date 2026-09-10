// Single source of truth for app-wide transition durations + easings.
// Components import from here instead of hard-coding `220ms` /
// `cubic-bezier(...)` strings so the motion language stays consistent
// when we tweak it later. `useReducedMotion` lets components collapse
// their animations to instant toggles when the user has the OS-level
// reduce-motion accessibility setting on.

import { useEffect, useState } from "react";

export const MOTION = {
  /** Used for exits — short and snappy. */
  fast: 180,
  /** Used for enters and most state transitions. */
  med: 240,
  /** Used for slower content reveals (e.g., chapter-enter). */
  slow: 280,
} as const;

export const EASE = {
  /** Spring-like entry — settles into place. Pair with `MOTION.med`. */
  enter: "cubic-bezier(0.32, 0.72, 0, 1)",
  /** Snappy ease-in for exits. Pair with `MOTION.fast`. */
  exit: "cubic-bezier(0.4, 0, 1, 1)",
  /** Standard ease-out for one-shot reveals (chapter load, toast). */
  out: "ease-out",
} as const;

/** The same two curves as control points, for the rare animation that has to
 *  be evaluated in JS rather than handed to CSS — see `cubicBezier`, and
 *  reader/chrome/useInsetGlide for the one caller that needs it.
 *
 *  Duplicating the numbers is deliberate: `EASE` stays a plain table of
 *  strings, which is what almost every caller wants. A test asserts the two
 *  agree, so they cannot drift apart unnoticed. */
export const EASE_POINTS = {
  enter: [0.32, 0.72, 0, 1],
  exit: [0.4, 0, 1, 1],
} as const;

/**
 * A CSS `cubic-bezier()` curve as a JS function of progress.
 *
 * Only for animations that must stay in lockstep with something CSS cannot
 * animate at all. Reading the transitioned value back out of
 * `getComputedStyle` each frame looks equivalent and is not: the value it
 * reports is the curve at the CURRENT time, while the frame being prepared
 * paints at the next one, so the follower ends up a frame behind. Over a
 * 240ms transition that measured as ~7px of wobble in something that was
 * supposed to hold perfectly still. Driving both sides from this instead
 * leaves nothing to lag.
 *
 * Newton-Raphson on x, falling back to bisection where the curve is too flat
 * for the derivative to be trusted (`EASE.enter` ends flat by construction).
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (progress: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const EPS = 1e-6;
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let t = progress;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - progress;
      if (Math.abs(err) < EPS) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < EPS) break;
      t -= err / slope;
    }
    let lo = 0;
    let hi = 1;
    t = progress;
    for (let i = 0; i < 32; i++) {
      const err = sampleX(t) - progress;
      if (Math.abs(err) < EPS) break;
      if (err > 0) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

/** Build a `transition` shorthand from token names. Example:
 *  `transition: ${transition("transform", "med", "enter")}`.
 *  When `reduced` is true, returns `none` so callers can short-circuit
 *  without changing layout. */
export function transition(
  property: string,
  duration: keyof typeof MOTION,
  ease: keyof typeof EASE,
  reduced = false,
): string {
  if (reduced) return "none";
  return `${property} ${MOTION[duration]}ms ${EASE[ease]}`;
}

// App-level override for the reduce-motion preference. A tiny pub-sub so
// that a settings change reaches every `useReducedMotion()` caller without
// prop threading. `"auto"` defers to the OS `prefers-reduced-motion` query.
let reduceMotionOverride: "auto" | "on" | "off" = "auto";
const reduceMotionListeners = new Set<() => void>();

/** Set the app-level reduce-motion override and notify all subscribers.
 *  `"on"` forces reduced motion, `"off"` forces full motion, and `"auto"`
 *  defers to the OS `prefers-reduced-motion` setting. */
export function setReduceMotionOverride(pref: "auto" | "on" | "off"): void {
  if (pref === reduceMotionOverride) return;
  reduceMotionOverride = pref;
  reduceMotionListeners.forEach((listener) => listener());
}

const osReducedQuery = (): MediaQueryList | null =>
  typeof window === "undefined" || !window.matchMedia
    ? null
    : window.matchMedia("(prefers-reduced-motion: reduce)");

/** The reduce-motion preference right now: the app-level override, or the OS
 *  setting when the override is `"auto"`.
 *
 *  The non-React half of `useReducedMotion`, for modules that run outside the
 *  component tree. Without it they can only read the OS query and silently
 *  ignore the in-app Reduce motion control, which is a setting the user
 *  expects to govern the whole app. */
export function isReducedMotion(): boolean {
  if (reduceMotionOverride !== "auto") return reduceMotionOverride === "on";
  return osReducedQuery()?.matches ?? false;
}

/** Call `onChange` whenever `isReducedMotion()` would return something new —
 *  from the settings override or from the OS. Returns an unsubscribe. */
export function subscribeReducedMotion(onChange: () => void): () => void {
  reduceMotionListeners.add(onChange);
  const mq = osReducedQuery();
  mq?.addEventListener("change", onChange);
  return () => {
    reduceMotionListeners.delete(onChange);
    mq?.removeEventListener("change", onChange);
  };
}

/** React to the reduce-motion preference. Returns `true` when the user has
 *  asked for less motion — either via the app-level override or (when the
 *  override is `"auto"`) the OS setting — in which case callers should skip
 *  enter/exit animations (a `display: none` toggle is fine). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(isReducedMotion);
  useEffect(() => {
    const sync = () => setReduced(isReducedMotion());
    const unsubscribe = subscribeReducedMotion(sync);
    // Resync in case the preference changed between render and subscribe.
    sync();
    return unsubscribe;
  }, []);
  return reduced;
}
