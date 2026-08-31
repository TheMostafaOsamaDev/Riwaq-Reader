import { describe, expect, it } from "vitest";
import { buildOffsets, findIndexForOffset } from "./VirtualList";

describe("buildOffsets", () => {
  it("produces a prefix sum with a leading zero and a total", () => {
    expect(buildOffsets([10, 20, 30])).toEqual([0, 10, 30, 60]);
  });

  it("handles an empty list", () => {
    expect(buildOffsets([])).toEqual([0]);
  });
});

describe("findIndexForOffset", () => {
  const offsets = buildOffsets([10, 20, 30, 40]); // [0, 10, 30, 60, 100]

  it("finds the row containing an offset", () => {
    expect(findIndexForOffset(offsets, 0)).toBe(0);
    expect(findIndexForOffset(offsets, 9)).toBe(0);
    expect(findIndexForOffset(offsets, 10)).toBe(1);
    expect(findIndexForOffset(offsets, 29)).toBe(1);
    expect(findIndexForOffset(offsets, 30)).toBe(2);
    expect(findIndexForOffset(offsets, 59)).toBe(2);
    expect(findIndexForOffset(offsets, 60)).toBe(3);
  });

  it("clamps past the end instead of running off the array", () => {
    expect(findIndexForOffset(offsets, 100)).toBe(4);
    expect(findIndexForOffset(offsets, 99999)).toBe(4);
  });

  it("clamps before the start", () => {
    expect(findIndexForOffset(offsets, -50)).toBe(0);
  });

  it("agrees with a linear scan over a large mixed-height list", () => {
    // 94% one-line rows, 6% wrapped — the real shape of a chapter list.
    const heights = Array.from({ length: 1000 }, (_, i) =>
      i % 17 === 0 ? 53 : 35.5,
    );
    const table = buildOffsets(heights);
    const linear = (offset: number) => {
      let i = 0;
      while (i < heights.length && table[i + 1] <= offset) i++;
      return i;
    };
    for (const probe of [0, 1, 35.4, 35.5, 500, 1234.5, 20000, table[1000] - 1]) {
      expect(findIndexForOffset(table, probe)).toBe(linear(probe));
    }
  });
});
