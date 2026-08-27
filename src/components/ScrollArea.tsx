// A scroll container with Riwaq's own overlay scrollbar.
//
// Generalises the floating bar that FixedPageViewer already ships: a real DOM
// thumb over a hidden native scrollbar, faded in while scrolling and out ~800ms
// after it stops, with no track behind it.
//
// Why a DOM thumb instead of styling `::-webkit-scrollbar`: the pseudo-element
// route renders differently per platform (WKWebView and Android WebView paint
// overlay bars that ignore parts of the styling, and headless Chromium ignores
// it outright), so its appearance can't be pinned down or tested. A DOM thumb
// looks and behaves identically everywhere and can be verified.
//
// The thumb is positioned imperatively through refs — scrolling must not push
// React renders.

import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useReducedMotion } from "../styles/motion";

/** Idle window before the thumb fades, matching FixedPageViewer's bar. */
const IDLE_MS = 800;
/** Inset from the container's top and bottom edges. */
const PAD = 3;
const THUMB_W = 5;
const MIN_THUMB_H = 28;
/** Opacity while visible — present but never loud over a page of text. */
const VISIBLE = 0.45;
/** How long the thumb takes to catch up to a new position.
 *
 *  Short on purpose. A wheel notch or a keyboard PageDown moves the content in
 *  one discrete jump, and without this the thumb teleports with it; easing the
 *  transform turns those steps into a glide. Push it much past ~150ms and the
 *  thumb visibly trails a continuous scroll instead of tracking it, which reads
 *  as lag rather than smoothness. Suppressed entirely while dragging the thumb
 *  — there, any easing means the bar lags the finger. */
const GLIDE_MS = 120;
const FADE_MS = 240;

export function ScrollArea({
  children,
  color,
  className,
  style,
  scrollStyle,
  alwaysVisible = false,
}: {
  children: ReactNode;
  /** Thumb colour. Pass a theme value — usually `theme.muted`. */
  color: string;
  className?: string;
  /** Applies to the outer (positioning) box. */
  style?: CSSProperties;
  /** Applies to the inner scrolling box. */
  scrollStyle?: CSSProperties;
  /** Keep the thumb painted instead of fading it after the idle window. For
   *  short, bounded lists — a picker where the bar doubles as the only cue
   *  that there is more below the fold. Long reading surfaces want the
   *  default, where the bar stays out of the way. Either way the thumb is
   *  hidden when there is nothing to scroll. */
  alwaysVisible?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const idle = useRef<number | undefined>(undefined);
  const raf = useRef(0);
  const reduced = useReducedMotion();

  const place = useCallback(() => {
    const el = scrollRef.current;
    const thumb = thumbRef.current;
    if (!el || !thumb) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    // Nothing to scroll — keep the thumb out of the way entirely.
    if (scrollHeight <= clientHeight + 2) {
      thumb.style.opacity = "0";
      return;
    }
    const trackH = clientHeight - PAD * 2;
    const thumbH = Math.max(MIN_THUMB_H, (clientHeight / scrollHeight) * trackH);
    const max = scrollHeight - clientHeight;
    const top = max > 0 ? (scrollTop / max) * (trackH - thumbH) : 0;
    thumb.style.height = `${thumbH}px`;
    thumb.style.transform = `translateY(${PAD + Math.max(0, top)}px)`;
    // A persistent bar has no idle state to fade from, so paint it as soon as
    // there is something to scroll — including on first layout, before any
    // scroll event has fired.
    if (alwaysVisible) thumb.style.opacity = String(VISIBLE);
  }, [alwaysVisible]);

  const flash = useCallback(() => {
    const el = scrollRef.current;
    const thumb = thumbRef.current;
    if (!el || !thumb || el.scrollHeight <= el.clientHeight + 2) return;
    thumb.style.opacity = String(VISIBLE);
    if (alwaysVisible) return;
    if (idle.current) window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      if (thumbRef.current) thumbRef.current.style.opacity = "0";
    }, IDLE_MS);
  }, [alwaysVisible]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      flash();
      if (raf.current) return;
      raf.current = window.requestAnimationFrame(() => {
        raf.current = 0;
        place();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Content or box size changing moves the thumb even without a scroll.
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    place();
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf.current) window.cancelAnimationFrame(raf.current);
      if (idle.current) window.clearTimeout(idle.current);
    };
  }, [place, flash]);

  const thumbTransition = reduced
    ? "none"
    : `opacity ${FADE_MS}ms ease, transform ${GLIDE_MS}ms ease-out`;

  // Dragging the thumb. Without this a bar that is invisible at rest would be
  // unusable with a mouse: you could never grab it to drag.
  const onThumbDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      const thumb = thumbRef.current;
      if (!el || !thumb) return;
      e.preventDefault();
      thumb.setPointerCapture(e.pointerId);
      // Track the finger exactly while dragging — easing here would read as
      // the bar lagging behind the pointer, not as smoothness.
      thumb.style.transition = "none";
      const startY = e.clientY;
      const startTop = el.scrollTop;
      const trackH = el.clientHeight - PAD * 2;
      const thumbH = thumb.getBoundingClientRect().height;
      const travel = trackH - thumbH;

      const move = (ev: PointerEvent) => {
        if (travel <= 0) return;
        const ratio = (ev.clientY - startY) / travel;
        el.scrollTop = startTop + ratio * (el.scrollHeight - el.clientHeight);
        flash();
      };
      const up = (ev: PointerEvent) => {
        thumb.releasePointerCapture(ev.pointerId);
        // Restore explicitly: React will not re-apply the inline style unless
        // something else makes this component render.
        thumb.style.transition = thumbTransition;
        thumb.removeEventListener("pointermove", move);
        thumb.removeEventListener("pointerup", up);
        thumb.removeEventListener("pointercancel", up);
      };
      thumb.addEventListener("pointermove", move);
      thumb.addEventListener("pointerup", up);
      thumb.addEventListener("pointercancel", up);
    },
    [flash, thumbTransition],
  );

  return (
    <div className={className} style={{ position: "relative", ...style }}>
      <div
        ref={scrollRef}
        className="no-scrollbar"
        style={{ overflowY: "auto", height: "100%", ...scrollStyle }}
      >
        {children}
      </div>
      <div
        ref={thumbRef}
        onPointerDown={onThumbDown}
        aria-hidden
        style={{
          position: "absolute",
          // Logical inset so the bar lands on the correct edge under dir=rtl.
          insetInlineEnd: 2,
          top: 0,
          width: THUMB_W,
          borderRadius: THUMB_W,
          background: color,
          opacity: 0,
          // No track element at all — the bar floats over the content.
          transition: thumbTransition,
          touchAction: "none",
          cursor: "grab",
        }}
      />
    </div>
  );
}
