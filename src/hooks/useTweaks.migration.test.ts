// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { appVersion } from "virtual:whats-new";
import { acceptsTweak, DEFAULT_TWEAKS, loadTweaks } from "./useTweaks";

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

  it("a fresh install starts with this version already seen — no tour", () => {
    // Nothing stored = a brand-new user, who has nothing to compare against.
    expect(loadTweaks().lastSeenWhatsNew).toBe(appVersion);
  });
  it("an updater keeps undefined so the tour shows once", () => {
    localStorage.setItem("riwaq:tweaks:v1", JSON.stringify({ fontSize: 19 }));
    expect(loadTweaks().lastSeenWhatsNew).toBeUndefined();
  });
});

describe("updateOverMobile", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to asking first", () => {
    expect(DEFAULT_TWEAKS.updateOverMobile).toBe("ask");
    expect(loadTweaks().updateOverMobile).toBe("ask");
  });
  it("loads a known value and drops an unknown one", () => {
    localStorage.setItem(
      "riwaq:tweaks:v1",
      JSON.stringify({ updateOverMobile: "wifi" }),
    );
    expect(loadTweaks().updateOverMobile).toBe("wifi");
    localStorage.setItem(
      "riwaq:tweaks:v1",
      JSON.stringify({ updateOverMobile: "sometimes", fontSize: 19 }),
    );
    const t = loadTweaks();
    expect(t.updateOverMobile).toBe("ask");
    expect(t.fontSize).toBe(19);
  });
  it("Import Settings accepts only ask | always | wifi", () => {
    for (const v of ["ask", "always", "wifi"]) {
      expect(acceptsTweak("updateOverMobile", v)).toBe(true);
    }
    expect(acceptsTweak("updateOverMobile", "sometimes")).toBe(false);
    expect(acceptsTweak("updateOverMobile", 1)).toBe(false);
    // The controls: the existing guards still hold.
    expect(acceptsTweak("heroStyle", "nope")).toBe(false);
    expect(acceptsTweak("fontSize", 19)).toBe(true);
    expect(acceptsTweak("fontSize", Number.NaN)).toBe(false);
  });
});
