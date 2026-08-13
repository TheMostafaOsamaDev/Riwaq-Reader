// Design tokens — themes, highlight palette, font stacks.
// Mirrors the prototype's `reader-core.jsx`, but typed.

export type ThemeKey = "light" | "sepia" | "dark" | "oled";

/** Stored theme preference: the four concrete themes plus "system",
 *  which resolves to light/dark from the OS `prefers-color-scheme`. */
export type ThemePref = ThemeKey | "system";

/** Resolve a stored preference to a concrete theme key. "system" maps to
 *  dark/light from the OS setting; the four concrete keys pass through. */
export function resolveTheme(pref: ThemePref, prefersDark: boolean): ThemeKey {
  if (pref === "system") return prefersDark ? "dark" : "light";
  return pref;
}

export interface Theme {
  bg: string;
  paper: string;
  ink: string;
  muted: string;
  rule: string;
  /** A bolder variant of `rule` for edges that need to register against
   *  shadows or larger surfaces (e.g. the mobile bottom-nav top border).
   *  Same hue family as `rule`, ~1.6× the alpha. */
  ruleStrong: string;
  chrome: string;
  chromeInk: string;
  /** Translucent overlay tint for hover/press on surfaces whose base
   *  background is TRANSPARENT (e.g. list rows). Do NOT use it to replace an
   *  opaque `chrome` fill — the element would lose its fill and wash out
   *  against a backdrop. For chrome-filled controls use `chromeHover`. */
  hover: string;
  /** Opaque hover/press fill for controls whose base background is `chrome`
   *  (pills, chips, chrome buttons). A slightly darker (light themes) or
   *  lighter (dark themes) sibling of `chrome`, so the control keeps a solid
   *  fill and the state change stays legible on any background. */
  chromeHover: string;
}

export const THEMES: Record<ThemeKey, Theme> = {
  sepia: {
    bg: "#f4ecd8",
    paper: "#f4ecd8",
    ink: "#3a2f1f",
    // Darkened from #8b7355 to clear WCAG AA (4.5:1) for secondary text on
    // paper/bg/chrome (was ~3.4:1). Same warm hue, lower lightness.
    muted: "#6f5a3d",
    rule: "rgba(58,47,31,0.14)",
    ruleStrong: "rgba(58,47,31,0.22)",
    chrome: "#ebe0c5",
    chromeInk: "#5a4a2e",
    hover: "rgba(58,47,31,0.06)",
    chromeHover: "#e0d3b2",
  },
  light: {
    bg: "#faf8f3",
    paper: "#ffffff",
    ink: "#1f1a14",
    // Darkened from #8b7e6a to clear WCAG AA (4.5:1) on paper/bg/chrome.
    muted: "#6e6250",
    rule: "rgba(31,26,20,0.10)",
    ruleStrong: "rgba(31,26,20,0.18)",
    chrome: "#f0ece2",
    chromeInk: "#3a332a",
    hover: "rgba(31,26,20,0.05)",
    chromeHover: "#e5ded0",
  },
  dark: {
    bg: "#1a1614",
    paper: "#1a1614",
    ink: "#d8cbb0",
    // Lightened from #887a60 to clear WCAG AA (4.5:1) for secondary text on
    // the dark surfaces (was ~3.9:1). Same warm hue, higher lightness.
    muted: "#9c8e70",
    rule: "rgba(216,203,176,0.14)",
    ruleStrong: "rgba(216,203,176,0.22)",
    chrome: "#24201c",
    chromeInk: "#c4b89c",
    hover: "rgba(216,203,176,0.06)",
    chromeHover: "#322d27",
  },
  oled: {
    bg: "#000000",
    paper: "#000000",
    ink: "#b8ad94",
    // Lightened from #6a6148 to clear WCAG AA (4.5:1) on the near-black
    // surfaces (was ~3.2:1).
    muted: "#8a7f61",
    rule: "rgba(184,173,148,0.10)",
    ruleStrong: "rgba(184,173,148,0.18)",
    chrome: "#0c0a08",
    chromeInk: "#a89d84",
    hover: "rgba(184,173,148,0.05)",
    chromeHover: "#211d17",
  },
};

export type HighlightColor = "yellow" | "blue" | "pink" | "green";

