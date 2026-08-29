import { describe, expect, it } from "vitest";
import { mergeRects } from "./pdfHighlight";

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("mergeRects", () => {
  it("drops empty rects", () => {
    expect(mergeRects([R(0.1, 0.1, 0, 0.02), R(0.1, 0.1, 0.2, 0)])).toEqual([]);
  });

  it("merges the many spans pdf.js emits for one line into one band", () => {
    // A line arriving as four adjacent runs, as a real text layer produces.
    const merged = mergeRects([
      R(0.1, 0.2, 0.1, 0.02),
      R(0.2, 0.2, 0.08, 0.02),
      R(0.28, 0.2, 0.12, 0.02),
      R(0.4, 0.2, 0.05, 0.02),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].x).toBeCloseTo(0.1);
    expect(merged[0].w).toBeCloseTo(0.35);
    expect(merged[0].y).toBeCloseTo(0.2);
    expect(merged[0].h).toBeCloseTo(0.02);
  });

  it("keeps separate lines separate", () => {
    const merged = mergeRects([R(0.1, 0.2, 0.3, 0.02), R(0.1, 0.26, 0.2, 0.02)]);
    expect(merged).toHaveLength(2);
  });

  it("does not bridge a column gutter on the same line", () => {
    // Two columns: a wide gap between them must survive as two bands, or the
    // highlight paints a bar straight across the gutter.
    const merged = mergeRects([R(0.05, 0.3, 0.35, 0.02), R(0.55, 0.3, 0.35, 0.02)]);
    expect(merged).toHaveLength(2);
    expect(merged[0].w).toBeCloseTo(0.35);
    expect(merged[1].x).toBeCloseTo(0.55);
  });

  it("bridges the small gap between adjacent runs", () => {
    const merged = mergeRects([R(0.1, 0.3, 0.2, 0.02), R(0.305, 0.3, 0.2, 0.02)]);
    expect(merged).toHaveLength(1);
  });

  it("unions overlapping runs instead of appending them", () => {
    const merged = mergeRects([R(0.1, 0.3, 0.2, 0.02), R(0.25, 0.3, 0.2, 0.02)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].x).toBeCloseTo(0.1);
    expect(merged[0].w).toBeCloseTo(0.35);
  });

  it("treats a superscript on the same line as that line", () => {
    // A smaller box whose centre still sits within the line — must not split.
    const merged = mergeRects([R(0.1, 0.3, 0.2, 0.02), R(0.3, 0.297, 0.02, 0.012)]);
    expect(merged).toHaveLength(1);
  });

  it("orders bands down the page", () => {
    const merged = mergeRects([R(0.1, 0.5, 0.2, 0.02), R(0.1, 0.2, 0.2, 0.02)]);
    expect(merged.map((r) => r.y)).toEqual([0.2, 0.5]);
  });
});
