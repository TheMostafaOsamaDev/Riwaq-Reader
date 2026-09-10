import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cubicBezier,
  EASE,
  EASE_POINTS,
  isReducedMotion,
  setReduceMotionOverride,
  subscribeReducedMotion,
} from "./motion";

afterEach(() => setReduceMotionOverride("auto"));

describe("isReducedMotion", () => {
  // The non-React accessor exists so modules outside the component tree (the
  // overlay scrollbar controller) honour the in-app Reduce motion setting
  // rather than only the OS query. Without it, turning Reduce motion on left
  // that surface still animating.
  it("follows the app-level override in both directions", () => {
    setReduceMotionOverride("on");
    expect(isReducedMotion()).toBe(true);
    setReduceMotionOverride("off");
    expect(isReducedMotion()).toBe(false);
  });

  it("defers to the OS query when the override is auto", () => {
    // No `window` in this environment, so the OS half reads as no-preference.
    setReduceMotionOverride("auto");
    expect(isReducedMotion()).toBe(false);
  });
});

describe("subscribeReducedMotion", () => {
  it("fires on override changes and stops after unsubscribe", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeReducedMotion(seen);

    setReduceMotionOverride("on");
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
    setReduceMotionOverride("off");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the preference is set to what it already was", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeReducedMotion(seen);
    setReduceMotionOverride("auto");
    expect(seen).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe("EASE_POINTS", () => {
  // The JS control points and the CSS strings are written out separately, so
  // this is what stops one being tuned without the other. Without it the
  // reader's inset animation would drift out of step with the chrome's on the
  // next motion tweak, in a way nothing else would catch.
  it.each(["enter", "exit"] as const)("matches the CSS curve for %s", (key) => {
    const nums = EASE[key]
      .replace(/^cubic-bezier\(|\)$/g, "")
      .split(",")
      .map((n) => Number(n.trim()));
    expect(nums).toEqual([...EASE_POINTS[key]]);
  });
});

describe("cubicBezier", () => {
  const enter = cubicBezier(...EASE_POINTS.enter);

  it("pins both ends", () => {
    expect(enter(0)).toBe(0);
    expect(enter(1)).toBe(1);
  });

  it("clamps outside the unit interval", () => {
    expect(enter(-0.5)).toBe(0);
    expect(enter(1.5)).toBe(1);
  });

  it("is the identity for a linear curve", () => {
    const linear = cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3);
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(linear(t)).toBeCloseTo(t, 5);
    }
  });

  it("front-loads EASE.enter, which is what makes it read as a settle", () => {
    // Most of the distance is covered early and the tail creeps in. If this
    // ever inverts, the reader's insets would appear to hesitate then snap.
    expect(enter(0.25)).toBeGreaterThan(0.4);
    expect(enter(0.5)).toBeGreaterThan(0.8);
    expect(enter(0.9)).toBeGreaterThan(0.98);
  });

  it("rises monotonically", () => {
    // A non-monotonic solve would show up as the text stepping backwards
    // mid-animation — the exact artefact this whole path exists to avoid.
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const v = enter(i / 100);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it("solves a curve whose tail is flat enough to break Newton's method", () => {
    // EASE.enter's second control point is (0, 1): the derivative goes to
    // zero, which is why the bisection fallback is there. If the fallback
    // were wrong this would come back NaN or wildly off.
    for (const t of [0.95, 0.99, 0.999]) {
      expect(Number.isFinite(enter(t))).toBe(true);
      expect(enter(t)).toBeGreaterThan(0.99);
      expect(enter(t)).toBeLessThanOrEqual(1);
    }
  });
});
