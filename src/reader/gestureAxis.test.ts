import { describe, expect, it } from "vitest";
import { TOUCH_SLOP, gestureAxis } from "./gestureAxis";

describe("gestureAxis", () => {
  it("is undecided inside the slop", () => {
    expect(gestureAxis(0, 0)).toBeNull();
    expect(gestureAxis(5, -5)).toBeNull(); // 7.07px
    expect(gestureAxis(-TOUCH_SLOP, 0)).toBeNull();
  });

  it("names the axis that moved more once past it", () => {
    expect(gestureAxis(9, 3)).toBe("x");
    expect(gestureAxis(-9, 3)).toBe("x");
    expect(gestureAxis(3, -9)).toBe("y");
  });

  // Chromium's own rule for pan-y: horizontal only when |dx| > |dy|. Agreeing
  // with it means a 45-degree drag is handled the same way whether the browser
  // or this code is looking at it.
  it("gives an exact diagonal to the vertical axis", () => {
    expect(gestureAxis(7, 7)).toBe("y");
  });
});
