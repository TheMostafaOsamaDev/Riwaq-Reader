import { describe, expect, it } from "vitest";
import { THUMB_BOX, thumbSize } from "./coverThumb";

// Covers are stored at whatever resolution the EPUB or the source site
// shipped — a real library holds a 1086×1448 PNG at 2.87 MB — and render at
// 110–200 CSS px. Every grid paint decodes the full image.
describe("thumbSize", () => {
  it("shrinks a real oversized cover to the box, keeping its shape", () => {
    // The 2.87 MB PNG measured in a real library.
    expect(thumbSize(1086, 1448)).toEqual({ width: 444, height: 592 });
  });

  it("never upscales a cover that is already small", () => {
    // Re-encoding a 300×400 cover up to the box would cost bytes and add
    // nothing — the source has no more detail to give.
    expect(thumbSize(300, 400)).toEqual({ width: 300, height: 400 });
  });

  it("leaves a cover sitting exactly on the box alone", () => {
    expect(thumbSize(444, 592)).toEqual({ width: 444, height: 592 });
  });

  it("fits a landscape image by its width", () => {
    // Not a normal cover, but `setCoverFromFile` takes any image the user
    // picks. Capping height alone would leave an 888px-wide thumbnail.
    expect(thumbSize(1200, 800)).toEqual({ width: 592, height: 395 });
  });

  it("fits a square image to the box", () => {
    expect(thumbSize(1000, 1000)).toEqual({
      width: THUMB_BOX,
      height: THUMB_BOX,
    });
  });

  it("refuses a degenerate image rather than emitting a zero-size canvas", () => {
    // A 0-height decode would make an OffscreenCanvas throw; callers skip
    // the thumbnail and keep the original instead.
    expect(thumbSize(0, 100)).toBeNull();
    expect(thumbSize(100, 0)).toBeNull();
    expect(thumbSize(-5, 100)).toBeNull();
    expect(thumbSize(Number.NaN, 100)).toBeNull();
  });

  it("keeps a very thin cover at least one pixel wide", () => {
    // 20×4000 rounds its width to 0 without a floor, which throws the same way.
    const t = thumbSize(20, 4000);
    expect(t).not.toBeNull();
    expect(t!.width).toBeGreaterThanOrEqual(1);
    expect(t!.height).toBe(592);
  });
});
