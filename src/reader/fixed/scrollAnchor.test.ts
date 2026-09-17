// The anchor round trip: read a place out of one column, put it back into the
// same column rebuilt at another scale, and the reader is where they were.
//
// Pure arithmetic, so no DOM — the wiring that makes the viewer actually call
// this lives in scrollAnchorInViewer.test.tsx.

import { describe, expect, it } from "vitest";
import { anchorAt, scrollTopForAnchor } from "./scrollAnchor";

const PAGE_COUNT = 60;

// Two columns of the same book at different zooms. Heights scale; the gaps
// between pages do not, which is exactly why the round trip has to go through
// the page index rather than through a ratio of scrollTops.
function column(zoom: number) {
  const top: number[] = [];
  const height: number[] = [];
  let y = 20;
  for (let i = 0; i < PAGE_COUNT; i++) {
    const h = 800 * zoom;
    top.push(y);
    height.push(h);
    y += h + 18;
  }
  return { top, height };
}

describe("scrollAnchor", () => {
  it("puts the same page back under the viewport top at a new zoom", () => {
    const a = column(1);
    const b = column(1.5);
    const place = anchorAt(a.top, a.height, a.top[18] + a.height[18] * 0.4);
    expect(place).toEqual({ page: 18, offset: expect.closeTo(0.4, 5) });
    const restored = scrollTopForAnchor(b.top, b.height, place!);
    expect(anchorAt(b.top, b.height, restored)).toEqual({
      page: 18,
      offset: expect.closeTo(0.4, 5),
    });
  });

  it("keeps the gap above a page attached to that page", () => {
    const a = column(1);
    // Parked in the gutter between pages 4 and 5: the next page down is the
    // one on screen, and it is a hair below the viewport top.
    const place = anchorAt(a.top, a.height, a.top[5] - 6);
    expect(place?.page).toBe(5);
    expect(place!.offset).toBeLessThan(0);
    const b = column(2);
    expect(
      anchorAt(b.top, b.height, scrollTopForAnchor(b.top, b.height, place!))
        ?.page,
    ).toBe(5);
  });

  // The binary search has to agree with the obvious linear reading at every
  // page boundary and every gutter, not just in the middle of a page — an
  // off-by-one at the edge is exactly what a spot check would miss.
  it("agrees with a linear scan at every boundary", () => {
    const { top, height } = column(1);
    const linear = (y: number) => {
      for (let i = 0; i < top.length; i++) {
        if (top[i] + height[i] > y) return i;
      }
      return top.length - 1;
    };
    for (let i = 0; i < PAGE_COUNT; i++) {
      for (const y of [
        top[i] - 1,
        top[i],
        top[i] + 1,
        top[i] + height[i] - 1,
        top[i] + height[i],
        top[i] + height[i] + 1,
      ]) {
        expect(anchorAt(top, height, y)?.page).toBe(linear(y));
      }
    }
  });

  it("clamps past either end instead of returning nothing", () => {
    const { top, height } = column(1);
    expect(anchorAt(top, height, -5000)?.page).toBe(0);
    expect(anchorAt(top, height, 9_999_999)?.page).toBe(PAGE_COUNT - 1);
    expect(scrollTopForAnchor(top, height, { page: 999, offset: 0 })).toBe(
      top[PAGE_COUNT - 1],
    );
    expect(scrollTopForAnchor(top, height, { page: -3, offset: 0 })).toBe(
      top[0],
    );
  });

  it("has no interior to sit inside before the container is measured", () => {
    // Until the viewer knows its own size every page is 0 tall, and the
    // column is nothing but the gutters: `top[i] = PAD + i * GAP`. The offset
    // must not become Infinity or NaN and poison the restore.
    const top = [20, 38, 56];
    const height = [0, 0, 0];
    const place = anchorAt(top, height, 0);
    expect(place).toEqual({ page: 0, offset: 0 });
    expect(scrollTopForAnchor(top, height, place!)).toBe(20);
  });

  it("has nothing to say about an empty column", () => {
    expect(anchorAt([], [], 0)).toBeNull();
    expect(scrollTopForAnchor([], [], { page: 0, offset: 0.5 })).toBe(0);
  });
});
