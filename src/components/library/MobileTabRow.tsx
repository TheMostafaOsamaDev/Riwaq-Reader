import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import {
  type Theme,
  Z_LOCAL,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { TABS } from "./tabs";
import type { LibraryTab } from "./tabs";

export interface MobileTabRowProps {
  theme: Theme;
  tab: LibraryTab;
  setTab: (t: LibraryTab) => void;
}

/** Status filter pills under the mobile "Library" header.
 *
 *  Behaviors layered in top of the plain pill row:
 *    - Hidden scrollbar in both webkit + Firefox + Edge.
 *    - Fade-in chevron arrows on the left/right when overflow exists
 *      in that direction. Tapping an arrow scrolls one viewport-width
 *      toward that side. Arrows fade out (transition opacity) when
 *      the scroller hits the corresponding edge.
 *    - Animated active background: a single absolute-positioned
 *      "indicator" sits beneath whichever pill is active. Tapping a
 *      different pill animates `left + width` to the new pill's
 *      bounding box rather than instantly flipping the fill, so the
 *      change reads as a slide.
 *
 *  Store tab from the desktop TABS list is intentionally skipped —
 *  Store toggling lives in the bottom nav (`globe` icon). */
export function MobileTabRow({ theme, tab, setTab }: MobileTabRowProps) {
  const { tr, dir } = useI18n();
  const rtl = dir === "rtl";
  const items = useMemo<typeof TABS>(
    () => TABS.filter((t) => t.key !== "store"),
    [],
  );
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<Map<LibraryTab, HTMLButtonElement>>(new Map());
  const indicatorRef = useRef<HTMLDivElement>(null);
  const indicatorInitialized = useRef(false);

  const [canScrollToStart, setCanScrollToStart] = useState(false);
  const [canScrollToEnd, setCanScrollToEnd] = useState(false);

  // Recompute the scroll-edge state. Called on scroll, mount, and on
  // active-pill change (in case the pill widths drove a layout shift).
  // Same RTL normalization as SectionCarousel.tsx's `recompute()`: in an
  // RTL container, scrollLeft is 0 at the right edge and goes negative as
  // the user scrolls toward the left content (older WebKit grows positive
  // instead) — normalize to "distance from visual start" so the math reads
  // the same in both directions.
  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const sl = el.scrollLeft;
    const distFromStart = rtl ? Math.abs(sl) : sl;
    const distFromEnd = max - distFromStart;
    setCanScrollToStart(distFromStart > 1);
    setCanScrollToEnd(distFromEnd > 1);
  }, [rtl]);

  useEffect(() => {
    updateEdges();
    // ResizeObserver covers the case where the parent's width
    // changed (e.g. portrait → landscape) without a scroll event.
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateEdges]);

  // Position the active-pill background indicator. On the very first
  // layout we set it without transition so the indicator appears
  // already-in-place; subsequent updates animate.
  useEffect(() => {
    const el = pillRefs.current.get(tab);
    const indicator = indicatorRef.current;
    const scroller = scrollerRef.current;
    if (!el || !indicator || !scroller) return;
    const left = el.offsetLeft;
    const width = el.offsetWidth;
    if (!indicatorInitialized.current) {
      indicator.style.transition = "none";
      indicator.style.left = `${left}px`;
      indicator.style.width = `${width}px`;
      indicator.style.opacity = "1";
      // Re-enable transitions on the next frame so subsequent
      // tab changes animate.
      requestAnimationFrame(() => {
        if (indicator) {
          indicator.style.transition =
            "left 240ms cubic-bezier(0.4, 0.0, 0.2, 1), width 240ms cubic-bezier(0.4, 0.0, 0.2, 1)";
        }
      });
      indicatorInitialized.current = true;
    } else {
      indicator.style.left = `${left}px`;
      indicator.style.width = `${width}px`;
    }
    // Scroll the active pill into view if it's offscreen — happens
    // on portrait↔landscape flips where the layout shrinks.
    const overflowsLeft = left < scroller.scrollLeft;
    const overflowsRight =
      left + width > scroller.scrollLeft + scroller.clientWidth;
    if (overflowsLeft || overflowsRight) {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [tab]);

  const scrollBy = useCallback(
    (edge: "start" | "end") => {
      const el = scrollerRef.current;
      if (!el) return;
      const step = Math.max(el.clientWidth * 0.7, 120);
      // Same RTL sign-flip as SectionCarousel.tsx's `scrollByDir()`: the edges
      // are logical, but scrollLeft runs the other way in an RTL container
      // (0 at the start, negative toward the end).
      const signed = (edge === "start" ? -1 : 1) * step * (rtl ? -1 : 1);
      el.scrollBy({ left: signed, behavior: "smooth" });
    },
    [rtl],
  );

  return (
    <div
      style={{
        position: "relative",
        // Inline-style scrollbar hide doesn't fully cover webkit;
        // the surrounding rule is set globally via global.css. The
        // belt-and-suspenders here is just `scrollbarWidth: 'none'`
        // for Firefox + `msOverflowStyle` for legacy Edge.
      }}
    >
      <div
        ref={scrollerRef}
        onScroll={updateEdges}
        className="riwaq-pill-row"
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          position: "relative",
          // The indicator is absolute-positioned in this same container,
          // so the scroller must be the position context.
          paddingBottom: 2,
        }}
      >
        {/* Animated active-pill background. Sits underneath the buttons at
            `Z_LOCAL.under`; button text stays on top at `Z_LOCAL.base`.
            Color picks up the theme's ink + bg switch like the old
            inline fill did. */}
        <div
          ref={indicatorRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            height: "100%",
            left: 0,
            width: 0,
            opacity: 0,
            background: theme.ink,
            borderRadius: 18,
            pointerEvents: "none",
            zIndex: Z_LOCAL.under,
          }}
        />
        {items.map(({ key, msgKey }) => {
          const active = key === tab;
          return (
            <button
              key={key}
              ref={(el) => {
                if (el) pillRefs.current.set(key, el);
                else pillRefs.current.delete(key);
              }}
              onClick={() => setTab(key)}
              style={{
                flexShrink: 0,
                position: "relative",
                zIndex: Z_LOCAL.base,
                border: `0.5px solid ${active ? "transparent" : theme.rule}`,
                background: "transparent",
                color: active ? theme.bg : theme.muted,
                padding: "7px 14px",
                borderRadius: 18,
                fontSize: 12.5,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "color 200ms ease",
              }}
            >
              {tr(msgKey)}
            </button>
          );
        })}
      </div>
      <PillScrollArrow
        theme={theme}
        edge="start"
        visible={canScrollToStart}
        onClick={() => scrollBy("start")}
      />
      <PillScrollArrow
        theme={theme}
        edge="end"
        visible={canScrollToEnd}
        onClick={() => scrollBy("end")}
      />
    </div>
  );
}

