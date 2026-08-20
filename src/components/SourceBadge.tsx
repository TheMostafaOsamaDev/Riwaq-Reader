// A small reusable marker that a book comes from an external source (website),
// wrapping SourceIcon (favicon + globe fallback). Two shapes:
//
//   - "chip":   favicon + source name + an external-link glyph, on a frosted
//               glass surface. Sits in the hero's metadata over the dark
//               scrim, so it's styled light-on-dark like the hero actions.
//   - "corner": just the favicon tile, ringed + shadowed to lift off cover
//               art. Pinned to a Library card corner to flag source-backed
//               entries at a glance. The parent positions it.
//
// Reused by NovelDetailView's hero (chip) and the Library grid cards (corner).

import type { Theme } from "../styles/tokens";
import { Icon } from "./Icon";
import { SourceIcon } from "./SourceIcon";

interface Props {
  theme: Theme;
  /** Favicon URL; SourceIcon falls back to a globe glyph when absent. */
  iconUrl?: string;
  /** Source display name — shown in the "chip" variant, and used as the
   *  accessible label in both variants. */
  name?: string;
  variant: "chip" | "corner";
  /** Accessible label override (defaults to `name`). */
  label?: string;
}

export function SourceBadge({ theme, iconUrl, name, variant, label }: Props) {
  const a11y = label ?? name;

  if (variant === "corner") {
    return (
      <span
        role="img"
        aria-label={a11y}
        title={a11y}
        style={{
          display: "inline-flex",
          borderRadius: 7,
          // A white ring + drop shadow so a light favicon still reads when it
          // sits over pale cover art.
          boxShadow:
            "0 0 0 1.5px rgba(255,255,255,0.9), 0 2px 6px rgba(0,0,0,0.4)",
        }}
      >
        <SourceIcon
          theme={theme}
          iconUrl={iconUrl}
          size={22}
          radius={6}
          glyphSize={12}
        />
      </span>
    );
  }

  // chip
  return (
    <span
      role="img"
      aria-label={a11y}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        maxWidth: "100%",
        padding: "4px 10px 4px 4px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.13)",
        border: "0.5px solid rgba(255,255,255,0.24)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        color: "#ffffff",
      }}
    >
      <SourceIcon
        theme={theme}
        iconUrl={iconUrl}
        size={22}
        radius={6}
        glyphSize={12}
      />
      {name && (
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.2,
            color: "rgba(255,255,255,0.94)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {name}
        </span>
      )}
      <Icon
        name="externalLink"
        size={11}
        style={{ color: "rgba(255,255,255,0.6)", flexShrink: 0 }}
      />
    </span>
  );
}
