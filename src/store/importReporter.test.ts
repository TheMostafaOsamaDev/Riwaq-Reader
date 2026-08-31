import { describe, expect, it } from "vitest";
import { fileFraction } from "./importReporter";

describe("fileFraction", () => {
  it("starts at zero and ends at one", () => {
    expect(fileFraction("copy", 0)).toBe(0);
    expect(fileFraction("write", 1)).toBeCloseTo(1);
  });

  it("never goes backwards across phases", () => {
    const samples = [
      fileFraction("copy", 0),
      fileFraction("copy", 0.5),
      fileFraction("copy", 1),
      fileFraction("parse", 0),
      fileFraction("parse", 1),
      fileFraction("write", 0),
      fileFraction("write", 0.5),
      fileFraction("write", 1),
    ];
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it("gives the byte copy the largest share", () => {
    // The copy is what actually takes seconds on a large book, so a bar that
    // raced past it would sit frozen for the rest of the run.
    const copyShare = fileFraction("copy", 1);
    const parseShare = fileFraction("parse", 1) - fileFraction("parse", 0);
    expect(copyShare).toBeGreaterThan(parseShare);
    expect(copyShare).toBeGreaterThan(0.4);
  });

  it("clamps out-of-range ratios", () => {
    expect(fileFraction("copy", -5)).toBe(0);
    expect(fileFraction("write", 99)).toBeCloseTo(1);
  });
});