export const HIGHLIGHT_COLORS: Record<
  HighlightColor,
  { light: string; dark: string; dot: string }
> = {
  yellow: {
    light: "rgba(232,197,78,0.32)",
    dark: "rgba(232,197,78,0.26)",
    dot: "#d4a84a",
  },
  blue: {
    light: "rgba(120,160,210,0.32)",
    dark: "rgba(120,160,210,0.28)",
    dot: "#6b8cb5",
  },
  pink: {
    light: "rgba(220,140,170,0.32)",
    dark: "rgba(220,140,170,0.28)",
    dot: "#c2708c",
  },
  green: {
    light: "rgba(140,180,130,0.32)",
    dark: "rgba(140,180,130,0.26)",
    dot: "#7ba570",
  },
};

export function hlBg(color: HighlightColor, themeKey: ThemeKey): string {
  const isDark = themeKey === "dark" || themeKey === "oled";
  return HIGHLIGHT_COLORS[color][isDark ? "dark" : "light"];
}

export type FontFamilyKey =
  | "serif"
  | "sans"
  | "dyslexic"
  | "cairo"
  | "lateef"
  | "tajawal";

// UI sans is Readex Pro — a variable Latin+Arabic family, so Arabic glyphs
// render in the same family instead of falling through to an OS default.
// Serif reading/display stacks still list Readex Pro after their Latin
// primary so Arabic titles/body text pick it up via per-glyph fallback.
//
// Cairo / Lateef / Tajawal are Arabic reading fonts self-hosted under
// /public/fonts/reading/. Each lists an Amiri/Readex/system sans fallback
// so Latin glyphs interleaved in the text render in a compatible family
// instead of the browser default.
export const FONT_STACKS: Record<FontFamilyKey, string> = {
  serif:
    '"Literata", "Iowan Old Style", "Source Serif Pro", "Readex Pro", Georgia, serif',
  sans: '"Readex Pro", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  dyslexic:
    '"Atkinson Hyperlegible", "Lexend", "Readex Pro", system-ui, sans-serif',
  cairo: '"Cairo", "Readex Pro", system-ui, sans-serif',
  lateef: '"Lateef", "Amiri", "Readex Pro", serif',
  tajawal: '"Tajawal", "Readex Pro", system-ui, sans-serif',
};

export const FONT_FAMILY_LABELS: Record<FontFamilyKey, string> = {
  serif: "Serif",
  sans: "Sans",
  dyslexic: "Dyslexic",
  cairo: "Cairo",
  lateef: "Lateef",
  tajawal: "Tajawal",
};

export const FONT_SERIF_DISPLAY =
  '"Fraunces", "Literata", "Readex Pro", Georgia, serif';

// Match anything in the Arabic Unicode blocks (base, supplement, extended-A,
// presentation forms A & B). Used to decide whether to render a book title
// in the editorial Fraunces stack or fall back to the UI's Readex Pro so
// digits and punctuation match the Arabic glyphs visually.
const ARABIC_RANGE =
  /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function isArabicTitle(title: string): boolean {
  return ARABIC_RANGE.test(title);
}

/** Pick the right title font stack for a book whose title may be Arabic.
 *  - Arabic / mixed: FONT_STACKS.sans (Readex Pro), so digits and Latin
 *    punctuation interleaved with Arabic don't fall through to Fraunces.
 *  - Pure Latin: FONT_SERIF_DISPLAY (Fraunces), the editorial display feel. */
export function titleFontFor(title: string): string {
  return isArabicTitle(title) ? FONT_STACKS.sans : FONT_SERIF_DISPLAY;
}

// BCP-47 language subtags whose script is right-to-left. We only check the
// primary subtag (before the first hyphen), so `ar-EG`, `fa-IR`, etc. all
// resolve correctly.
const RTL_LANGS = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi"]);

/** True when the book's language tag indicates an RTL script. Used to
 *  auto-flip column / text direction without making the user toggle it. */
export function isRtlLanguage(language: string | undefined | null): boolean {
  if (!language) return false;
  const primary = language.toLowerCase().split(/[-_]/)[0];
  return RTL_LANGS.has(primary);
}
export const FONT_ARABIC =
  '"Amiri", "Noto Naskh Arabic", "Scheherazade New", serif';

export const ACCENT = "#c96442"; // warm copper amber, matches design
