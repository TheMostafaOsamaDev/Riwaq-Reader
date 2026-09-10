// How much room the reading surface keeps at each edge, and what it costs to
// change that number while someone is reading.
//
// Split out of focusChrome so the arithmetic is testable without a DOM, and
// because it is the one part of focus mode both readers need but neither owns:
// the reflow reader pads a scroller, the fixed-page reader margins a fitted
// sheet, and they were drifting apart on what "clear of the chrome" meant.

/** Room the chapter plate needs above the first line in focus mode.
 *
 *  Focus mode used to keep the out-of-focus insets — bar height plus the
 *  reading margin — which is what left a blank band at each edge once the bars
 *  had slid away. In SCROLL mode that band is at least self-correcting: it is
 *  padding, so it scrolls off and text reaches the edge by the second screen.
 *  In the paginated modes (the default is `paginated-2`) it never does: the
 *  page is fitted to the padded box, so the band is blank paper on every page
 *  for the whole book.
 *
 *  So the top band stops being padding and starts being the header — see
 *  FocusChapterPlate. 82px is the plate (26px of air, a 16px line box, a 9px
 *  gap, its 1px rule) plus 30px under the rule before the first line. It is
 *  also the height of the fade the plate sits on, so a chapter's first line
 *  begins just clear of the fade rather than half dissolved into it. */
export const FOCUS_INSET_TOP = 82;

/** Room below the last line in focus mode.
 *
 *  Equal to the bottom fade's height on purpose: the last line at rest then
 *  sits exactly at the point the fade has finished, so the end of a chapter is
 *  legible instead of dissolving. Anything smaller fades the text you are
 *  trying to finish. */
export const FOCUS_INSET_BOTTOM = 56;

/** Focus-mode inset for a surface with no plate over it.
 *
 *  The fixed-page reader. Its title is a document name, not a chapter — set
 *  over every page of a PDF it is noise, not orientation — and its page is a
 *  sheet on a gutter, so a page-coloured fade would veil the paper instead of
 *  dissolving text into it. It takes the reclaim without the header: enough
 *  margin that the sheet does not touch the window edge, and nothing else. */
export const FOCUS_INSET_BARE = 24;

/** Height of the fade under the plate. The text scrolls up into this and
 *  dissolves, which is what lets focus mode have a header with no bar in it —
 *  no fill, no hairline, nothing cutting the page in two. */
export const FOCUS_FADE_TOP = FOCUS_INSET_TOP;

/** Height of the fade above the bottom edge. */
export const FOCUS_FADE_BOTTOM = FOCUS_INSET_BOTTOM;

/** Fraction of each fade that is solid paper before the ramp begins. The
 *  plate's text sits inside the solid part, so the chapter name is never read
 *  over the body text passing beneath it. */
export const FOCUS_FADE_SOLID = 0.56;

export interface Insets {
  top: number;
  bottom: number;
}

/**
 * The insets for whichever mode the reader is in.
 *
 * @param floating True while focus mode has lifted the bars out of the layout.
 * @param pinned    The insets to keep when the bars ARE in place — bar height
 *                  plus whatever reading margin that reader wants under it.
 *                  Passed in because the two readers legitimately differ: the
 *                  reflow reader wants 60px of air below the bar and lets text
 *                  scroll under it, while a fitted page has to sit strictly
 *                  BETWEEN the bars and so wants the bar height exactly.
 */
export function readingInsets(floating: boolean, pinned: Insets): Insets {
  return floating
    ? { top: FOCUS_INSET_TOP, bottom: FOCUS_INSET_BOTTOM }
    : pinned;
}

/**
 * The scroll offset that leaves the text exactly where it was, for whatever
 * inset the surface is painting right now.
 *
 * Shrinking the top inset by 44px moves every line 44px up the screen, because
 * the inset is part of the scrollable content. A scroller can undo that for
 * nothing by scrolling 44px less far: the sentence being read stays put and the
 * window simply reaches further into the chapter. So the inset is free to
 * animate as long as the offset follows it, frame for frame — which is the one
 * thing that makes the reclaim safe to do while someone is mid-paragraph.
 *
 * Where the correction cannot be made — at the top of a chapter there is no
 * offset left to give back — the browser clamps it, and the text does rise.
 * It rises across the animation rather than in a jump, which is the best
 * available answer: the space above the first line is the space being taken.
 *
 * @param startScrollTop Offset when the change began.
 * @param startInset     Inset the surface was painting then.
 * @param insetNow       Inset it is painting this frame, mid-transition.
 */
export function heldScrollTop(
  startScrollTop: number,
  startInset: number,
  insetNow: number,
): number {
  return startScrollTop + (insetNow - startInset);
}
