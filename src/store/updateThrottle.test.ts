import { describe, expect, it } from "vitest";
import { CHECK_INTERVAL_MS, shouldCheck } from "./updateThrottle";

const DAY = CHECK_INTERVAL_MS;

describe("shouldCheck", () => {
  it("checks on a first launch that has never checked", () => {
    expect(
      shouldCheck({
        enabled: true,
        lastCheck: undefined,
        now: 1_000,
        manual: false,
      }),
    ).toBe(true);
  });

  it("does not check again within the interval", () => {
    expect(
      shouldCheck({
        enabled: true,
        lastCheck: 1_000,
        now: 1_000 + DAY - 1,
        manual: false,
      }),
    ).toBe(false);
  });

  it("checks once the interval has elapsed", () => {
    expect(
      shouldCheck({
        enabled: true,
        lastCheck: 1_000,
        now: 1_000 + DAY,
        manual: false,
      }),
    ).toBe(true);
  });

  it("never checks automatically when the setting is off", () => {
    expect(
      shouldCheck({
        enabled: false,
        lastCheck: undefined,
        now: 1_000,
        manual: false,
      }),
    ).toBe(false);
  });

  it("honours an explicit Check now even when the setting is off", () => {
    // The toggle governs BACKGROUND checks. Pressing the button is consent.
    expect(
      shouldCheck({
        enabled: false,
        lastCheck: 1_000,
        now: 1_001,
        manual: true,
      }),
    ).toBe(true);
  });

  it("honours an explicit Check now inside the throttle window", () => {
    expect(
      shouldCheck({
        enabled: true,
        lastCheck: 1_000,
        now: 1_001,
        manual: true,
      }),
    ).toBe(true);
  });

  it("checks when the stored timestamp is in the future", () => {
    // A clock change or a hand-edited settings file must not wedge the check
    // forever. A future timestamp reads as "never checked".
    expect(
      shouldCheck({
        enabled: true,
        lastCheck: 9_000_000,
        now: 1_000,
        manual: false,
      }),
    ).toBe(true);
  });
});
