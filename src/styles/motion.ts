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

/** React to the reduce-motion preference. Returns `true` when the user has
 *  asked for less motion — either via the app-level override or (when the
 *  override is `"auto"`) the OS setting — in which case callers should skip
 *  enter/exit animations (a `display: none` toggle is fine). */
export function useReducedMotion(): boolean {
  const [osReduced, setOsReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  const [override, setOverride] = useState(reduceMotionOverride);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setOsReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    const listener = () => setOverride(reduceMotionOverride);
    reduceMotionListeners.add(listener);
    // Resync in case the override changed between render and subscribe.
    listener();
    return () => {
      reduceMotionListeners.delete(listener);
    };
  }, []);
  return override === "on" ? true : override === "off" ? false : osReduced;
}