export interface PillScrollArrowProps {
  theme: Theme;
  /** Which end of the strip this arrow sits at, in reading order — not a
   *  physical side. Under RTL "start" is the right-hand edge. */
  edge: "start" | "end";
  visible: boolean;
  onClick: () => void;
}

/** Floating chevron-arrow button overlaying the pill scroller's edge.
 *  Fades in only when there's overflow content in that direction; the
 *  button stays mounted across visibility transitions so the opacity
 *  animates smoothly (unmounting + remounting on every scroll would
 *  pop). When invisible the button is `pointer-events: none` so it
 *  doesn't eat taps meant for the pill below. */
export function PillScrollArrow({
  theme,
  edge,
  visible,
  onClick,
}: PillScrollArrowProps) {
  const { tr } = useI18n();
  return (
    <button
      onClick={onClick}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      aria-label={tr(
        edge === "start" ? "library.scrollTabsStart" : "library.scrollTabsEnd",
      )}
      style={{
        position: "absolute",
        top: "50%",
        // Logical inset, not `left`/`right`: whether there is more strip to
        // reach is decided in reading order, so the arrow announcing it has to
        // sit on the matching edge. Pinning it physically put both arrows on
        // the wrong side of an RTL strip — at the start, the "more this way"
        // arrow appeared on the right, pointing away from the content.
        [edge === "start" ? "insetInlineStart" : "insetInlineEnd"]: 0,
        transform: "translateY(-50%)",
        // Above the pills, which carry `Z_LOCAL.base` of their own. Without this
        // the arrow rendered *under* them: at the start edge it sat behind a
        // half-scrolled pill and read as simply missing, which is why only the
        // end-edge arrow was ever noticed.
        zIndex: Z_LOCAL.raised,
        width: 28,
        height: 28,
        borderRadius: 14,
        border: `0.5px solid ${theme.rule}`,
        background: theme.bg,
        color: theme.muted,
        cursor: visible ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 180ms ease",
        boxShadow: `0 1px 4px ${theme.bg}`,
        flexShrink: 0,
      }}
    >
      {/* `rtl-flip-x` mirrors the glyph under RTL, so "toward the start" still
          points at the start rather than away from it. */}
      <Icon
        name={edge === "start" ? "arrowL" : "arrowR"}
        size={14}
        className="rtl-flip-x"
      />
    </button>
  );
}
