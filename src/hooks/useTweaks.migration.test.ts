// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { loadTweaks } from "./useTweaks";

describe("loadTweaks", () => {
  beforeEach(() => localStorage.clear());

  it("drops the retired autoCheckUpdates flag instead of honouring it", () => {
    // The toggle is gone: the daily check is always on. A copy that once
    // switched it off must not carry `false` forward into a build that no
    // longer has anywhere to switch it back on.
    localStorage.setItem(
      "riwaq:tweaks:v1",
      JSON.stringify({ autoCheckUpdates: false, fontSize: 19 }),
    );
    const t = loadTweaks() as unknown as Record<string, unknown>;
    expect("autoCheckUpdates" in t).toBe(false);
    expect(t.fontSize).toBe(19); // the control: the rest still loads
  });
});
