import { describe, it, expect } from "vitest";
import { normalizeRect, denormalizeRect } from "./highlightAnchors";

describe("rect normalization", () => {
  it("normalizes page-px rects to 0..1 fractions", () => {
    expect(normalizeRect({ x: 50, y: 100, w: 200, h: 20 }, 500, 1000)).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.4,
      h: 0.02,
    });
  });

  it("round-trips through denormalize at a different scale", () => {
    const n = normalizeRect({ x: 50, y: 100, w: 200, h: 20 }, 500, 1000);
    expect(denormalizeRect(n, 1000, 2000)).toEqual({ x: 100, y: 200, w: 400, h: 40 });
  });
});
