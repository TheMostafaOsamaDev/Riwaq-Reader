// Reading color overrides — the pure logic behind the "Text color" / "Page
// color" reading settings. Kept framework-free so it's unit-testable and shared
// by the reflow reader, the DOCX cards, and the PDF duotone.
//
// A color value is either the sentinel "auto" (follow the active theme) or a
// CSS hex color ("#rgb" / "#rrggbb"). "auto" is a string on purpose: the
// Tweaks import guard in useTweaks.ts type-checks with `typeof`, and a string
// sentinel survives it where `null` (typeof "object") would be rejected.

import type { Theme } from "../styles/tokens";

/** Parse "#rgb" / "#rrggbb" to 8-bit RGB. Returns null for "auto", empty, or
 *  any non-hex value so callers can treat "unparseable" as "follow theme". */
function parseHex(color: string): [number, number, number] | null {
  if (typeof color !== "string") return null;
  let hex = color.trim();
  if (hex[0] !== "#") return null;
  hex = hex.slice(1);
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length !== 6 || /[^0-9a-fA-F]/.test(hex)) return null;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** True when the value is a usable color override (not "auto"/invalid). */
export function isColorSet(color: string): boolean {
  return parseHex(color) !== null;
}

/** sRGB → linear light, per WCAG 2.1 relative-luminance definition. */
function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** WCAG contrast ratio (1..21) between two colors, or null if either color
 *  can't be parsed (e.g. "auto"). Symmetric in its arguments. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA contrast threshold for normal body text. */
export const AA_BODY_CONTRAST = 4.5;

/** True when an ink/paper pair falls below the AA body threshold. Returns
 *  false when either color is unparseable — we don't warn about "auto". */
export function isLowContrast(ink: string, paper: string): boolean {
  const ratio = contrastRatio(ink, paper);
  if (ratio === null) return false;
  return ratio < AA_BODY_CONTRAST;
}

export interface ReadingColors {
  ink: string;
  paper: string;
}

/** Resolve the effective ink/paper for reflowable text and DOCX cards: an
 *  explicit override wins, otherwise fall back to the active theme's ink/bg. */
export function resolveReadingColors(
  theme: Theme,
  inkColor: string,
  paperColor: string,
): ReadingColors {
  return {
    ink: isColorSet(inkColor) ? inkColor : theme.ink,
    paper: isColorSet(paperColor) ? paperColor : theme.bg,
  };
}

/** GPU-only duotone recipe for a rasterized PDF page. The viewer grayscales
 *  the page host, then composites two `mix-blend-mode` overlays that remap the
 *  page's darks toward `ink` and its lights toward `paper`. All compositor work
 *  — no ImageData, no re-render, so it stays 60fps.
 *
 *  The blend modes flip with polarity. Normal (ink darker than paper): the
 *  page keeps its polarity, `lighten` lifts blacks→ink, `darken` pulls
 *  whites→paper. Inverted (ink lighter than paper, i.e. a dark-mode pick): the
 *  page is `invert`ed first — its blacks become white and vice-versa — and the
 *  blend modes swap, so light text survives instead of being crushed by a
 *  `darken` pass. */
export interface PdfDuotone {
  hostFilter: string;
  ink: { color: string; blend: string };
  paper: { color: string; blend: string };
}

// Endpoints for the un-overridden side, so a single override still has two
// anchors: text stays near-black, paper stays white.
const PDF_DEFAULT_INK = "#1a1a1a";
const PDF_DEFAULT_PAPER = "#ffffff";

/** Duotone recipe for the given overrides, or null when both are "auto" — in
 *  which case the PDF is left exactly as rendered (today's behavior). */
export function pdfDuotone(inkColor: string, paperColor: string): PdfDuotone | null {
  const inkSet = isColorSet(inkColor);
  const paperSet = isColorSet(paperColor);
  if (!inkSet && !paperSet) return null;

  const ink = inkSet ? inkColor : PDF_DEFAULT_INK;
  const paper = paperSet ? paperColor : PDF_DEFAULT_PAPER;

  // Compare endpoint luminance to pick polarity. parseHex is guaranteed non-null
  // here (both endpoints are either a set override or a hex default).
  const inkLum = relativeLuminance(parseHex(ink)!);
  const paperLum = relativeLuminance(parseHex(paper)!);
  const inverted = inkLum > paperLum; // light text on dark paper (dark mode)

  return inverted
    ? {
        hostFilter: "grayscale(1) invert(1)",
        ink: { color: ink, blend: "darken" },
        paper: { color: paper, blend: "lighten" },
      }
    : {
        hostFilter: "grayscale(1)",
        ink: { color: ink, blend: "lighten" },
        paper: { color: paper, blend: "darken" },
      };
}
