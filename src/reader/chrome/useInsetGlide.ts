// Changing how much room a scrolling reading surface keeps at its edges,
// without moving the sentence being read.
//
// Reclaiming 44px above the text moves every line 44px up the screen, because
// the inset is part of the scrollable content. So the inset is animated and
// `scrollTop` follows it frame for frame: the window reaches further into the
// chapter while the words hold still. See `heldScrollTop` for the arithmetic.
//
// Three approaches were tried before this one, and each failed in a way a
// screenshot pair cannot show:
//
//  - A TRANSFORM on the content, cheaper than a reflow per frame, is wrong
//    here: the reader finds its live paragraph by comparing
//    `getBoundingClientRect().top` against the scroller's, and a transform
//    between the two silently offsets that comparison — and with it the
//    position the reader saves and resumes from.
//
//  - A CSS TRANSITION armed inside the layout effect never runs at all. React
//    commits the new padding BEFORE layout effects, so the transition is armed
//    after the value it was meant to animate has already changed: the surface
//    snaps, and the follower only catches up on the next frame. Measured as
//    the full 44px of drift across the toggle, in both directions.
//
//  - A CSS TRANSITION armed up front does run, but the follower cannot keep
//    up with it. `getComputedStyle` reports the curve at the current time
//    while the frame being prepared paints at the next one, so the offset
//    trails the padding by a frame: ~7px of wobble, measured, in something
//    meant to hold perfectly still.
//
// So the curve is evaluated in JS (`cubicBezier` off the same motion tokens
// CSS would have used) and both sides are written from the same value in the
// same statement. Nothing is left to lag.
//
// The inset reaches the element as two CSS custom properties rather than as
// inline padding, because React owns the `padding` shorthand on this element
// and re-renders it on every scroll frame — an imperative `style.paddingTop`
// would be wiped out mid-animation. The properties are set here, unset when
// the animation ends, and fall back to the value React rendered, so the
// surface is correct before, during and after with no first-frame gap.

import { useLayoutEffect, useRef } from "react";
import { cubicBezier, EASE_POINTS, MOTION } from "../../styles/motion";
import { heldScrollTop } from "./focusInsets";

interface Options {
  /** The scrolling reading surface. Null in the paginated modes, which do not
   *  scroll: there the inset change lands in one layout pass and
   *  PaginatedView's own anchor keeps the tracked paragraph on the page, so
   *  there is nothing to follow. Animating it would be actively worse — its
   *  ResizeObserver would re-paginate the whole chapter on every frame. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Current top inset in px, WITHOUT any safe-area contribution. */
  top: number;
  /** Current bottom inset in px. Animated alongside, but nothing has to
   *  follow it — room at the foot only changes how far the scroller travels. */
  bottom: number;
  reducedMotion: boolean;
}

/** The custom properties the reading surface resolves its insets through.
 *  Read by DesktopReader's scroll container; see the note above. */
export const INSET_VAR_TOP = "--riwaq-reading-inset-top";
export const INSET_VAR_BOTTOM = "--riwaq-reading-inset-bottom";

const ease = cubicBezier(...EASE_POINTS.enter);

export function useInsetGlide({
  scrollRef,
  top,
  bottom,
  reducedMotion,
}: Options): void {
  // The insets last ASKED for, which is what says whether anything changed.
  const target = useRef({ top, bottom });
  // The insets currently PAINTED — where a new animation has to start from.
  //
  // Not the same as `target`, in two cases that both matter. Mid-flight the
  // two differ, and toggling focus twice inside 240ms is exactly where
  // starting from `target` would snap the text to the destination of an
  // animation the reader had just interrupted. And when the scroller is
  // absent — the paginated modes, or between reading-mode switches — this
  // still tracks what the next surface to appear will paint, so the toggle
  // after a mode switch does not animate out of a value nothing ever showed.
  //
  // Because it is right in both, no "has this element settled yet?" guard is
  // needed. An earlier version had one and it was worse than nothing: the
  // effect only re-runs when the INSETS change, not when the scroller mounts,
  // so the flag was still unset on the first focus toggle and the guard ate
  // the very transition it was meant to protect. (Measured: the first toggle
  // snapped 44px, and did not compensate at all under reduced motion.)
  const live = useRef({ top, bottom });
  const raf = useRef(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const changed =
      target.current.top !== top || target.current.bottom !== bottom;
    target.current = { top, bottom };
    if (!el || !changed) {
      live.current = { top, bottom };
      return;
    }

    window.cancelAnimationFrame(raf.current);
    const from = live.current;
    const start = el.scrollTop;
    const clear = () => {
      el.style.removeProperty(INSET_VAR_TOP);
      el.style.removeProperty(INSET_VAR_BOTTOM);
      live.current = { top, bottom };
    };

    if (reducedMotion) {
      // React has already committed the new insets, so the geometry is
      // final; all that is left is to be looking at the same line in it.
      clear();
      el.scrollTop = heldScrollTop(start, from.top, top);
      return;
    }

    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / MOTION.med);
      const e = ease(k);
      const insetTop = from.top + (top - from.top) * e;
      const insetBottom = from.bottom + (bottom - from.bottom) * e;
      el.style.setProperty(INSET_VAR_TOP, `${insetTop}px`);
      el.style.setProperty(INSET_VAR_BOTTOM, `${insetBottom}px`);
      // Same frame, same value: the offset is derived from the very inset
      // about to be painted, not read back off one already painted.
      el.scrollTop = heldScrollTop(start, from.top, insetTop);
      if (k >= 1) return clear();
      live.current = { top: insetTop, bottom: insetBottom };
      raf.current = window.requestAnimationFrame(step);
    };
    // The first frame runs synchronously, before this layout pass paints.
    // React's commit has already applied the FINAL insets, so leaving it to
    // `requestAnimationFrame` would let one frame paint at the destination —
    // the snap this whole hook exists to remove.
    step();
    return () => window.cancelAnimationFrame(raf.current);
  }, [scrollRef, top, bottom, reducedMotion]);
}
