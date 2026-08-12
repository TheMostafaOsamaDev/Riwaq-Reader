import type { CSSProperties } from "react";
import type { ThemeKey } from "../styles/tokens";

// Theme-aware app mark. Light/sepia themes show the parchment tile;
// dark/oled show the near-black tile. Both live in public/brand/ and are
// the same phoenix used for the OS launcher icon, so the in-app brand
// matches the installed icon and flips with the active (resolved) theme.
const SRC: Record<ThemeKey, string> = {
  light: "/brand/icon-light.png",
  sepia: "/brand/icon-light.png",
  dark: "/brand/icon-dark.png",
  oled: "/brand/icon-dark.png",
};

export function BrandMark({
  themeKey,
  size = 88,
  style,
}: {
  themeKey: ThemeKey;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <img
      src={SRC[themeKey]}
      alt="رواق"
      width={size}
      height={size}
      draggable={false}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        display: "block",
        ...style,
      }}
    />
  );
}
