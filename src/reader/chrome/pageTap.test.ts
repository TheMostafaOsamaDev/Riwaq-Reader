import { describe, expect, it } from "vitest";
import { isPageTap, LONG_PRESS_MOVE_TOLERANCE, LONG_PRESS_MS } from "./pageTap";

const down = { t: 1000, x: 200, y: 400 };

describe("isPageTap", () => {
  it("accepts a quick press that stayed put", () => {
    expect(isPageTap(down, { t: 1080, x: 201, y: 399 })).toBe(true);
  });

  it("rejects a press with nothing to compare it to", () => {
    // A click with no pointerdown behind it — synthesised by the browser, or
    // arriving after the press was handed to someone else.
    expect(isPageTap(null, { t: 1080, x: 200, y: 400 })).toBe(false);
  });

  it("rejects a press at exactly the long-press threshold", () => {
    // This is the hold-to-highlight gesture: at this instant the selection
    // timer has already fired. It used to land as a tap too, so reaching for
    // a highlight also took the chrome away.
    expect(isPageTap(down, { t: 1000 + LONG_PRESS_MS, x: 200, y: 400 })).toBe(
      false,
    );
  });

  it("accepts a press one millisecond short of it", () => {
    expect(
      isPageTap(down, { t: 1000 + LONG_PRESS_MS - 1, x: 200, y: 400 }),
    ).toBe(true);
  });

  it("rejects a press that travelled — that gesture was a scroll", () => {
    expect(
      isPageTap(down, {
        t: 1080,
        x: 200,
        y: 400 + LONG_PRESS_MOVE_TOLERANCE + 1,
      }),
    ).toBe(false);
  });

  it("accepts a press at exactly the movement tolerance", () => {
    // The same boundary the selection code cancels on (`> tolerance`), so a
    // gesture is never both a scroll and a tap.
    expect(
      isPageTap(down, { t: 1080, x: 200, y: 400 + LONG_PRESS_MOVE_TOLERANCE }),
    ).toBe(true);
  });

  it("measures the distance as a diagonal, not per axis", () => {
    // Tolerance on both axes at once is 1.41x tolerance away. A per-axis test
    // would wave that through as "close enough".
    const diagonal = {
      t: 1080,
      x: 200 + LONG_PRESS_MOVE_TOLERANCE,
      y: 400 + LONG_PRESS_MOVE_TOLERANCE,
    };
    expect(isPageTap(down, diagonal)).toBe(false);
  });
});
