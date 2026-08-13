// Shared "System (auto) appearance" glyph for the theme picker in both
// Settings surfaces (SettingsSheet.tsx, SettingsPanel.tsx). Replaces the old
// flat two-stop diagonal gradient (hardcoded sepia/dark hex, which looked
// wrong on the sepia/oled themes it wasn't drawn from). Pure `currentColor`,
// so it inherits the surrounding button's `color: theme.ink` and reads
// correctly in all four themes with no hardcoded color of its own.
//
// v3 (fix round 2): the sun+moon composition (v1) and its bolder follow-up
// (v2, a solid disc + masked crescent) both still read as "not right and
// not visible" / "a small, hard-to-parse circle" in live testing — too many
// secondary shapes for a ~22-26px glyph. Replaced entirely with the
// macOS-standard "Auto appearance" mark: one circle, left half filled
// solid, right half just the ring outline, split by one crisp vertical
// diameter. Nothing else — the strong solid/hollow contrast is the whole
// design, and it's legible at a glance at any of the sizes both surfaces
// use (22px / 26px).

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
      {/* ring — the right (hollow/outline) half reads as "light" */}
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
      {/* left half filled solid — reads as "dark"; the straight vertical
          edge against the ring is the light/dark divider */}
      <path d="M12 3A9 9 0 0 0 12 21Z" fill="currentColor" />
    </svg>
  );
}
