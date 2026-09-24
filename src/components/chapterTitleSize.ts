// How big a chapter's opening title is set, given the size the reader has
// chosen for the body text. Pure, so the curve can be tested at the ends of
// the slider instead of eyeballed at one size in the middle of it.
//
// Everything here is stated in APPARENT size — the size the eye reads, not the
// `font-size` it is set at. The two are not the same: the same px renders ~28%
// smaller in Lateef than in Readex Pro, which is why the reader's own faces
// each carry a measured correction (see styles/fontMetrics.ts). Reasoning in
// px hid that: a cap that looked like a comfortable 30px title measured 0.95×
// the body it opened — an opening set SMALLER than its own chapter, which is
// the one thing this must never do.
//
// The title is set in the READER'S chosen face, not a fixed display one, so
// its correction is that face's own — the very same number the body is already
// scaled by. That is what makes the ratio between the two hold still while the
// face changes: both sides are multiplied by it, so it cancels.

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
 * converted into the chosen face's own terms.
 *
 * @param bodyApparent The body's APPARENT size — the reader's slider value,
 *   NOT the corrected px the body is set at. Passing the corrected px is the
 *   bug this signature exists to make hard: it multiplies the title by the
 *   face's correction a second time, so a reader on Lateef got a title 1.89×
 *   their body where every other face gave 1.36×.
 * @param faceScale The chosen face's correction, from `measureFontScale` —
 *   the same number the body is scaled by. Because both sides carry it, the
 *   title/body ratio is identical on all sixteen faces.
 */
export function chapterTitleSize(
  bodyApparent: number,
  compact: boolean,
  faceScale: number,
): number {
  return chapterTitleApparent(bodyApparent, compact) * faceScale;
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
