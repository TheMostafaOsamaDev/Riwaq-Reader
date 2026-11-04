// The sheet's motion maths, with no DOM. Every expectation below is worked
// out by hand from the geometry G: an 800px viewport, a 40px safe-area top,
// a full-height box of 760px and a default snap that shows 600px of it, so
// the three resting positions sit at translateY 0 (full), 160 (default) and
// 760 (dismissed).

import { describe, expect, it } from "vitest";
import {
  displayY,
  distribute,
  easeSamples,
  footerOffset,
  pickSnap,
  rubberBand,
  type SheetGeometry,
  scrimOpacity,
  snapY,
  springSamples,
  topSnap,
  velocityFromSamples,
} from "./physics";

const G: SheetGeometry = {
  viewportH: 800,
  insetTop: 40,
  boxH: 760,
  defaultVisibleH: 600,
  expandable: true,
};
// A content-sized menu: the box is exactly as tall as what it shows.
const F: SheetGeometry = {
  ...G,
  boxH: 300,
  defaultVisibleH: 300,
  expandable: false,
};

describe("geometry", () => {
  it("places the three snaps", () => {
    expect([
      snapY("full", G),
      snapY("default", G),
      snapY("dismissed", G),
    ]).toEqual([0, 160, 760]);
    expect([
      snapY("full", F),
      snapY("default", F),
      snapY("dismissed", F),
    ]).toEqual([0, 0, 300]);
    expect(topSnap(G)).toBe("full");
    expect(topSnap(F)).toBe("default");
  });

  it("scrim is opaque from default up and fades to 0 at dismissed", () => {
    expect(scrimOpacity(0, G)).toBe(1);
    expect(scrimOpacity(160, G)).toBe(1);
    expect(scrimOpacity(460, G)).toBeCloseTo(0.5);
    expect(scrimOpacity(760, G)).toBe(0);
  });

  it("footer stays on the screen bottom between full and default, then leaves with the sheet", () => {
    expect(footerOffset(0, G)).toBe(0);
    expect(footerOffset(80, G)).toBe(-80);
    expect(footerOffset(160, G)).toBe(-160);
    expect(footerOffset(400, G)).toBe(-160);
    expect(footerOffset(-30, G)).toBe(0);
  });
});

describe("rubber band", () => {
  it("resists and never exceeds the input", () => {
    expect(rubberBand(0, 800)).toBe(0);
    expect(Math.abs(rubberBand(-100, 800))).toBeLessThan(100);
    expect(rubberBand(-100, 800)).toBeLessThan(0);
    expect(Math.abs(rubberBand(-200, 800))).toBeGreaterThan(
      Math.abs(rubberBand(-100, 800)),
    );
  });

  it("applies above the top snap and clamps at dismissed", () => {
    expect(displayY(-100, G)).toBeGreaterThan(-100);
    expect(displayY(-100, G)).toBeLessThan(0);
    expect(displayY(900, G)).toBe(760);
    expect(displayY(50, G)).toBe(50);
    // A menu that cannot expand resists above its default snap instead.
    expect(displayY(-40, F)).toBeGreaterThan(-40);
    expect(displayY(-40, F)).toBeLessThan(0);
  });
});

describe("pickSnap", () => {
  it("picks the nearest snap on a slow release", () => {
    expect(pickSnap(60, 0, G)).toBe("full");
    expect(pickSnap(100, 0, G)).toBe("default");
    expect(pickSnap(470, 0, G)).toBe("dismissed");
    expect(pickSnap(400, 0, G)).toBe("default");
  });

  it("a flick goes at least one snap in its direction", () => {
    expect(pickSnap(150, -800, G)).toBe("full");
    expect(pickSnap(160, 800, G)).toBe("dismissed");
    expect(pickSnap(0, 800, G)).toBe("default");
    expect(pickSnap(0, 5000, G)).toBe("dismissed");
    expect(pickSnap(0, 800, F)).toBe("dismissed");
  });

  it("a slow drift below the flick speed does not skip a snap", () => {
    // 600 px/s projects 90px: nearer default (70 away) than full (90 away),
    // and no flick forcing applies below 700 px/s.
    expect(pickSnap(0, 600, G)).toBe("default");
    expect(pickSnap(160, 300, G)).toBe("default");
  });
});

