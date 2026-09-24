import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MS, DOUBLE_TAP_SLOP, isDoubleTap } from "./focusGesture";

const at = (t: number, x = 100, y = 100) => ({ t, x, y });

describe("isDoubleTap", () => {
  it("is false without a previous tap", () => {
    expect(isDoubleTap(null, at(0))).toBe(false);
  });

  it("is true for a second tap soon after, in the same place", () => {
    expect(isDoubleTap(at(0), at(DOUBLE_TAP_MS - 1))).toBe(true);
  });

  it("is false once the window has passed", () => {
    // A reader tapping twice while thinking is not double-tapping.
    expect(isDoubleTap(at(0), at(DOUBLE_TAP_MS + 1))).toBe(false);
  });

  it("is false for two taps far apart, however fast", () => {
    // Two different words, not one gesture.
    expect(
      isDoubleTap(at(0, 40, 40), at(50, 40 + DOUBLE_TAP_SLOP + 1, 40)),
    ).toBe(false);
    expect(
      isDoubleTap(at(0, 40, 40), at(50, 40, 40 + DOUBLE_TAP_SLOP + 1)),
    ).toBe(false);
  });

  it("measures distance diagonally, not per axis", () => {
    // Slop on both axes at once is further than slop, and a per-axis test
    // would wave it through.
    const d = DOUBLE_TAP_SLOP;
    expect(isDoubleTap(at(0, 0, 0), at(50, d, d))).toBe(false);
  });
});
