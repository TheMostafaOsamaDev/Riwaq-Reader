// Reusable cinematic hero shell: a blurred, zoomed backdrop image behind a
// dark gradient scrim, with a content slot bottom-aligned on top. The scrim
// is always dark and the caller's content is expected to be light-on-dark
// (see Button's `surface="onImage"`), so a hero reads consistently across all
// four app themes — the imagery, not the theme, sets the mood.
//
// Books only ship a portrait cover, so the book-detail page feeds that same
// cover in as `backdropUrl`: blurred + scaled up it fills the wide banner.
// When there's no usable image (or it fails to load) we fall back to a warm
// accent gradient so the frame is never a flat void.

import { useState, type CSSProperties, type ReactNode } from "react";
import { ACCENT } from "../styles/tokens";
import { EASE, MOTION, useReducedMotion } from "../styles/motion";

interface Props {
  layout: "desktop" | "mobile";
  /** Image blurred + zoomed to fill the banner. Falls back to an accent
   *  gradient when absent or when it fails to load. */
  backdropUrl?: string;
  /** Seed colour for the fallback gradient (defaults to the app accent). */
  accent?: string;
  /** Overlaid, bottom-aligned content — expected to be light-on-dark. */
  children: ReactNode;
  /** Minimum banner height in px. Defaults scale with `layout`. */
  minHeight?: number;
  /** Extra styles merged onto the outer frame. */
  style?: CSSProperties;
}

export function Hero({
  layout,
  backdropUrl,
  accent = ACCENT,
  children,
  minHeight,
  style,
}: Props) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showImage = Boolean(backdropUrl) && !failed;
  const isMobile = layout === "mobile";
  const resolvedMinHeight = minHeight ?? (isMobile ? 380 : 360);

  return (
    <div
      style={{
        position: "relative",
        minHeight: resolvedMinHeight,
        // Float the hero: inset from the view edges with rounded corners + a
        // soft shadow so it reads as a raised card rather than a full-bleed
        // banner. `overflow: hidden` clips the blurred backdrop to the radius.
        margin: isMobile ? "6px 12px 16px" : "8px 24px 22px",
        borderRadius: isMobile ? 18 : 24,
        boxShadow: "0 14px 40px rgba(0,0,0,0.34)",
        display: "flex",
        alignItems: "flex-end",
        overflow: "hidden",
        // A dark base so text is legible from the first paint, before the
        // backdrop image has decoded (and as the floor under its blur).
        background: "#141210",
        // New stacking context so the fixed z-indices below stay local.
        isolation: "isolate",
        ...style,
      }}
    >
      {/* Fallback accent gradient — always painted; the image (when present)
          sits on top of it, so a slow/failed load degrades gracefully. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 130% at 78% 15%, ${accent}59 0%, transparent 55%), linear-gradient(135deg, #221b16 0%, #14100d 100%)`,
        }}
      />
      {showImage && (
        <img
          src={backdropUrl}
          alt=""
          aria-hidden
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            // Blur softens the low-res upscale; the scale hides the soft
            // transparent edges blur leaves behind.
            filter: "blur(44px) saturate(1.25) brightness(0.82)",
            transform: "scale(1.25)",
            opacity: loaded || reduced ? 1 : 0,
            transition: reduced
              ? "none"
              : `opacity ${MOTION.slow}ms ${EASE.out}`,
          }}
        />
      )}
      {/* Scrim: bottom-heavy so the (bottom-aligned) content always sits on
          the darkest region, plus a gentle overall darken + top fade. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, rgba(0,0,0,0.90) 0%, rgba(0,0,0,0.66) 34%, rgba(0,0,0,0.40) 62%, rgba(0,0,0,0.34) 100%), linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, transparent 30%)",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          boxSizing: "border-box",
          padding: isMobile ? "24px 18px 22px" : "40px 40px 32px",
        }}
      >
        {children}
      </div>
    </div>
  );
}
