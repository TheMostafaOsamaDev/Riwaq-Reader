import type { ThemePref, UiFontKey } from "../styles/tokens";
import type { UiLangPref } from "../i18n";

export type ActivePanel =
  | null
  | "toc"
  | "highlights"
  | "settings"
  | "progress";

/**
 * How the chapter is laid out in the reader.
 *
 *  - `paginated-2`: two side-by-side columns that exactly fill the page.
 *    No vertical scroll; left/right arrows flip pages.
 *  - `paginated-1`: single column filling the page, paginated.
 *  - `scroll`: classic vertical scroll, the entire chapter in one column.
 *
 * Position is preserved across modes via the persisted paragraph index —
 * switching modes lands the reader on the same paragraph it was last
 * showing, mapped onto whichever layout is active.
 */
export type ReadingMode = "paginated-2" | "paginated-1" | "scroll";

export interface Tweaks {
  /** UI-language preference for the app chrome (NOT book content). "system"
      resolves from the OS/browser locale; "en"/"ar" pin a language. Drives the
      shell's reading direction. Book content direction stays derived per-book. */
  uiLang: UiLangPref;
  /** Theme preference. "system" follows the OS light/dark setting; the
      four concrete values pin a specific theme. Resolved to a concrete
      ThemeKey at render time via resolveTheme(). */
  theme: ThemePref;
  fontFamily: "serif" | "sans" | "dyslexic" | "cairo" | "lateef" | "tajawal";
  /** Reading text (ink) color. "auto" follows the active theme's ink; any CSS
      hex color overrides it across reflow text, DOCX cards, and (approximated
      via a GPU duotone) PDF pages. Kept a string so the Import Settings guard,
      which type-checks with `typeof`, accepts an imported color. */
  inkColor: string;
  /** Reading page (background) color. "auto" follows the active theme's bg;
      any CSS hex color overrides it, same coverage as `inkColor`. */
  paperColor: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  /** "auto" derives alignment from the book's language: justify in LTR
      books, right in RTL books. The explicit values let the user override. */
  textAlign: "auto" | "left" | "justify" | "right";
  readingMode: ReadingMode;
  /** Reading column width as a percentage of the available container width
      (50–100). Applies in every reading mode on both desktop and mobile,
      letting the user shrink or expand the text column to match their
      screen. */
  contentWidth: number;
  /** Mobile only — tap the right edge of the book to scroll forward a
      page-worth, the left edge to scroll back. The center third still
      toggles the reader chrome. Ignored on desktop. */
  mobileTapNav: boolean;
  /** Mobile only — width of each side tap zone as a percentage of the
      reader width (10–45). The two zones are mirrored, so the inert
      center band that toggles the chrome is `100 − 2 × width` percent.
      Only consulted when `mobileTapNav` is on. */
  mobileTapZoneWidth: number;
  /** Mobile only — how far one tap scrolls, as a percentage of the
      reader's visible height (30–100). Only consulted when
      `mobileTapNav` is on. */
  mobileTapStride: number;
  /** Selectable UI font for the app chrome. Resolved to a concrete font
      stack via UI_FONT_STACKS and applied through the `--ui-font` CSS var. */
  uiFont: UiFontKey;
  /** Extra vertical spacing between paragraphs, in em. Default 1.1
      preserves the previously hardcoded spacing. */
  paragraphSpacing: number;
  /** Enable automatic hyphenation of book text at line breaks. */
  hyphenation: boolean;
  /** Animate page turns in paginated modes. When off, pages flip instantly. */
  pageTurnAnimation: boolean;
  /** Request a wake lock while reading to keep the screen from sleeping. */
  keepScreenAwake: boolean;
  /** What the app shows on launch: the library, or resume the last book. */
  startupView: "library" | "resume";
  /** Ask for confirmation before deleting a book. */
  confirmDelete: boolean;
  /** Reduced-motion preference. "auto" follows the OS setting; "on"/"off"
      force it regardless of the OS media query. */
  reduceMotion: "auto" | "on" | "off";
  /** Maximum number of downloads to run at once (1–5). */
  maxConcurrentDownloads: number;
  /** Only download over Wi-Fi / non-metered connections. */
  wifiOnlyDownloads: boolean;
  /** Fixed-page (PDF/DOCX) default flow: continuous scroll or one page at a
      time. Reflowable books ignore it (they use `readingMode`). */
  fixedFlow: FixedFlow;
  /** Fixed-page fit: fit the page width, or the whole page, to the viewport. */
  fixedFit: FixedFit;
  /** Fixed-page tint: keep page colors, dim them (glare in dark themes), or
      invert (text-only PDFs; wrecks color art, so opt-in). */
  fixedPageTint: FixedPageTint;
}

// ── Normalized, format-agnostic reader vocabulary ───────────────────────────
// The reader shell + panels speak these instead of EpubBook, so the same
// Contents / Progress / Highlights UI serves reflowable and fixed-page books.

/** Where the reader is / can go, independent of format. Reflowable books use
 *  the chapter/paragraph anchor; fixed (PDF/DOCX) books use a page index. */
export type ReaderLocation =
  | { fmt: "reflow"; chapter: number; paragraphIndex: number; paragraphOffset?: number }
  | { fmt: "page"; page: number; pageOffset?: number };

/** One entry in a Contents / outline list. `level` is 0-based nesting depth. */
export interface TocEntry {
  title: string;
  dest: ReaderLocation;
  level: number;
}

/** Progress the shell renders in the header bar + counter + Progress panel. */
export interface ReaderProgress {
  /** 0..1. */
  fraction: number;
  /** Localized, e.g. "٧ / ٢٩٨" or "Ch. 3 · 24%". */
  label: string;
}

/** Fixed-page (PDF/DOCX) flow: continuous stacked pages, or one page at a time. */
export type FixedFlow = "scroll" | "paged";
/** Fixed-page fit: fit the page width, or the whole page, to the viewport. */
export type FixedFit = "width" | "page";
/** Fixed-page tint: keep colors, dim (dark-theme glare), or invert (text PDFs). */
export type FixedPageTint = "none" | "dim" | "invert";
