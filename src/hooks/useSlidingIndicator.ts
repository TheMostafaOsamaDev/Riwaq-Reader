import { useLayoutEffect, useRef } from "react";
import { isReducedMotion } from "../styles/motion";

/** The library filter pills' motion (MobileTabRow), shared: same duration,
 *  same curve, so every "this one is selected" in the app moves alike. */
export const SLIDE_TRANSITION =
  "left 240ms cubic-bezier(0.4, 0.0, 0.2, 1), top 240ms cubic-bezier(0.4, 0.0, 0.2, 1), width 240ms cubic-bezier(0.4, 0.0, 0.2, 1), height 240ms cubic-bezier(0.4, 0.0, 0.2, 1)";

/**
 * One background that slides from the selected item to the next, instead
 * of the old item's fill switching off and the new one's switching on.
 *
 * The caller renders an absolutely positioned indicator inside a
 * positioned container, gives each item's highlight box to `register`, and
 * passes the active key. The indicator is placed over that box by measured
 * rects — relative to the container, so it works whatever sits between them
 * — and eases there on every later change. The first placement, and every
 * placement under reduced motion, is instant: an indicator that flies in
 * from the corner on mount reads as a glitch.
 *
 * A resize re-places it without easing (a rotation, the keyboard), since
 * that is the layout moving, not the selection.
 */
export function useSlidingIndicator<K extends string>(active: K | null) {
  const containerRef = useRef<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const items = useRef(new Map<K, HTMLElement>());
  const placed = useRef(false);

  const register = (k: K) => (el: HTMLElement | null) => {
    if (el) items.current.set(k, el);
    else items.current.delete(k);
  };

  const activeRef = useRef(active);
  activeRef.current = active;

  const place = (animate: boolean) => {
    const ind = indicatorRef.current;
    const box = containerRef.current;
    const k = activeRef.current;
    const target = k ? items.current.get(k) : undefined;
    if (!ind || !box) return;
    if (!target) {
      ind.style.opacity = "0";
      placed.current = false;
      return;
    }
    const c = box.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const ease = animate && placed.current && !isReducedMotion();
    ind.style.transition = ease ? SLIDE_TRANSITION : "none";
    ind.style.left = `${t.left - c.left - box.clientLeft}px`;
    ind.style.top = `${t.top - c.top - box.clientTop}px`;
    ind.style.width = `${t.width}px`;
    ind.style.height = `${t.height}px`;
    ind.style.opacity = "1";
    placed.current = true;
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  // Every commit: the active item can also change size (the expanding
  // style's label), not only identity, and measuring is cheap.
  useLayoutEffect(() => {
    placeRef.current(true);
  });

  // Once: a resize of the container re-places without easing. The
  // observer's first report is the initial size, already handled above —
  // acting on it would snap a slide that had just started.
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
    return () => ro.disconnect();
  }, []);

  return { containerRef, indicatorRef, register };
}
