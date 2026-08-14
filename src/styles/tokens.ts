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
  hover: string;
}

export const THEMES: Record<ThemeKey, Theme> = {
  sepia: {
    bg: "#f4ecd8",
    paper: "#f4ecd8",
    ink: "#3a2f1f",
    muted: "#8b7355",
    rule: "rgba(58,47,31,0.14)",
    ruleStrong: "rgba(58,47,31,0.22)",
    chrome: "#ebe0c5",
    chromeInk: "#5a4a2e",
    hover: "rgba(58,47,31,0.06)",
  },
  light: {
    bg: "#faf8f3",
    paper: "#ffffff",
    ink: "#1f1a14",
    muted: "#8b7e6a",
    rule: "rgba(31,26,20,0.10)",
    ruleStrong: "rgba(31,26,20,0.18)",
    chrome: "#f0ece2",
    chromeInk: "#3a332a",
    hover: "rgba(31,26,20,0.05)",
  },
  dark: {
    bg: "#1a1614",
    paper: "#1a1614",
    ink: "#d8cbb0",
    muted: "#887a60",
    rule: "rgba(216,203,176,0.14)",
    ruleStrong: "rgba(216,203,176,0.22)",
    chrome: "#24201c",
    chromeInk: "#c4b89c",
    hover: "rgba(216,203,176,0.06)",
  },
  oled: {
    bg: "#000000",
    paper: "#000000",
    ink: "#b8ad94",
    muted: "#6a6148",
    rule: "rgba(184,173,148,0.10)",
    ruleStrong: "rgba(184,173,148,0.18)",
    chrome: "#0c0a08",
    chromeInk: "#a89d84",
    hover: "rgba(184,173,148,0.05)",
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
/** The literal Readex-Pro sans stack. Used by BOOK CONTENT — the reader's
 *  "Sans" reading option and the generated cover's author line — so it stays
 *  fixed regardless of the chosen UI/chrome font. `FONT_STACKS.sans`, by
 *  contrast, resolves to the user-selectable chrome font via `--ui-font`. */
export const FONT_READING_SANS =
  '"Readex Pro", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';

export const FONT_STACKS: Record<FontFamilyKey, string> = {
  serif:
    '"Literata", "Iowan Old Style", "Source Serif Pro", "Readex Pro", Georgia, serif',
  // Chrome/UI sans — resolves to the selectable UI font via the `--ui-font`
  // variable, defaulting to Readex Pro when unset (see App + UI_FONT_STACKS).
  sans: 'var(--ui-font, "Readex Pro", -apple-system, BlinkMacSystemFont, system-ui, sans-serif)',
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

/** Selectable UI (app-chrome) font — distinct from the per-book reading
 *  `FontFamilyKey`. Applied through the `--ui-font` CSS variable that
 *  `FONT_STACKS.sans` falls back through. All families are Latin+Arabic. */
export type UiFontKey =
  | "readex"
  | "alexandria"
  | "almarai"
  | "cairo"
  | "ibmplex"
  | "tajawal"
  | "vazirmatn"
  | "thmanyah";

export const UI_FONT_STACKS: Record<UiFontKey, string> = {
  readex: FONT_READING_SANS,
  alexandria: '"Alexandria", "Readex Pro", system-ui, sans-serif',
  almarai: '"Almarai", "Readex Pro", system-ui, sans-serif',
  cairo: '"Cairo", "Readex Pro", system-ui, sans-serif',
  ibmplex: '"IBM Plex Sans Arabic", "Readex Pro", system-ui, sans-serif',
  tajawal: '"Tajawal", "Readex Pro", system-ui, sans-serif',
  vazirmatn: '"Vazirmatn", "Readex Pro", system-ui, sans-serif',
  // A serif *display* face — an unusual but deliberate chrome choice; falls
  // back to Fraunces for any Latin glyphs it lacks, then Readex Pro.
  thmanyah: '"Thmanyah Serif Display", "Fraunces", "Readex Pro", Georgia, serif',
};

export const UI_FONT_LABELS: Record<UiFontKey, string> = {
  readex: "Readex Pro",
  alexandria: "Alexandria",
  almarai: "Almarai",
  cairo: "Cairo",
  ibmplex: "IBM Plex Sans Arabic",
  tajawal: "Tajawal",
  vazirmatn: "Vazirmatn",
  thmanyah: "Thmanyah",
};

export const FONT_SERIF_DISPLAY =
  '"Fraunces", "Thmanyah Serif Display", "Literata", "Readex Pro", Georgia, serif';

// Match anything in the Arabic Unicode blocks (base, supplement, extended-A,
// presentation forms A & B). Used to decide whether to render a book title
// in the editorial Fraunces stack or fall back to the UI's Readex Pro so
// digits and punctuation match the Arabic glyphs visually.
const ARABIC_RANGE =
  /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function isArabicTitle(title: string): boolean {
  return ARABIC_RANGE.test(title);
}

/** Book-title display stack. Both Latin and Arabic titles now use the
 *  editorial display serif: FONT_SERIF_DISPLAY lists Fraunces then Thmanyah
 *  Serif Display, so per-glyph fallback renders Latin in Fraunces and Arabic
 *  in Thmanyah — Arabic titles no longer fall back to the sans. `isArabicTitle`
 *  stays exported for callers that still tune fontStyle (italic vs upright). */
export function titleFontFor(_title: string): string {
  return FONT_SERIF_DISPLAY;
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
