import { describe, expect, it } from "vitest";
import {
  placePopover,
  type AnchorBox,
  type PlacementInput,
} from "./popoverPlacement";

/** A one-line anchor: first and last line are the same box. */
function line(r: {
  top: number;
  bottom: number;
  left: number;
  right: number;
  dir?: "rtl" | "ltr";
}): AnchorBox {
  const edges = { left: r.left, right: r.right };
  return {
    top: r.top,
    bottom: r.bottom,
    firstLine: edges,
    lastLine: edges,
    dir: r.dir ?? "ltr",
  };
}

/** A 200x44 toolbar in a 1000x700 window whose reading region is inset
 *  40px top (chrome bar) and 60px bottom (progress bar). */
function input(over: Partial<PlacementInput> = {}): PlacementInput {
  return {
    anchor: line({ top: 300, bottom: 320, left: 400, right: 600 }),
    size: { width: 200, height: 44 },
    bounds: { top: 40, bottom: 640, left: 0, right: 1000 },
    placement: "auto",
    margin: 8,
    ...over,
  };
}

describe("placePopover", () => {
  it("sits above the selection when there is room", () => {
    const p = placePopover(input());
    // 300 (anchor top) - 44 (height) - 8 (margin)
    expect(p.top).toBe(248);
    expect(p.visible).toBe(true);
  });

  it("aligns to the start edge of the selection, not its centre", () => {
    const p = placePopover(input());
    // LTR: the selection starts at its left edge, 400, and the toolbar
    // hangs rightward from there.
    expect(p.left).toBe(400);
  });

  it("flips below when the selection is near the top of the reading region", () => {
    const p = placePopover(
      input({ anchor: line({ top: 50, bottom: 70, left: 400, right: 600 }) }),
    );
    expect(p.top).toBe(78); // anchor.bottom + margin
  });

  it("honours a forced 'below' placement even with room above", () => {
    // The phone reader forces below so we never cover Android's own
    // floating toolbar, which sits above the selected text.
    const p = placePopover(input({ placement: "below" }));
    expect(p.top).toBe(328);
  });

  it("goes back above when below would collide with the bottom chrome", () => {
    const p = placePopover(
      input({ anchor: line({ top: 600, bottom: 620, left: 400, right: 600 }) }),
    );
    expect(p.top).toBe(548);
  });

  it("clamps to the left edge instead of hanging off it", () => {
    const p = placePopover(
      input({ anchor: line({ top: 300, bottom: 320, left: 0, right: 40 }) }),
    );
    expect(p.left).toBe(8);
  });

  it("clamps to the right edge instead of hanging off it", () => {
    const p = placePopover(
      input({
        anchor: line({ top: 300, bottom: 320, left: 960, right: 1000 }),
      }),
    );
    // 1000 - 200 - 8
    expect(p.left).toBe(792);
  });

  // ── The scroll bug: the menu must not linger over unrelated text ──
  // once the selection it belongs to has scrolled out of the reading
  // region. `visible: false` is the caller's cue to fade it out.

  it("hides once the selection has scrolled off the top", () => {
    const p = placePopover(
      input({ anchor: line({ top: -80, bottom: -60, left: 400, right: 600 }) }),
    );
    expect(p.visible).toBe(false);
  });

  it("hides once the selection has scrolled off the bottom", () => {
    const p = placePopover(
      input({ anchor: line({ top: 700, bottom: 720, left: 400, right: 600 }) }),
    );
    expect(p.visible).toBe(false);
  });

  it("hides a selection hidden behind the chrome bars, not just off-window", () => {
    // Sitting under the top bar is as invisible to the reader as being
    // off-window — the bar is opaque frosted glass.
    const p = placePopover(
      input({ anchor: line({ top: 4, bottom: 24, left: 400, right: 600 }) }),
    );
    expect(p.visible).toBe(false);
  });

  it("stays visible while the selection is only partly in view", () => {
    // Half a line showing is still a line the reader can see themselves
    // highlighting; yanking the menu away there would feel broken.
    const p = placePopover(
      input({ anchor: line({ top: 30, bottom: 55, left: 400, right: 600 }) }),
    );
    expect(p.visible).toBe(true);
  });

  it("tracks the selection as it scrolls, keeping the same gap", () => {
    const a = placePopover(
      input({ anchor: line({ top: 300, bottom: 320, left: 400, right: 600 }) }),
    );
    const b = placePopover(
      input({ anchor: line({ top: 225, bottom: 245, left: 400, right: 600 }) }),
    );
    expect(a.top - b.top).toBe(75);
  });

  // ── Stability. "It moves suddenly to somewhere else" is a bug in its
  // own right: a toolbar that flips sides mid-scroll is harder to use
  // than one that stays put and slides off. Once a side is chosen it is
  // held, and the toolbar clamps inside the reading region instead.

  it("reports which side it chose", () => {
    expect(placePopover(input()).side).toBe("above");
    expect(
      placePopover(
        input({ anchor: line({ top: 50, bottom: 70, left: 400, right: 600 }) }),
      ).side,
    ).toBe("below");
  });

  it("keeps the side it is already on when room above runs out", () => {
    // Scrolling up-page shrinks the room above. Without the lock this
    // is the frame where the toolbar would jump below the selection.
    const p = placePopover(
      input({
        anchor: line({ top: 44, bottom: 64, left: 400, right: 600 }),
        lockedSide: "above",
      }),
    );
    expect(p.side).toBe("above");
    expect(p.top).toBe(40); // clamped to bounds.top, not flipped to 72
  });

  it("keeps a locked 'below' rather than flipping up near the bottom", () => {
    const p = placePopover(
      input({
        anchor: line({ top: 600, bottom: 620, left: 400, right: 600 }),
        lockedSide: "below",
      }),
    );
    expect(p.side).toBe("below");
    expect(p.top).toBe(596); // clamped to bounds.bottom - height
  });

  it("never places itself outside the reading region", () => {
    for (const top of [-200, -20, 0, 40, 300, 620, 700, 900]) {
      const p = placePopover(
        input({
          anchor: line({ top, bottom: top + 20, left: 400, right: 600 }),
          lockedSide: "above",
        }),
      );
      expect(p.top).toBeGreaterThanOrEqual(40);
      expect(p.top + 44).toBeLessThanOrEqual(640);
    }
  });

  it("returns whole pixels, so nothing shimmers as it tracks", () => {
    const p = placePopover(
      input({
        anchor: line({
          top: 300.4,
          bottom: 320.7,
          left: 400.3,
          right: 599.8,
        }),
      }),
    );
    expect(Number.isInteger(p.top)).toBe(true);
    expect(Number.isInteger(p.left)).toBe(true);
  });
});

