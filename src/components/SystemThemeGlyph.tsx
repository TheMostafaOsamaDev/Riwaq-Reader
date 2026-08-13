// Shared "System (auto) appearance" glyph for the theme picker in both
// Settings surfaces (SettingsSheet.tsx, SettingsPanel.tsx). Replaces the old
// flat two-stop diagonal gradient (hardcoded sepia/dark hex, which looked
// wrong on the sepia/oled themes it wasn't drawn from) with a monochrome
// split-disc: a small sun on the light half, a crescent moon on the dark
// half, divided by a thin ring — composed from the existing sun/moon Icon
// paths. Pure `currentColor`, so it inherits the surrounding button's
// `color: theme.ink` and reads correctly in all four themes with no
// hardcoded color of its own.

import { ICONS } from "./Icon";

export function SystemThemeGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {/* outer ring */}
      <circle
        cx="12"
        cy="12"
        r="9.4"
        stroke="currentColor"
        strokeWidth="1.3"
        opacity="0.9"
      />
      {/* center divider, hinting at the light/dark split */}
      <line
        x1="12"
        y1="4.2"
        x2="12"
        y2="19.8"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.3"
      />
      {/* sun — light half */}
      <circle cx="7.3" cy="12" r="2.1" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M7.3 9.5V8.2" />
        <path d="M7.3 14.5V15.8" />
        <path d="M5.66 10.36 4.66 9.06" />
        <path d="M5.66 13.64 4.66 14.94" />
      </g>
      {/* moon — dark half, reuses the shared crescent path */}
      <path
        d={ICONS.moon}
        fill="currentColor"
        transform="translate(11.66,6.96) scale(0.42)"
      />
    </svg>
  );
}
