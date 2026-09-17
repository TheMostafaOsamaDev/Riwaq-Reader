// Where a reader is in a column of fixed-layout pages, expressed so it
// survives the column being rebuilt at a different scale.
//
// `scrollTop` on its own does not survive it. Zooming rescales every page's
// height, so the same absolute offset lands a proportionally different
// distance into the book — deep in a PDF, one zoom step moves the reader
// several pages. Naming the page and how far into it the viewport sits keeps
// the meaning instead of the number, the same way the reflow readers keep a
// paragraph index and a fraction rather than a scrollTop (see
// `paragraphScrollOffset` in components/readerProgress.ts).
//
// A FRACTION is the right form for a deliberate rescale, and only for that.
// Zoom, fit and a resize all change the anchor page's own height on purpose,
// and the reader wants the same *content* under them afterwards: 40% into
// page 18 stays 40% into page 18. A pixel distance would not — after a 1.25x
// zoom the same 400px is a shallower part of a taller page.
//
// The opposite case is a page being MEASURED, where an estimated height is
// replaced by the real one. Nothing about the content changed, so the pixels
// under the reader's eyes must not move, and there a fraction is actively
// wrong: it is a share of a height that is itself being corrected, so
// re-deriving from it moves the reader by the size of the correction. Earlier
// work on this reader measured that at 1240px the moment the page under the
// viewport was measured. Holding still across a measurement needs a px delta
// from the page's top edge instead, because a page's own height never feeds
// its own offset — only the pages before it do.
//
// This module deliberately covers the first case only; the viewer excludes
// measurement-driven changes from what it re-anchors on.

/** The topmost page still on screen, plus how far the viewport top sits into
 *  it as a fraction of its height. */
export interface PageAnchor {
  page: number;
  /** 0 = the page's top edge is at the viewport top, 1 = its bottom edge.
   *
   *  Deliberately NOT clamped to 0..1. Parked in the gutter between two pages
   *  the value is slightly negative, and it has to stay that way for the round
   *  trip to be exact — clamping to 0 would snap the page up to the viewport
   *  top, which is a visible jolt for a reader who only asked to zoom. */
  offset: number;
}

/** Read the anchor out of a column. `top[i]` / `height[i]` are the page
 *  geometry the viewer laid out; `scrollTop` is where the reader is.
 *
 *  Returns null only for an empty column. */
export function anchorAt(
  top: readonly number[],
  height: readonly number[],
  scrollTop: number,
): PageAnchor | null {
  const n = top.length;
  if (n === 0) return null;

  // The first page whose bottom edge is still below the viewport top — the
  // gap above a page counts as part of it, so scrolling through a gutter
  // never leaves the anchor pointing at the page that has just left.
  //
  // Binary search, not a scan: this runs on every scroll frame, and a page's
  // bottom edge is strictly increasing down the column (the next page starts a
  // fixed GAP below it), so the predicate flips exactly once. A linear version
  // cost one step per page above the reader — most of a thousand-page PDF, on
  // the viewer's hottest path.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (top[mid] + height[mid] > scrollTop) hi = mid;
    else lo = mid + 1;
  }

  // A page with no height yet — the container has not been measured — has no
  // interior for the viewport to be part-way into.
  const h = height[lo];
  return { page: lo, offset: h > 0 ? (scrollTop - top[lo]) / h : 0 };
}

/** Inverse of `anchorAt`: the scrollTop that puts `anchor` back where it was
 *  in a column that has since been rebuilt at another scale. */
export function scrollTopForAnchor(
  top: readonly number[],
  height: readonly number[],
  anchor: PageAnchor,
): number {
  if (top.length === 0) return 0;
  const i = Math.max(0, Math.min(top.length - 1, anchor.page));
  return Math.max(0, top[i] + anchor.offset * height[i]);
}
