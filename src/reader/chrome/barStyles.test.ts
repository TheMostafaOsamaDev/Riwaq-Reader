// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  HOME_BAR_STYLES,
  homeBarHasImport,
  isHomeBarStyle,
  isReaderBarStyle,
  minutesLeft,
  panelsInContents,
  panelsOnBar,
  READER_BAR_STYLES,
  wordCount,
} from "./barStyles";
import {
  acceptsTweak,
  DEFAULT_TWEAKS,
  loadTweaks,
} from "../../hooks/useTweaks";

describe("bar style names", () => {
  it("defaults to today's bars, so an update changes nothing until chosen", () => {
    expect(DEFAULT_TWEAKS.readerBar).toBe("classic");
    expect(DEFAULT_TWEAKS.homeBar).toBe("classic");
  });

  it("accepts only styles that exist", () => {
    for (const s of READER_BAR_STYLES) expect(isReaderBarStyle(s)).toBe(true);
    for (const s of HOME_BAR_STYLES) expect(isHomeBarStyle(s)).toBe(true);
    expect(isReaderBarStyle("dock")).toBe(false);
    expect(isHomeBarStyle("capsule")).toBe(false);
    expect(acceptsTweak("readerBar", "corners")).toBe(true);
    expect(acceptsTweak("readerBar", "nope")).toBe(false);
    expect(acceptsTweak("homeBar", "switch")).toBe(true);
    expect(acceptsTweak("homeBar", 3)).toBe(false);
  });

  it("puts a stored style that no longer exists back to the default", () => {
    localStorage.setItem(
      "riwaq:tweaks:v1",
      JSON.stringify({ readerBar: "retired", homeBar: "dock" }),
    );
    const t = loadTweaks();
    expect(t.readerBar).toBe("classic");
    expect(t.homeBar).toBe("dock");
    localStorage.removeItem("riwaq:tweaks:v1");
  });
});

describe("panels", () => {
  // The rule that lets a bar be light: whatever it leaves off is a tab in the
  // Contents sheet. Every panel has to be reachable from every style.
  it.each(READER_BAR_STYLES)("%s leaves no panel unreachable", (style) => {
    const reachable = new Set([
      ...panelsOnBar(style),
      ...(panelsOnBar(style).includes("toc") ? panelsInContents(style) : []),
    ]);
    for (const p of ["toc", "highlights", "progress", "settings"] as const) {
      expect(reachable.has(p), `${style}: ${p}`).toBe(true);
    }
  });

  it("adds tabs to the sheet only for the styles that need them", () => {
    expect(panelsInContents("classic")).toEqual([]);
    expect(panelsInContents("status")).toEqual([]);
    expect(panelsInContents("capsule")).toEqual([
      "toc",
      "highlights",
      "progress",
    ]);
  });

  it("keeps an import button somewhere for every home bar", () => {
    // The ones without one on the bar put it in the header (MobileLibrary);
    // this pins which is which so the header and the bar never both drop it.
    expect(HOME_BAR_STYLES.filter(homeBarHasImport)).toEqual([
      "classic",
      "dock",
      "raised",
    ]);
  });
});

describe("time left in a chapter", () => {
  it("counts words the way a reader would", () => {
    expect(wordCount(["اتسمت نبرة فانغ يوان", "  two  words "])).toBe(6);
    expect(wordCount([])).toBe(0);
  });

  it("is about right, and never says 0 with text still to read", () => {
    expect(minutesLeft(2000, 0)).toBe(10);
    expect(minutesLeft(2000, 0.5)).toBe(5);
    expect(minutesLeft(2000, 0.99)).toBe(1);
    expect(minutesLeft(2000, 1)).toBe(0);
    expect(minutesLeft(0, 0)).toBe(0);
    expect(minutesLeft(2000, 7)).toBe(0); // clamped
  });
});
