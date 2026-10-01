import { describe, expect, it } from "vitest";
import { FOCUS_INSET, heldScrollTop, readingInsets } from "./focusInsets";

// What the reflow reader keeps when its bars are pinned: bar height plus the
// reading margin under it.
const PINNED = { top: 126, bottom: 95 };

describe("readingInsets", () => {
  it("keeps the bar-height insets while the bars are in place", () => {
    expect(readingInsets(false, PINNED)).toEqual(PINNED);
  });

  it("drops to the bare focus margin once the bars are gone", () => {
    expect(readingInsets(true, PINNED)).toEqual({
      top: FOCUS_INSET,
      bottom: FOCUS_INSET,
    });
  });

  it("actually reclaims space at both edges", () => {
    // The bug this exists for: focus mode kept the pinned insets, so hiding
    // the bars left a blank band at each edge — permanently blank in the
    // paginated modes, where the page is fitted to the padded box.
    const focus = readingInsets(true, PINNED);
    expect(focus.top).toBeLessThan(PINNED.top);
    expect(focus.bottom).toBeLessThan(PINNED.bottom);
  });

  it("keeps a margin rather than reclaiming everything", () => {
    // Nothing is drawn in it any more, but the text still must not touch the
    // window edge. A regression that zeroed it would set the first line flush
    // against the top of the window.
    const focus = readingInsets(true, PINNED);
    expect(focus.top).toBeGreaterThan(0);
    expect(focus.bottom).toBeGreaterThan(0);
  });
});

describe("heldScrollTop", () => {
  it("does not move the offset before the inset has moved", () => {
    // Frame zero of the transition: the surface is still painting the old
    // inset, so the offset it needs is the one it already has. This is the
    // case that has to be exact — anything else is a visible jump on the
    // frame the toggle lands.
    expect(heldScrollTop(500, PINNED.top, PINNED.top)).toBe(500);
  });

  it("gives back exactly what the inset took, at the end", () => {
    // 126 → 24 is 102px of content gone from above the text, so the offset
    // has to be 102px shallower for the same words to be under the same
    // pixels.
    expect(heldScrollTop(500, PINNED.top, FOCUS_INSET)).toBe(398);
  });

  it("tracks the inset part-way through the transition", () => {
    expect(heldScrollTop(500, 126, 104)).toBe(478);
  });

  it("pushes the offset back down when the inset grows again", () => {
    // Leaving focus mode: the band returns above the text, so the reader has
    // to be 102px deeper into the chapter to be looking at the same line.
    expect(heldScrollTop(398, FOCUS_INSET, PINNED.top)).toBe(500);
  });

  it("asks for a negative offset at the top of a chapter", () => {
    // Nothing left to give back. The browser clamps this to 0 and the first
    // line genuinely rises — across the transition, not in a jump. The
    // function must not pre-clamp, or the caller could not tell the
    // difference between "held" and "clamped".
    expect(heldScrollTop(0, PINNED.top, FOCUS_INSET)).toBe(-102);
    expect(heldScrollTop(10, PINNED.top, FOCUS_INSET)).toBe(-92);
  });

  it("round-trips a toggle back to where it started", () => {
    const there = heldScrollTop(1400, PINNED.top, FOCUS_INSET);
    expect(heldScrollTop(there, FOCUS_INSET, PINNED.top)).toBe(1400);
  });
});
