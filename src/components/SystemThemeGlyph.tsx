// Shared "System (auto) appearance" glyph for the theme picker in both
// Settings surfaces (SettingsSheet.tsx, SettingsPanel.tsx). Replaces the old
// flat two-stop diagonal gradient (hardcoded sepia/dark hex, which looked
// wrong on the sepia/oled themes it wasn't drawn from) with a monochrome
// split-disc: a bold sun on the light half, a solid crescent moon on the
// dark half, inside a strong ring. Pure `currentColor`, so it inherits the
// surrounding button's `color: theme.ink` and reads correctly in all four
// themes with no hardcoded color of its own.
//
// v2 (fix round 1): the first pass (thin ring + faint divider + tiny
// dot-with-ray-ticks sun + a generic moon icon path scaled down to ~40%)
// read as "a small, hard-to-parse circle" in live testing — too many
// delicate, low-opacity, sub-2px shapes for a ~22-26px glyph. This version
// uses fewer, bigger, bolder shapes instead: a heavier ring, a larger sun
// core with thicker/longer rays, and a genuinely fat crescent (not a shrunk
// icon-sized one) built from two overlapping circles via an SVG <mask> — the
// mask reveals whatever is truly behind the icon (correct regardless of a
// caller's background being a flat token or a translucent one like
// `theme.hover`), rather than requiring us to know/match an exact fill color.

import { useId } from "react";

export function SystemThemeGlyph({ size = 22 }: { size?: number }) {
  // Unique per instance so two glyphs rendered at once (however unlikely
  // today) never collide on the same mask id.
  const maskId = `system-theme-glyph-moon-mask-${useId()}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="24"
          height="24"
        >
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <circle cx="18.15" cy="10.7" r="3.05" fill="black" />
        </mask>
      </defs>
      {/* outer ring */}
      <circle cx="12" cy="12" r="9.3" stroke="currentColor" strokeWidth="1.75" />
      {/* center divider, hinting at the light/dark split */}
      <line
        x1="12"
        y1="3.7"
        x2="12"
        y2="20.3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.4"
      />
      {/* sun — light half: a bigger core, 4 short bold rays */}
      <circle cx="7.35" cy="12" r="2.35" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M7.35 9.65V8.15" />
        <path d="M7.35 14.35V15.85" />
        <path d="M5.69 10.34L4.63 9.28" />
        <path d="M5.69 13.66L4.63 14.72" />
      </g>
      {/* moon — dark half: a solid disc with a bite masked out of it,
          producing a fat, unambiguous crescent instead of a thin sliver */}
      <circle
        cx="16.3"
        cy="12"
        r="3.7"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
