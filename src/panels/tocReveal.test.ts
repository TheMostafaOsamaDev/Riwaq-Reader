import { describe, expect, it } from "vitest";
import { centerScrollTop } from "./tocReveal";

// A 600px-tall scroller holding a 3000px list, currently at the top.
const scroller = { scrollTop: 0, clientHeight: 600, scrollHeight: 3000 };

describe("centerScrollTop", () => {
  it("centres a row that sits below the viewport", () => {
    // Row is 1000px down the content, 40px tall → centre puts its top at
    // (600 - 40) / 2 = 280px inside the scrollport, so scrollTop = 720.
    expect(
      centerScrollTop({ ...scroller, rowOffsetTop: 1000, rowHeight: 40 }),
    ).toBe(720);
  });

  it("centres a row that sits above the viewport", () => {
    expect(
      centerScrollTop({
        scrollTop: 2000,
        clientHeight: 600,
        scrollHeight: 3000,
        rowOffsetTop: 800,
        rowHeight: 40,
      }),
    ).toBe(520);
  });

  it("clamps at the top rather than asking for a negative scrollTop", () => {
    // A negative target is what makes the browser look for scroll range in an
    // ancestor — the bug this helper exists to avoid.
    expect(
      centerScrollTop({ ...scroller, rowOffsetTop: 10, rowHeight: 40 }),
    ).toBe(0);
  });

  it("clamps at the bottom of the scroll range", () => {
    expect(
      centerScrollTop({ ...scroller, rowOffsetTop: 2900, rowHeight: 40 }),
    ).toBe(2400); // scrollHeight - clientHeight
  });

  it("returns 0 when there is nothing to scroll", () => {
    expect(
      centerScrollTop({
        scrollTop: 0,
        clientHeight: 600,
        scrollHeight: 600,
        rowOffsetTop: 100,
        rowHeight: 40,
      }),
    ).toBe(0);
  });

  it("rounds to whole pixels", () => {
    expect(
      centerScrollTop({ ...scroller, rowOffsetTop: 1000, rowHeight: 41 }),
    ).toBe(721); // 1000 - 279.5
  });
});