describe("velocityFromSamples", () => {
  it("is the slope over the last 120 ms", () => {
    expect(
      velocityFromSamples([
        { y: 0, t: 0 },
        { y: 50, t: 100 },
      ]),
    ).toBeCloseTo(500);
    expect(velocityFromSamples([{ y: 0, t: 0 }])).toBe(0);
  });

  it("ignores samples older than the window", () => {
    // The first sample is 300ms before the last: only the last two count.
    expect(
      velocityFromSamples([
        { y: 0, t: 0 },
        { y: 100, t: 200 },
        { y: 110, t: 300 },
      ]),
    ).toBeCloseTo(100);
  });
});

describe("springSamples", () => {
  it("starts at from, ends exactly at to, and does not overshoot from rest", () => {
    const s = springSamples(160, 0, 0);
    expect(s[0]).toBe(160);
    expect(s.at(-1)).toBe(0);
    expect(Math.min(...s)).toBeGreaterThanOrEqual(-0.5);
    expect(s.length).toBeGreaterThan(10);
    expect(s.length).toBeLessThanOrEqual(120);
  });

  it("keeps the release velocity at its start", () => {
    const flung = springSamples(100, 0, -2000);
    const still = springSamples(100, 0, 0);
    expect(100 - flung[1]).toBeGreaterThan(100 - still[1]);
    // About one frame's worth of a 2000 px/s fling: ~33px.
    expect(100 - flung[1]).toBeGreaterThan(20);
  });
});

describe("easeSamples", () => {
  it("follows the curve between from and to", () => {
    const s = easeSamples(760, 160, 240, [0.32, 0.72, 0, 1]);
    expect(s[0]).toBe(760);
    expect(s.at(-1)).toBe(160);
    expect(s.length).toBe(16);
    // Decelerating: the first step is the biggest.
    expect(s[0] - s[1]).toBeGreaterThan(s[14] - s[15]);
  });
});

describe("distribute", () => {
  it("finger up moves the sheet first, then scrolls the body", () => {
    expect(
      distribute({
        delta: -200,
        sheetY: 160,
        minY: 0,
        scrollTop: 0,
        maxScroll: 1000,
        bodyLinked: true,
      }),
    ).toEqual({ sheetY: 0, scrollTop: 40, mover: "body" });
  });

  it("finger down scrolls the body to its top first, then moves the sheet", () => {
    expect(
      distribute({
        delta: 100,
        sheetY: 0,
        minY: 0,
        scrollTop: 30,
        maxScroll: 1000,
        bodyLinked: true,
      }),
    ).toEqual({ sheetY: 70, scrollTop: 0, mover: "sheet" });
  });

  it("an unlinked body never scrolls; the sheet overshoots instead", () => {
    expect(
      distribute({
        delta: -50,
        sheetY: 0,
        minY: 0,
        scrollTop: 0,
        maxScroll: 1000,
        bodyLinked: false,
      }),
    ).toEqual({ sheetY: -50, scrollTop: 0, mover: "sheet" });
  });

  it("finger down first takes back an overshoot", () => {
    expect(
      distribute({
        delta: 30,
        sheetY: -20,
        minY: 0,
        scrollTop: 1000,
        maxScroll: 1000,
        bodyLinked: true,
      }),
    ).toEqual({ sheetY: 0, scrollTop: 990, mover: "body" });
  });

  it("a body at its end lets the sheet overshoot", () => {
    expect(
      distribute({
        delta: -30,
        sheetY: 0,
        minY: 0,
        scrollTop: 1000,
        maxScroll: 1000,
        bodyLinked: true,
      }),
    ).toEqual({ sheetY: -30, scrollTop: 1000, mover: "sheet" });
  });

  it("no motion moves nothing", () => {
    expect(
      distribute({
        delta: 0,
        sheetY: 160,
        minY: 0,
        scrollTop: 5,
        maxScroll: 1000,
        bodyLinked: true,
      }),
    ).toEqual({ sheetY: 160, scrollTop: 5, mover: null });
  });
});