/**
 * The multi-line case, from real measurements.
 *
 * Taken in a browser: a 1728px viewport, a 920px justified RTL column,
 * a three-line selection. The first two lines fill the column
 * (768..1688) and the last is short and sits at the right, where an RTL
 * paragraph ends (1639..1688). The union of all three is the whole
 * column — which is why centring on it put the toolbar at 1094, the
 * dead middle of the paragraph, pointing at nothing.
 */
describe("placePopover: multi-line selections", () => {
  const TOOLBAR = { width: 268, height: 96 };
  const VIEWPORT = { top: 66, bottom: 900, left: 0, right: 1728 };

  const arabicParagraph = (): AnchorBox => ({
    top: 300,
    bottom: 408,
    firstLine: { left: 768, right: 1688 },
    lastLine: { left: 1639, right: 1688 },
    dir: "rtl",
  });

  const base = (over: Partial<PlacementInput> = {}): PlacementInput => ({
    anchor: arabicParagraph(),
    size: TOOLBAR,
    bounds: VIEWPORT,
    placement: "auto",
    margin: 8,
    ...over,
  });

  it("anchors to where an RTL selection starts, not the middle of the block", () => {
    const p = placePopover(base());
    // Right edge of the first line, minus the toolbar's width.
    expect(p.left).toBe(1688 - 268);
    // The bug: centred on the union (768..1688) this was 1094.
    expect(p.left).not.toBe(1094);
  });

  it("mirrors for LTR", () => {
    const p = placePopover(
      base({
        anchor: {
          ...arabicParagraph(),
          dir: "ltr",
          firstLine: { left: 200, right: 1120 },
        },
      }),
    );
    expect(p.left).toBe(200);
  });

  it("uses the LAST line when it sits below the selection", () => {
    const p = placePopover(base({ lockedSide: "below" }));
    // The short closing line, 1639..1688 — the toolbar hugs the line it
    // is actually next to rather than one three rows away.
    expect(p.left).toBe(1688 - 268);
    expect(p.side).toBe("below");
  });

  it("does not move as the selection grows", () => {
    // Dragging two more lines changes the union, and used to slide a
    // centred toolbar out from under the reader's hand. The start edge
    // is the one point that does not move.
    const one = placePopover(
      base({
        anchor: {
          top: 300,
          bottom: 336,
          firstLine: { left: 768, right: 1688 },
          lastLine: { left: 768, right: 1688 },
          dir: "rtl",
        },
      }),
    );
    const three = placePopover(base());
    expect(three.left).toBe(one.left);
  });

  it("keeps a selection at the far edge fully on screen", () => {
    // An RTL line ending hard against the right edge would hang the
    // toolbar off it.
    const p = placePopover(
      base({
        anchor: {
          ...arabicParagraph(),
          firstLine: { left: 1700, right: 1728 },
        },
      }),
    );
    expect(p.left + TOOLBAR.width).toBeLessThanOrEqual(VIEWPORT.right - 8);
    expect(p.left).toBeGreaterThanOrEqual(VIEWPORT.left + 8);
  });

  it("keeps an LTR selection at the left edge fully on screen", () => {
    const p = placePopover(
      base({
        anchor: {
          ...arabicParagraph(),
          dir: "ltr",
          firstLine: { left: -40, right: 300 },
        },
      }),
    );
    expect(p.left).toBeGreaterThanOrEqual(VIEWPORT.left + 8);
  });

  it("survives a viewport narrower than the toolbar", () => {
    const p = placePopover(
      base({ bounds: { top: 66, bottom: 900, left: 0, right: 200 } }),
    );
    // The low bound wins, so the toolbar stays reachable rather than
    // being pushed off the left edge.
    expect(p.left).toBe(8);
  });
});
