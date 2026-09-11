// How big a chapter's opening title is set, given the size the reader has
// chosen for the body text. Pure, so the curve can be tested at the ends of
// the slider instead of eyeballed at one size in the middle of it.
//
// Everything here is stated in APPARENT size — the size the eye reads, not the
// `font-size` the title is set at. The two are not the same: the title renders
// in Markazi Text (FONT_CHAPTER_DISPLAY) while `bodySize` has already been
// corrected to read like Readex Pro, and Markazi's ink is ~76% of Readex's at
// the same px. Reasoning in px hid that: a cap that looked like a comfortable
// 30px title measured 0.95× the body it opened — an opening set SMALLER than
// its own chapter, which is the one thing this must never do.

import type { MetricScript } from "../styles/fontMetrics";

/** The reader's size slider runs 14–42 (see SettingsSection), and the opener
 *  used to set its title at a flat 1.8 × bodySize in px — 1.36× apparent — with
 *  no ceiling and no phone case. At the top of the range that is a 75px title,
 *  which on a phone column is a title that wraps three times before the chapter
 *  has started. */
interface Scale {
  /** Apparent size relative to the body, while the title can still grow freely. */
  ratio: number;
  /** Apparent size where the growth stops. Not a hard ceiling — see FLOOR. */
  cap: number;
}

/** Phone gets the gentler rate: the same title has roughly half the measure to
 *  wrap into, so the desktop's 1.36× lands as three lines of display type above
 *  a chapter that has not begun. */
const PHONE: Scale = { ratio: 1.12, cap: 30 };

/** 1.36 is exactly what shipped — 1.8 × bodySize in px, through Markazi. The
 *  desktop look is not the thing being changed here, only its ceiling. */
const DESKTOP: Scale = { ratio: 1.36, cap: 44 };

/** The floor the title may never go under, as a multiple of the body.
 *
 *  This is the hard requirement, and it outranks the cap: the opening must
 *  read as bigger than the chapter it opens at EVERY position of the slider.
 *  A flat ceiling cannot do that — a reader on 42px body text would get a 30px
 *  title, an opening set smaller than its own text. So above the cap the title
 *  keeps growing, just slowly, and never closer than 10% above the body.
 *
 *  10% and not 4%: 4% is bigger arithmetically and identical to the eye, which
 *  is not what "bigger" means when the point is that it should LOOK like a
 *  title. The cost is that the cap only bites over a short stretch of the
 *  slider on the phone (where the ramp is already near the floor) — it does
 *  its real work on the desktop's wider ramp. That trade is the right way
 *  round: a ceiling is insurance against the extreme, the floor is the rule. */
const FLOOR_RATIO = 1.1;

/**
 * Apparent-size correction for the TITLE face — what `measureFontScale` would
 * return for FONT_CHAPTER_DISPLAY.
 *
 * Tabulated rather than measured, which is the opposite of what the reading
 * fonts do, and deliberately so. fontMetrics.ts measures because two of the
 * reading stacks ("Serif", "Dyslexic") name families that are NOT self-hosted
 * and land on a different face per OS, so no constant could be right
 * everywhere. FONT_CHAPTER_DISPLAY has no such problem: it is one bundled
 * file, shipped in the app, identical on every platform — so its metric is a
 * constant of the build, and measuring it at runtime buys nothing while
 * costing the one thing that matters here. A measurement is only available
 * AFTER the face loads; before that the canvas reports the fallback's metrics
 * and scores Markazi as needing no correction at all, which would open every
 * cold-start chapter with a title 32% too small and then visibly pop it.
 *
 * Measured off public/fonts/reading/MarkaziText-VariableFont_wght.woff2 with
 * the same ink-height method fontMetrics.ts uses, against the same samples:
 * Arabic "أبجد هوز حطي" 147.3 / 111.62, Latin "Handgloves" 97.0 / 71.58.
 */
const DISPLAY_FACE_SCALE: Record<MetricScript, number> = {
  arabic: 1.32,
  latin: 1.355,
};

/**
 * Title size for a chapter opening, in APPARENT px.
 *
 * Three regimes, in order:
 *   - ramp     — `bodySize × ratio`, while that is under the cap
 *   - plateau  — the cap
 *   - floor    — `bodySize × 1.1`, once the body itself is bigger than the cap
 *
 * So the title always answers the reader's size choice, never runs away with
 * it, and is always visibly bigger than the text it introduces.
 */
export function chapterTitleApparent(
  bodySize: number,
  compact: boolean,
): number {
  const { ratio, cap } = compact ? PHONE : DESKTOP;
  return Math.min(bodySize * ratio, Math.max(cap, bodySize * FLOOR_RATIO));
}

/**
 * The `font-size` to actually set the title at: the apparent size above,
 * converted into the display face's own terms.
 *
 * @param script The script the BOOK is set in — the title is book content, so
 *   this follows the book's direction, not the UI language.
 */
export function chapterTitleSize(
  bodySize: number,
  compact: boolean,
  script: MetricScript,
): number {
  return chapterTitleApparent(bodySize, compact) * DISPLAY_FACE_SCALE[script];
}

/** The apparent title size the opener's other dimensions were drawn against:
 *  the desktop default, 17px body. Every rule, lozenge and gap in
 *  ChapterOpener is expressed as a fraction of this, so the whole block
 *  plateaus WITH the title rather than growing past it — which is what the old
 *  body-derived unit did, leaving 64px rules around a title that had stopped.
 *
 *  Deliberately the APPARENT size and not the px one, so a block set in Arabic
 *  and one set in Latin close on the same rules. */
export const DESIGN_TITLE_APPARENT = chapterTitleApparent(17, false);
