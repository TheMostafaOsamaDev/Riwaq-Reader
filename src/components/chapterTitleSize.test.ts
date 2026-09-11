import { describe, expect, it } from "vitest";
import {
  chapterTitleApparent,
  chapterTitleSize,
  DESIGN_TITLE_APPARENT,
} from "./chapterTitleSize";

// The slider's real ends — see SettingsSection's fontSize Field.
const MIN_BODY = 14;
const MAX_BODY = 42;
const DEFAULT_BODY = 17;

describe("chapterTitleApparent", () => {
  it("keeps the desktop look where it was", () => {
    // What shipped was `bodySize × 1.8` in px, set in Markazi — which is
    // 1.8 / 1.32 = 1.3636× apparent, carried here as a round 1.36. Changing
    // the desktop look is not the job, so it has to land back on the old
    // pixel value; the rounding costs a tenth of a pixel at every size, which
    // is the tolerance below.
    for (let body = MIN_BODY; body <= MAX_BODY; body++) {
      const shipped = body * 1.8;
      // Desktop is on the ramp up to body 32.4 — past the cap the two
      // deliberately diverge, which is the whole point of the change.
      if (chapterTitleApparent(body, false) >= 44) break;
      expect(
        Math.abs(chapterTitleSize(body, false, "arabic") - shipped),
      ).toBeLessThan(0.2);
    }
    expect(DESIGN_TITLE_APPARENT).toBeCloseTo(DEFAULT_BODY * 1.36, 5);
  });

  it("is smaller on a phone at the same body size", () => {
    for (let body = MIN_BODY; body <= MAX_BODY; body++) {
      expect(chapterTitleApparent(body, true)).toBeLessThanOrEqual(
        chapterTitleApparent(body, false),
      );
    }
    // The case from the bug report: a reader who had pushed the size up got a
    // 43px title on a phone column. It comes down by ~18%, and stays a title.
    expect(chapterTitleSize(24, false, "arabic")).toBeCloseTo(43.1, 1);
    expect(chapterTitleSize(24, true, "arabic")).toBeCloseTo(35.5, 1);
  });

  it("grows with the reader's size choice", () => {
    for (const compact of [true, false]) {
      for (let body = MIN_BODY; body < MAX_BODY; body++) {
        expect(chapterTitleApparent(body + 1, compact)).toBeGreaterThanOrEqual(
          chapterTitleApparent(body, compact),
        );
      }
    }
  });

  it("is always VISIBLY bigger than the body it opens, at every slider position", () => {
    // The hard requirement, and the one the cap must never break — the first
    // version of this curve capped in px and quietly shipped a title measuring
    // 0.95× the body, i.e. an opening smaller than its own chapter.
    //
    // Asserted at 1.1 and not at "> body": a title 4% bigger passes a naive
    // greater-than and still reads as body text.
    for (const compact of [true, false]) {
      for (let body = MIN_BODY; body <= MAX_BODY; body++) {
        expect(
          chapterTitleApparent(body, compact) / body,
        ).toBeGreaterThanOrEqual(1.1);
      }
    }
  });

  it("reins in the top of the slider rather than running away with it", () => {
    // At MAX_BODY the binding constraint is the FLOOR, not the cap — the body
    // is 42px, so nothing may set the title under 46.2 apparent. What the
    // change buys at this end is therefore a fifth off, not a flat ceiling;
    // the ceiling's work happens in the middle of the slider.
    const wasUnbounded = MAX_BODY * 1.8; // 75.6px
    for (const compact of [true, false]) {
      expect(chapterTitleSize(MAX_BODY, compact, "arabic")).toBeLessThan(
        wasUnbounded * 0.85,
      );
    }
    // And the desktop plateau is real: a stretch of the slider where the title
    // holds still while the body keeps growing. (On the phone the ramp starts
    // close to the floor, so the cap barely bites — see FLOOR_RATIO.)
    expect(chapterTitleApparent(33, false)).toBeCloseTo(44, 5);
    expect(chapterTitleApparent(39, false)).toBeCloseTo(44, 5);
  });

  it("pins the display face's measured correction", () => {
    // Measured off the bundled Markazi woff2 with fontMetrics' own method. If
    // the bundled file is ever swapped, these move and the desktop default
    // stops matching what shipped — which is exactly what should fail here.
    expect(
      chapterTitleSize(17, false, "arabic") / chapterTitleApparent(17, false),
    ).toBeCloseTo(1.32, 5);
    expect(
      chapterTitleSize(17, false, "latin") / chapterTitleApparent(17, false),
    ).toBeCloseTo(1.355, 5);
  });

  it("sets Latin a touch larger, because Markazi's Latin is a touch smaller", () => {
    for (let body = MIN_BODY; body <= MAX_BODY; body++) {
      expect(chapterTitleSize(body, true, "latin")).toBeGreaterThan(
        chapterTitleSize(body, true, "arabic"),
      );
    }
  });
});
