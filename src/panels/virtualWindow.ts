// Windowing math for long Contents lists.
//
// Chapter rows are NOT a fixed height — a long title wraps, and the row grows
// with it. So this works off a per-row height array rather than a single row
// height: the panel measures the rows it has mounted and estimates the rest,
// and these two functions turn that into "which rows belong on screen".
//
// Kept pure and separate from the panel so the arithmetic is testable without
// a DOM, and so the binary search below can be verified against a 5000-row
// spine — the case the whole thing exists for.

/** Running top edge of every row, plus a final entry holding the total height.
 *  `offsets[i]` is row i's top; `offsets[heights.length]` is the list height. */
export function rowOffsets(heights: number[]): number[] {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) {
    offsets[i + 1] = offsets[i] + heights[i];
  }
  return offsets;
}

/** Index of the last row whose top edge is <= `y`, by binary search over the
 *  offsets. Linear scanning here is what makes a naive virtualiser O(n) per
 *  scroll frame, which defeats the point on the lists that need windowing. */
function rowAt(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2; // last real row index
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Half-open range of rows to mount for a scrollport showing
 *  `[scrollTop, scrollTop + viewportHeight)`, widened by `overscan` rows on
 *  each side so a scroll doesn't reveal blank space before React catches up. */
export function windowRange(
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): { start: number; end: number } {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };

  const first = rowAt(offsets, scrollTop);
  const last = rowAt(offsets, scrollTop + viewportHeight);

  const start = Math.max(0, first - overscan);
  // `last` is inclusive, so +1 for the half-open end. Mount at least one row:
  // on the first render the container reports height 0, and an empty window
  // would leave nothing to measure — and without a measurement the list has
  // no way to grow past that first frame.
  const end = Math.min(count, Math.max(last + 1, first + 1) + overscan);
  return { start, end };
}
