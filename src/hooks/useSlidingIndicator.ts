import { useLayoutEffect, useRef } from "react";
import { isReducedMotion } from "../styles/motion";

const EMPHASIZED = "cubic-bezier(0.4, 0.0, 0.2, 1)";
const props = (dur: number, curve: string) =>
  ["left", "top", "width", "height"]
    .map((p) => `${p} ${dur}ms ${curve}`)
    .join(", ");

/** The library filter pills' motion (MobileTabRow), shared: same duration,
 *  same curve, so "this one is selected" moves alike wherever it slides. */
export const SLIDE_TRANSITION = props(240, EMPHASIZED);

/**
 * How the indicator travels to the next item.
 *
 *  - "slide": straight there on the filter pills' curve.
 *  - "spring": straight there, overshooting a touch and settling back, like
 *    a physical switch thumb.
 *  - "stretch": a liquid move — it first stretches to cover both the old
 *    item and the new one, then lets go of the old side and settles on the
 *    new. Reads as the selection flowing across rather than jumping.
 */
export type IndicatorMotion = "slide" | "spring" | "stretch";

/** Stretch phase lengths: reaching out, then letting go. */
const REACH_MS = 140;
const SETTLE_MS = 220;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * One background that travels from the selected item to the next, instead
 * of the old item's fill switching off and the new one's switching on.
 *
 * The caller renders an absolutely positioned indicator inside a
 * positioned container, gives each item's highlight box to `register`, and
 * passes the active key. The indicator is placed over that box by measured
 * rects — relative to the container, so it works whatever sits between them
 * — and travels there on every later change. The first placement, and every
 * placement under reduced motion, is instant: an indicator that flies in
 * from the corner on mount reads as a glitch.
 *
 * A resize re-places it without easing (a rotation, the keyboard), since
 * that is the layout moving, not the selection.
 */
export function useSlidingIndicator<K extends string>(
  active: K | null,
  motion: IndicatorMotion = "slide",
) {
  const containerRef = useRef<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const items = useRef(new Map<K, HTMLElement>());
  /** Where the indicator is now, or null before the first placement. */
  const at = useRef<Box | null>(null);
  /** The pending second half of a stretch. */
  const settleTimer = useRef<number | null>(null);

  const register = (k: K) => (el: HTMLElement | null) => {
    if (el) items.current.set(k, el);
    else items.current.delete(k);
  };

  const activeRef = useRef(active);
  activeRef.current = active;
  const motionRef = useRef(motion);
  motionRef.current = motion;

  const place = (animate: boolean) => {
    const ind = indicatorRef.current;
    const box = containerRef.current;
    const k = activeRef.current;
    const target = k ? items.current.get(k) : undefined;
    if (!ind || !box) return;
    const cancelSettle = () => {
      if (settleTimer.current !== null) {
        window.clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
    };
    if (!target) {
      cancelSettle();
      ind.style.opacity = "0";
      at.current = null;
      return;
    }
    const c = box.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const next: Box = {
      left: t.left - c.left - box.clientLeft,
      top: t.top - c.top - box.clientTop,
      width: t.width,
      height: t.height,
    };
    const from = at.current;
    const moved =
      from !== null &&
      (Math.abs(from.left - next.left) > 0.5 ||
        Math.abs(from.width - next.width) > 0.5 ||
        Math.abs(from.top - next.top) > 0.5);
    const ease = animate && moved && !isReducedMotion();
    const write = (b: Box, transition: string) => {
      ind.style.transition = transition;
      ind.style.left = `${b.left}px`;
      ind.style.top = `${b.top}px`;
      ind.style.width = `${b.width}px`;
      ind.style.height = `${b.height}px`;
      ind.style.opacity = "1";
    };

    // A re-render with nothing to do — and, mid-stretch, must not cancel the
    // pending settle.
    if (from && !moved) return;
    cancelSettle();
    if (!ease || !from) {
      write(next, "none");
    } else if (motionRef.current === "spring") {
      write(next, props(320, "cubic-bezier(0.34, 1.45, 0.64, 1)"));
    } else if (motionRef.current === "stretch") {
      const left = Math.min(from.left, next.left);
      const right = Math.max(from.left + from.width, next.left + next.width);
      write(
        { left, top: next.top, width: right - left, height: next.height },
        props(REACH_MS, "cubic-bezier(0.4, 0, 1, 1)"),
      );
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = null;
        write(next, props(SETTLE_MS, "cubic-bezier(0, 0, 0.2, 1)"));
      }, REACH_MS);
    } else {
      write(next, SLIDE_TRANSITION);
    }
    at.current = next;
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  // Every commit: the active item can also change size, not only identity,
  // and measuring is cheap. Nothing moves when nothing changed.
  useLayoutEffect(() => {
    placeRef.current(true);
  });

  // Once: a resize of the container re-places without easing. The
  // observer's first report is the initial size, already handled above —
  // acting on it would snap a move that had just started.
  useLayoutEffect(() => {
    const box = containerRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      placeRef.current(false);
    });
    ro.observe(box);
    return () => {
      ro.disconnect();
      if (settleTimer.current !== null) {
        window.clearTimeout(settleTimer.current);
      }
    };
  }, []);

  return { containerRef, indicatorRef, register };
}
