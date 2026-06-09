// Pure helpers for the reader's within-chapter progress bar (Feature A) and
// exact sub-paragraph resume (Feature B). No DOM / React access — keeping the
// math side-effect-free makes it easy to reason about (and to unit-test later,
// if this repo ever grows a test runner).

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Fraction (0..1) of the current chapter scrolled through, in scroll mode.
 *  When the chapter fits on screen (nothing to scroll) there is no remaining
 *  distance, so it reads as fully shown (1) — consistent with a paginated
 *  single-page chapter: (0 + 1) / 1 = 1. */
export function chapterScrollFraction(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const scrollable = scrollHeight - clientHeight;
  if (scrollable <= 0) return 1;
  return clamp01(scrollTop / scrollable);
}

/** Fraction (0..1) of the way the viewport top sits INTO a paragraph.
 *  0 = the paragraph's top is at the viewport top; 1 = its bottom. Normalized
 *  to the paragraph, so it survives reflow (font size / column width changes)
 *  unlike an absolute scrollTop. */
export function paragraphScrollOffset(
  scrollTop: number,
  paragraphTop: number,
  paragraphHeight: number,
): number {
  if (paragraphHeight <= 0) return 0;
  return clamp01((scrollTop - paragraphTop) / paragraphHeight);
}

/** Inverse of paragraphScrollOffset: the scrollTop that lands the viewport at
 *  the saved offset within a paragraph. */
export function restoreScrollTop(
  paragraphTop: number,
  paragraphHeight: number,
  offset: number,
): number {
  return paragraphTop + clamp01(offset) * paragraphHeight;
}

/** Fraction (0..1) of the chapter consumed in paginated mode; last page = 1. */
export function paginatedFraction(page: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  return clamp01((page + 1) / totalPages);
}

/** Format a 0..1 fraction as a CSS width percentage string. */
export function fractionToWidth(fraction: number): string {
  return `${clamp01(fraction) * 100}%`;
}
