// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { canScrollY } from "./scrollable";

/** A box with a given overflow and scroll range (happy-dom has no layout). */
function box(overflowY: string, range: number): HTMLDivElement {
  const el = document.createElement("div");
  el.style.overflowY = overflowY;
  Object.defineProperty(el, "clientHeight", { value: 300 });
  Object.defineProperty(el, "scrollHeight", { value: 300 + range });
  document.body.append(el);
  return el;
}

describe("canScrollY", () => {
  it("needs a scrolling overflow and range beyond the slack", () => {
    expect(canScrollY(box("auto", 400))).toBe(true);
    expect(canScrollY(box("scroll", 400))).toBe(true);
    expect(canScrollY(box("hidden", 400))).toBe(false);
    expect(canScrollY(box("visible", 400))).toBe(false);
    expect(canScrollY(box("auto", 1))).toBe(false);
  });

  it("takes a wider slack where rounding is noisier", () => {
    expect(canScrollY(box("auto", 2))).toBe(true);
    expect(canScrollY(box("auto", 2), 2)).toBe(false);
  });
});
