import { describe, expect, it } from "vitest";
import { DOCK_MIN_WIDTH, DOCK_QUERY, shouldDockContents } from "./dockContents";

describe("shouldDockContents", () => {
  it("docks Contents when there is room for it", () => {
    expect(shouldDockContents("toc", true)).toBe(true);
  });

  it("overlays Contents on a window too narrow to hold both", () => {
    expect(shouldDockContents("toc", false)).toBe(false);
  });

  it("never docks the tool panels", () => {
    // Settings/progress/highlights are things you dismiss, not a place you
    // navigate from — docking them would hold reading width hostage.
    expect(shouldDockContents("settings", true)).toBe(false);
    expect(shouldDockContents("progress", true)).toBe(false);
    expect(shouldDockContents("highlights", true)).toBe(false);
  });

  it("does not dock when no panel is open", () => {
    expect(shouldDockContents(null, true)).toBe(false);
  });

  it("asks for the width it actually needs", () => {
    // The reflowable and fixed-page readers both call this. They disagreeing
    // about when Contents docks is the bug that got docking removed the last
    // time, so the threshold lives here rather than in either reader.
    expect(DOCK_QUERY).toBe(`(min-width: ${DOCK_MIN_WIDTH}px)`);
  });
});
