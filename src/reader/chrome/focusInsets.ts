// How much room the reading surface keeps at each edge, and what it costs to
// change that number while someone is reading.
//
// Split out of focusChrome so the arithmetic is testable without a DOM, and
// because it is the one part of focus mode both readers need but neither owns:
// the reflow reader pads a scroller, the fixed-page reader margins a fitted
// sheet, and they were drifting apart on what "clear of the chrome" meant.

/** Room the reading surface keeps at each edge in focus mode.
 *
 *  Focus mode used to keep the out-of-focus insets — bar height plus the
 *  reading margin — which is what left a blank band at each edge once the bars
 *  had slid away. In SCROLL mode that band is at least self-correcting: it is
 *  padding, so it scrolls off and text reaches the edge by the second screen.
 *  In the paginated modes (the default is `paginated-2`) it never does: the
 *  page is fitted to the padded box, so the band is blank paper on every page
 *  for the whole book.
 *
 *  So focus mode reclaims it, and keeps nothing at either edge but this
 *  margin: no running head, no fade. Both readers share it — the reflow
 *  reader pads its text by it, the fixed-page reader margins its sheet by it,
 *  so the page never touches the window edge in either.
 *
 *  It used to be more on the reflow side: an 82px header band carrying the
 *  chapter name over a page-to-transparent fade, and a 56px fade at the foot.
 *  Both went: in focus mode nothing is meant to be on screen but the book. */
export const FOCUS_INSET = 24;

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
  return floating ? { top: FOCUS_INSET, bottom: FOCUS_INSET } : pinned;
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
