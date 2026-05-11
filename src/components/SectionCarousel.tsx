// Horizontal-scrolling row of novel cards with left/right arrow buttons.
//
// The arrows fade in/out based on whether there's anything to scroll to
// in that direction — when the user is at the start, the left arrow
// hides; at the end, the right arrow hides. Click an arrow to scroll
// by ~4 card widths smooth-style. Touch/wheel scroll still works
// natively; the arrows are an additional affordance, not a replacement.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Theme } from "../styles/tokens";
import { Icon } from "./Icon";

interface Props {
  theme: Theme;
  /** RTL-aware. When the section's source language is RTL the arrows
   *  swap visually (the "next" arrow points left, "previous" right) so
   *  pressing right-arrow always scrolls toward the right edge of the
   *  viewport regardless of language. */
  rtl?: boolean;
  /** How far to advance per arrow click, in pixels. Default: ~3 cards
   *  worth (140px card width + 14px gap × 3 = 462). */
  step?: number;
  /** Width of one card slot — used to compute the snap target. The
   *  carousel doesn't render cards itself; callers do via children. */
  cardWidth?: number;
  /** Gap between cards, matched against the carousel's own gap so the
   *  scroll math lands on a card edge. */
  gap?: number;
  children: ReactNode;
}

export function SectionCarousel({
  theme,
  rtl = false,
  step,
  cardWidth = 140,
  gap = 14,
  children,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const stepPx = step ?? (cardWidth + gap) * 3;

  // Recompute arrow visibility on scroll + on mount + on resize. The
  // resize observer catches the case where window-resize changes how
  // much fits on screen.
  const recompute = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // In an RTL container, scrollLeft is 0 at the right edge and goes
    // negative as the user scrolls toward the left content — except in
    // older WebKit where it grows positive. Normalize to "distance from
    // visual start" so the math reads the same in both directions.
    const sl = el.scrollLeft;
    const distFromStart = rtl ? Math.abs(sl) : sl;
    const distFromEnd = max - distFromStart;
    // Tiny floating-point tolerance — scrolling to the absolute edge
    // can land at e.g. 0.5px due to subpixel layout.
    setCanScrollLeft(distFromStart > 2);
    setCanScrollRight(distFromEnd > 2);
  }, [rtl]);

  // Run the first measure in a layout effect so we read scrollWidth
  // *after* the browser has laid out children but *before* paint —
  // prevents an initial flash of "both arrows visible" before the
  // measurement catches up. The follow-up rAF + scheduled retry covers
  // the case where children's intrinsic widths depend on async-loading
  // images, so scrollWidth grows after our first read.
  useLayoutEffect(() => {
    recompute();
    const raf = requestAnimationFrame(recompute);
    const t1 = window.setTimeout(recompute, 60);
    const t2 = window.setTimeout(recompute, 400);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [recompute]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => recompute();
    el.addEventListener("scroll", onScroll, { passive: true });
    // Observe both the scroller AND its first child so that we react
    // to children growing (e.g., images decoding) and not just the
    // viewport changing.
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    for (const child of Array.from(el.children)) {
      ro.observe(child);
    }
    // MutationObserver picks up children being added/removed (e.g.,
    // when the parent re-renders the section's cards). Re-run measure
    // then.
    const mo = new MutationObserver(recompute);
    mo.observe(el, { childList: true, subtree: false });
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
    };
  }, [recompute]);

  const scrollByDir = useCallback(
    (dir: "left" | "right") => {
      const el = scrollerRef.current;
      if (!el) return;
      // In RTL the visual "right" means a more-negative (or
      // ahead-in-flow) scrollLeft. We translate the user-visual
      // intent into the right axis automatically.
      const signed =
        (dir === "right" ? 1 : -1) * stepPx * (rtl ? -1 : 1);
      el.scrollBy({ left: signed, behavior: "smooth" });
    },
    [rtl, stepPx],
  );

  return (
    <div style={{ position: "relative" }}>
      <ArrowButton
        theme={theme}
        side="left"
        visible={canScrollLeft}
        onClick={() => scrollByDir("left")}
      />
      <ArrowButton
        theme={theme}
        side="right"
        visible={canScrollRight}
        onClick={() => scrollByDir("right")}
      />
      <div
        ref={scrollerRef}
        className="no-scrollbar"
        style={{
          display: "flex",
          gap,
          overflowX: "auto",
          overflowY: "hidden",
          paddingBottom: 8,
          scrollSnapType: "x proximity",
          scrollBehavior: "smooth",
          // Padding for the arrow buttons so they don't cover the first
          // / last card — only applies when an arrow is visible, so the
          // padding is symmetric to keep layout stable.
          paddingInline: 4,
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface ArrowProps {
  theme: Theme;
  side: "left" | "right";
  visible: boolean;
  onClick: () => void;
}

function ArrowButton({ theme, side, visible, onClick }: ArrowProps) {
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Scroll left" : "Scroll right"}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      style={{
        position: "absolute",
        top: "50%",
        [side]: 4,
        transform: "translateY(-50%)",
        width: 32,
        height: 32,
        borderRadius: 16,
        background: theme.bg,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
        cursor: visible ? "pointer" : "default",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 160ms ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
        // Carousel arrows compete with the scroller behind for hover
        // events; the arrow stays above by virtue of z-index but we
        // also disable text-selection on it so a quick drag doesn't
        // select the icon glyph.
        userSelect: "none",
      }}
    >
      <Icon name={side === "left" ? "arrowL" : "arrowR"} size={14} />
    </button>
  );
}
