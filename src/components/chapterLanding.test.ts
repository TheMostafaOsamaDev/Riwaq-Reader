import { describe, expect, it } from "vitest";
import { landingAppliesTo } from "./readerProgress";

describe("landingAppliesTo", () => {
  it("applies to the chapter the request was made for", () => {
    // Stepped back out of chapter 8 → the request names chapter 7.
    expect(landingAppliesTo(7, 7)).toBe(true);
  });

  it("survives a chapter that is still fetching its content", () => {
    // The mount effect cannot position an empty chapter, so it leaves the
    // request pending and re-runs when the paragraphs arrive. Same chapter,
    // so the request is still good.
    expect(landingAppliesTo(7, 7)).toBe(true);
  });

  it("is NOT spent on a chapter the reader moved to instead", () => {
    // The bug: step back into chapter 7 (empty, still fetching), then turn
    // FORWARD to 8 before it arrives. A bare boolean was still set here, and
    // overrode the saved position in 8. Verified against the real
    // DesktopReader before this fix: scrollTop 2404 of 2403, chapter heading
    // 2255px above the viewport.
    expect(landingAppliesTo(7, 8)).toBe(false);
    expect(landingAppliesTo(7, 6)).toBe(false);
  });

  it("does nothing when no request is outstanding", () => {
    expect(landingAppliesTo(null, 0)).toBe(false);
    // Chapter 0 is a real chapter index, not an absent request — a
    // truthiness check here would break stepping back into the first
    // chapter.
    expect(landingAppliesTo(0, 0)).toBe(true);
  });
});
