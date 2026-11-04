// How far through a reflowable book the reader is — one formula for every
// place that shows it.
//
// There used to be three. The reader's bar said `chapter / (count - 1)`, the
// progress panel and the library card said `(chapter + 1) / count`, and none
// of them looked inside the chapter. Opening chapter 1 of 3 read 0% in the
// reader and 33% in the library; the last chapter read 100% the moment it
// opened. Now every one of them is `(chapter + fraction read) / count`, and
// the bar's landmarks and seeks are laid out on the same scale.
//
// Pure. The fraction of a chapter read comes from the readers, measured on
// the page (`textReadFraction`).

import { clamp01 } from "../components/readerProgress";

/** 0..1 through the book: the chapters behind the reader plus the fraction
 *  of this one they have read. */
export function bookProgress(
  chapter: number,
  chapterFraction: number,
  chapterCount: number,
): number {
  if (chapterCount <= 0) return 0;
  return clamp01((chapter + clamp01(chapterFraction)) / chapterCount);
}

/** Whole percent for display, floored so 100 means the very end. The
 *  epsilon absorbs float noise like 0.29 × 100 = 28.999…. Every readout of
 *  book progress — the reader's bar, the library card — uses this, so they
 *  never disagree by a rounding. */
export function wholePercent(fraction: number): number {
  return Math.floor(clamp01(fraction) * 100 + 1e-9);
}

/** The chapter whose span on the bar holds `fraction` — what a seek there
 *  opens. Chapter i spans [i/count, (i+1)/count). */
export function chapterAtBookFraction(
  fraction: number,
  chapterCount: number,
): number {
  if (chapterCount <= 0) return 0;
  // The epsilon keeps a chapter's exact start from rounding down into the
  // chapter before it.
  const i = Math.floor(clamp01(fraction) * chapterCount + 1e-9);
  return Math.min(chapterCount - 1, i);
}

/** Landmarks where each chapter after the first begins, or none once there
 *  are more than `max` of them to draw. */
export function chapterStartTicks(chapterCount: number, max: number): number[] {
  if (chapterCount < 2 || chapterCount - 1 > max) return [];
  return Array.from(
    { length: chapterCount - 1 },
    (_, i) => (i + 1) / chapterCount,
  );
}

/**
 * 0..1 of a chapter's text read: 0 at the top, 1 once its last line is on
 * screen. `textBottom` is where the text ends in the scroller's content
 * coordinates, or null while the chapter has none (a streamed chapter mounts
 * empty).
 *
 * Measured to the end of the TEXT rather than the scroller: below the last
 * paragraph sit the end-of-chapter card and the padding, and counting them
 * left a short chapter reading ~65% with its last line already on screen.
 */
export function textReadFraction(
  scrollTop: number,
  clientHeight: number,
  textBottom: number | null,
): number {
  if (textBottom === null) return 0;
  const lastLineInView = textBottom - clientHeight;
  if (lastLineInView <= 0) return 1;
  return clamp01(scrollTop / lastLineInView);
}
