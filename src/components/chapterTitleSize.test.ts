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
    // What shipped was `bodySize × 1.8` in px set in Markazi — 1.8 / 1.32 =
    // 1.3636× APPARENT, carried here as a round 1.36. The px it lands on now
    // depends on the reader's face, as it must; what has to be preserved is
    // the apparent ramp, which is what the eye actually reads.
    for (let body = MIN_BODY; body <= MAX_BODY; body++) {
      if (chapterTitleApparent(body, false) >= 44) break; // past the cap they diverge
      expect(chapterTitleApparent(body, false)).toBeCloseTo(body * 1.36, 10);
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
    // title that filled the phone column. It comes down by ~18% and stays a
    // title. Stated on a face needing no correction (scale 1), so these are
    // the apparent numbers too.
    expect(chapterTitleSize(24, false, 1)).toBeCloseTo(32.64, 2);
    expect(chapterTitleSize(24, true, 1)).toBeCloseTo(26.88, 2);
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
    const wasUnbounded = MAX_BODY * 1.36; // 57.1 apparent
    for (const compact of [true, false]) {
      expect(chapterTitleApparent(MAX_BODY, compact)).toBeLessThan(
        wasUnbounded * 0.85,
      );
    }
    // And the desktop plateau is real: a stretch of the slider where the title
    // holds still while the body keeps growing. (On the phone the ramp starts
    // close to the floor, so the cap barely bites — see FLOOR_RATIO.)
    expect(chapterTitleApparent(33, false)).toBeCloseTo(44, 5);
    expect(chapterTitleApparent(39, false)).toBeCloseTo(44, 5);
  });
});

// The title is set in whatever face the reader chose, so its px has to carry
// that face's own apparent-size correction — the same one the body carries.
// What must NOT move when the face moves is the ratio between them.
describe("sizing the title for whichever face the reader chose", () => {
  // The span measureFontScale can return: it clamps to FONT_SCALE_MIN/MAX.
  // 1.39 is Lateef's Arabic, the worst real case.
  const SCALES = [0.8, 1, 1.12, 1.39, 1.55, 1.75];

  it("keeps the title the same multiple of the body on every face", () => {
    for (const compact of [true, false]) {
      for (let body = MIN_BODY; body <= MAX_BODY; body++) {
        const ratios = SCALES.map(
          (scale) => chapterTitleSize(body, compact, scale) / (body * scale),
        );
        for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 10);
      }
    }
  });

  it("applies a face's correction ONCE, not twice", () => {
    // The bug this replaced. BookBody passed the already-corrected px where
    // an apparent size was wanted, so the correction landed twice: on Lateef
    // (1.39 on Arabic) a desktop title came out 1.39 × 1.36 = 1.89× the body
    // it opened, while the same slider position on Readex gave 1.36×. The
    // title silently changed size when the FONT changed, which is the one
    // thing the apparent-size model exists to prevent.
    const LATEEF_ARABIC = 1.39;
    const body = 17;
    const titlePx = chapterTitleSize(body, false, LATEEF_ARABIC);
    const bodyPx = body * LATEEF_ARABIC;
    expect(titlePx / bodyPx).toBeCloseTo(1.36, 10);
    // Explicitly NOT the doubled value.
    expect(titlePx / bodyPx).not.toBeCloseTo(1.36 * LATEEF_ARABIC, 2);
  });
});
