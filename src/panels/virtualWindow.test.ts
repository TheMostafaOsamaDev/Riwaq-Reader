import { describe, expect, it } from "vitest";
import { rowOffsets, windowRange } from "./virtualWindow";

// Ten uniform 40px rows → a 400px list.
const uniform = Array.from({ length: 10 }, () => 40);

describe("rowOffsets", () => {
  it("returns one more offset than rows, so the last entry is the total height", () => {
    const offsets = rowOffsets(uniform);
    expect(offsets).toHaveLength(11);
    expect(offsets[0]).toBe(0);
    expect(offsets[10]).toBe(400);
  });

  it("accumulates variable row heights", () => {
    // A wrapped two-line chapter title next to single-line neighbours is the
    // case fixed-height virtualisation gets wrong.
    expect(rowOffsets([40, 62, 40])).toEqual([0, 40, 102, 142]);
  });

  it("handles an empty list without producing a NaN total", () => {
    expect(rowOffsets([])).toEqual([0]);
  });
});

describe("windowRange", () => {
  const offsets = rowOffsets(uniform);

  it("returns only the rows crossing the viewport", () => {
    // 100px viewport at the top covers rows 0,1 and clips row 2.
    expect(windowRange(offsets, 0, 100, 0)).toEqual({ start: 0, end: 3 });
  });

  it("drops rows scrolled off the top", () => {
    // scrollTop 200 → first visible row is index 5.
    expect(windowRange(offsets, 200, 100, 0)).toEqual({ start: 5, end: 8 });
  });

  it("keeps overscan rows mounted on both sides", () => {
    expect(windowRange(offsets, 200, 100, 2)).toEqual({ start: 3, end: 10 });
  });

  it("never runs past the end of the list", () => {
    expect(windowRange(offsets, 380, 100, 5)).toEqual({ start: 4, end: 10 });
  });

  it("never returns a negative start", () => {
    expect(windowRange(offsets, 0, 100, 5)).toEqual({ start: 0, end: 8 });
  });

  it("mounts nothing for an empty list", () => {
    expect(windowRange(rowOffsets([]), 0, 600, 4)).toEqual({ start: 0, end: 0 });
  });

  it("mounts the first row while the container is still unmeasured", () => {
    // Height 0 is what the first render reports before layout. Returning an
    // empty window there would leave the list blank with nothing to measure,
    // and no measurement means it stays blank.
    const range = windowRange(offsets, 0, 0, 0);
    expect(range.end).toBeGreaterThan(range.start);
  });

  it("finds the window in a long list without scanning every row", () => {
    // 5000 rows is the case this exists for: a scraped novel's full spine.
    const long = rowOffsets(Array.from({ length: 5000 }, () => 42));
    // Row 2380 spans 99960–100002, so it is the first to cross scrollTop;
    // row 2395 starts at 100590, the last to begin before the fold.
    expect(windowRange(long, 100_000, 600, 0)).toEqual({
      start: 2380,
      end: 2396,
    });
  });
});
