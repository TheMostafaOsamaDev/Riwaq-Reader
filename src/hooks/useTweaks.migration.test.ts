// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { appVersion } from "virtual:whats-new";
import { DEFAULT_TEXT_COLORS } from "../styles/tokens";
import {
  acceptsTweak,
  DEFAULT_TWEAKS,
  loadTweaks,
  mergeTweaks,
} from "./useTweaks";

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
  it("opens a book in scroll mode on a fresh install", () => {
    // A reader meeting the app for the first time gets the continuous scroll,
    // not the two-column spread. Anyone who already chose a mode keeps it —
    // the stored value wins over the default (the control below).
    expect(loadTweaks().readingMode).toBe("scroll");
    localStorage.setItem(
      "riwaq:tweaks:v1",
      JSON.stringify({ readingMode: "paginated-2" }),
    );
    expect(loadTweaks().readingMode).toBe("paginated-2");
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

describe("textColor", () => {
  beforeEach(() => localStorage.clear());
  const store = (o: object) =>
    localStorage.setItem("riwaq:tweaks:v1", JSON.stringify(o));

  it("starts every theme on its own ink", () => {
    expect(DEFAULT_TWEAKS.textColor).toEqual(DEFAULT_TEXT_COLORS);
    expect(loadTweaks().textColor).toEqual(DEFAULT_TEXT_COLORS);
  });

  it("an install from before text color loads the defaults and keeps the rest", () => {
    store({ fontSize: 19 });
    const t = loadTweaks();
    expect(t.textColor).toEqual(DEFAULT_TEXT_COLORS);
    expect(t.fontSize).toBe(19);
  });

  it("loads settings saved by the old Text/Page color picker", () => {
    // The free pickers (removed in cf2c59e) stored raw hex under these keys.
    // They are not text-colour picks and must not be read as one.
    store({ inkColor: "#ff0000", paperColor: "#000000", fontSize: 19 });
    const t = loadTweaks();
    expect(t.textColor).toEqual(DEFAULT_TEXT_COLORS);
    expect(t.fontSize).toBe(19);
  });

  it("keeps valid saved picks and repairs the rest", () => {
    store({
      textColor: { light: "navy", dark: "bogus", extra: "x" },
      fontSize: 19,
    });
    expect(loadTweaks().textColor).toEqual({
      ...DEFAULT_TEXT_COLORS,
      light: "navy",
    });
  });

  it("a saved null or array becomes the defaults", () => {
    store({ textColor: null });
    expect(loadTweaks().textColor).toEqual(DEFAULT_TEXT_COLORS);
    store({ textColor: [] });
    expect(loadTweaks().textColor).toEqual(DEFAULT_TEXT_COLORS);
  });

  it("import takes a plain object only", () => {
    expect(acceptsTweak("textColor", { light: "navy" })).toBe(true);
    expect(acceptsTweak("textColor", null)).toBe(false);
    expect(acceptsTweak("textColor", [])).toBe(false);
  });

  it("an exported textColor imports unchanged", () => {
    const picks = {
      light: "navy",
      sepia: "olive",
      dark: "amber",
      oled: "coral",
    };
    expect(mergeTweaks(DEFAULT_TWEAKS, { textColor: picks }).textColor).toEqual(
      picks,
    );
  });

  it("an imported textColor is repaired, not trusted", () => {
    const next = mergeTweaks(DEFAULT_TWEAKS, {
      textColor: { light: "moon", dark: "amber" },
      fontSize: 20,
    });
    expect(next.textColor).toEqual({ ...DEFAULT_TEXT_COLORS, dark: "amber" });
    expect(next.fontSize).toBe(20);
  });

  it("reset puts every theme back on its own ink", () => {
    const picked = {
      ...DEFAULT_TWEAKS,
      textColor: {
        light: "navy",
        sepia: "olive",
        dark: "amber",
        oled: "coral",
      } as const,
    };
    expect(
      mergeTweaks(picked, DEFAULT_TWEAKS as unknown as Record<string, unknown>)
        .textColor,
    ).toEqual(DEFAULT_TEXT_COLORS);
  });
});

describe("default book font", () => {
  it("a fresh install reads in Markazi Text; a saved font is kept", () => {
    localStorage.clear();
    expect(DEFAULT_TWEAKS.fontFamily).toBe("markazi");
    expect(loadTweaks().fontFamily).toBe("markazi");
    // Anyone who has opened the app before has their font saved (the whole
    // settings object is written on first launch), so they keep it.
    localStorage.setItem(
      "riwaq:tweaks:v1",
      JSON.stringify({ fontFamily: "readex" }),
    );
    expect(loadTweaks().fontFamily).toBe("readex");
    localStorage.setItem(
      "riwaq:tweaks:v1",
      JSON.stringify({ fontFamily: "no-such-font" }),
    );
    expect(loadTweaks().fontFamily).toBe("markazi");
    localStorage.clear();
  });
});
