// @vitest-environment happy-dom
// A highlight made in one reading mode has to be visible in the other. Each
// mode stores a different anchor and renders only from its own, so a
// highlight made in flowing text was invisible in pages and vice versa — and
// tapping it in the panel did nothing, because the jump reads the anchor the
// other mode never wrote.
import { describe, expect, it } from "vitest";
import type { Highlight } from "../store/library";
import { bridgeDocxHighlights } from "./highlightBridge";

// chapter 0: blocks 0,1,1,2   chapter 1: blocks 4,6
const MAP = [
  [0, 1, 1, 2],
  [4, 6],
];

const base = {
  id: "h1",
  text: "some text",
  color: "yellow" as Highlight["color"],
  ts: 1,
};

/** Made in flowing text: reflow fields set, no fixed anchor. */
const flowMade: Highlight = {
  ...base,
  chapter: 1,
  paragraphIndex: 1,
  charStart: 3,
  charEnd: 9,
};

/** Made in pages: fixed anchor set, reflow fields left at 0. */
const pagesMade: Highlight = {
  ...base,
  chapter: 0,
  paragraphIndex: 0,
  charStart: 0,
  charEnd: 0,
  fixed: { fmt: "docx", blockId: "b6", charStart: 3, charEnd: 9 },
};

describe("bridgeDocxHighlights", () => {
  it("gives a flow-made highlight a fixed anchor so pages can show it", () => {
    const [h] = bridgeDocxHighlights([flowMade], MAP);
    expect(h.fixed).toEqual({
      fmt: "docx",
      blockId: "b6",
      charStart: 3,
      charEnd: 9,
    });
  });

  it("gives a pages-made highlight reflow fields so flow can show it", () => {
    const [h] = bridgeDocxHighlights([pagesMade], MAP);
    expect(h.chapter).toBe(1);
    expect(h.paragraphIndex).toBe(1);
    expect(h.charStart).toBe(3);
    expect(h.charEnd).toBe(9);
  });

  it("round-trips: bridging twice changes nothing", () => {
    const once = bridgeDocxHighlights([flowMade], MAP);
    const twice = bridgeDocxHighlights(once, MAP);
    expect(twice).toEqual(once);
  });

  it("leaves a highlight that already has both anchors alone", () => {
    const both: Highlight = {
      ...flowMade,
      fixed: { fmt: "docx", blockId: "b6", charStart: 3, charEnd: 9 },
    };
    expect(bridgeDocxHighlights([both], MAP)[0]).toEqual(both);
  });

  // A PDF highlight must never be touched: its anchor is a page + rects and
  // means nothing in this coordinate system.
  it("ignores a PDF anchor", () => {
    const pdf: Highlight = {
      ...base,
      chapter: 0,
      paragraphIndex: 0,
      charStart: 0,
      charEnd: 0,
      fixed: { fmt: "pdf", page: 2, rects: [] },
    };
    expect(bridgeDocxHighlights([pdf], MAP)[0]).toEqual(pdf);
  });

  it("survives an empty map without inventing anchors", () => {
    const [h] = bridgeDocxHighlights([flowMade], []);
    expect(h).toEqual(flowMade);
  });

  it("keeps the note and colour it was given", () => {
    const noted: Highlight = { ...flowMade, note: "why this matters" };
    const [h] = bridgeDocxHighlights([noted], MAP);
    expect(h.note).toBe("why this matters");
    expect(h.color).toBe("yellow");
  });
});
