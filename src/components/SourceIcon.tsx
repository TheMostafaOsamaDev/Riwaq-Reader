// The little icon shown for a source (website) in the store — its own
// favicon when it declares one, otherwise a generic globe glyph.
//
// `iconUrl` is treated as an opaque URL: bundled sources import a local
// asset (see registry.ts), and future sideloaded/third-party sources can
// point it at a remote favicon — both render through this one path. If the
// image is missing or fails to load, we fall back to the globe so a card
// never shows a broken image.

import { useState } from "react";
import type { Theme } from "../styles/tokens";
import { Icon } from "./Icon";

interface Props {
  theme: Theme;
  iconUrl?: string;
  /** Outer box edge length in px. */
  size: number;
  /** Corner radius of the box in px. */
  radius: number;
  /** Size of the fallback globe glyph in px. */
  glyphSize: number;
}

export function SourceIcon({ theme, iconUrl, size, radius, glyphSize }: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(iconUrl) && !failed;

  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        // Favicons are designed for a light browser-tab backdrop and often
        // ship on a transparent background, so sit them on a white tile for
        // legibility in both themes. The globe fallback keeps the adaptive
        // surface colour.
        background: showImage ? "#ffffff" : theme.bg,
        border: `0.5px solid ${theme.rule}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        color: theme.ink,
        padding: showImage ? Math.round(size * 0.14) : 0,
        boxSizing: "border-box",
      }}
    >
      {showImage ? (
        <img
          src={iconUrl}
          alt=""
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
      ) : (
        <Icon name="globe" size={glyphSize} />
      )}
    </div>
  );
}
