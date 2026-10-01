// @vitest-environment happy-dom
// Switching reading mode must land on the same paragraph, both directions.
// Both modes index block-level content in document order, but not
// one-for-one, so every conversion is a blockMap lookup — never arithmetic.
import { describe, expect, it } from "vitest";
import { docxHtmlToFlowDoc } from "./flowDoc";
import { blockForFlowPosition, flowPositionForBlock } from "./flowPosition";

// chapter 0: blocks 0,1,1,2   chapter 1: blocks 4,6
const MAP = [
  [0, 1, 1, 2],
  [4, 6],
];

describe("flowPositionForBlock", () => {
  it("finds the chapter and item a block produced", () => {
    expect(flowPositionForBlock(MAP, 0)).toEqual({
      chapter: 0,
      paragraphIndex: 0,
    });
    expect(flowPositionForBlock(MAP, 2)).toEqual({
      chapter: 0,
      paragraphIndex: 3,
    });
    expect(flowPositionForBlock(MAP, 4)).toEqual({
      chapter: 1,
      paragraphIndex: 0,
    });
    expect(flowPositionForBlock(MAP, 6)).toEqual({
      chapter: 1,
      paragraphIndex: 1,
    });
  });

  it("takes the FIRST item when one block produced several", () => {
    // Block 1 produced items 1 and 2; landing on the first is what puts the
    // reader at the top of the list they were looking at.
    expect(flowPositionForBlock(MAP, 1)).toEqual({
      chapter: 0,
      paragraphIndex: 1,
    });
  });

  // Reading a blank spacer paragraph in pages mode, then switching.
  it("falls back to the nearest preceding item for a block with no item", () => {
    expect(flowPositionForBlock(MAP, 3)).toEqual({
      chapter: 0,
      paragraphIndex: 3,
    });
    expect(flowPositionForBlock(MAP, 5)).toEqual({
      chapter: 1,
      paragraphIndex: 0,
    });
  });

  it("clamps past the end rather than throwing", () => {
    expect(flowPositionForBlock(MAP, 999)).toEqual({
      chapter: 1,
      paragraphIndex: 1,
    });
  });

  it("clamps before the start rather than throwing", () => {
    expect(flowPositionForBlock(MAP, -1)).toEqual({
      chapter: 0,
      paragraphIndex: 0,
    });
  });

  it("returns the origin for an empty map", () => {
    expect(flowPositionForBlock([], 5)).toEqual({
      chapter: 0,
      paragraphIndex: 0,
    });
    expect(flowPositionForBlock([[]], 5)).toEqual({
      chapter: 0,
      paragraphIndex: 0,
    });
  });
});

describe("blockForFlowPosition", () => {
  it("returns the block an item came from", () => {
    expect(blockForFlowPosition(MAP, { chapter: 0, paragraphIndex: 0 })).toBe(
      0,
    );
    expect(blockForFlowPosition(MAP, { chapter: 0, paragraphIndex: 2 })).toBe(
      1,
    );
    expect(blockForFlowPosition(MAP, { chapter: 1, paragraphIndex: 1 })).toBe(
      6,
    );
  });

  it("clamps an out-of-range position rather than throwing", () => {
    expect(blockForFlowPosition(MAP, { chapter: 9, paragraphIndex: 0 })).toBe(
      4,
    );
    expect(blockForFlowPosition(MAP, { chapter: 0, paragraphIndex: 99 })).toBe(
      2,
    );
    expect(blockForFlowPosition(MAP, { chapter: -1, paragraphIndex: -1 })).toBe(
      0,
    );
  });

  it("returns 0 for an empty map", () => {
    expect(blockForFlowPosition([], { chapter: 0, paragraphIndex: 0 })).toBe(0);
  });
});

describe("round trip", () => {
  // The requirement in one test: every reachable position survives a switch
  // out and back unchanged.
  it("returns every flow position to itself through a block and back", () => {
    const html =
      '<p>pre</p><h1 id="docx-h-0">One</h1><ul><li>x</li><li>y</li></ul>' +
      '<p>   </p><p>z</p><h1 id="docx-h-1">Two</h1><p>q</p>' +
      '<p><img src="images/img-001.png"/></p>';
    const { chapters, blockMap } = docxHtmlToFlowDoc(html, [
      { title: "One", level: 0, anchorId: "docx-h-0" },
      { title: "Two", level: 0, anchorId: "docx-h-1" },
    ]);

    let checked = 0;
    chapters.forEach((c, chapter) => {
      c.paragraphs.forEach((_, paragraphIndex) => {
        const block = blockForFlowPosition(blockMap, {
          chapter,
          paragraphIndex,
        });
        const back = flowPositionForBlock(blockMap, block);
        // A block that produced several items collapses to its first — the
        // list you were reading, not an arbitrary row of it.
        const expected = blockMap[chapter].indexOf(block);
        expect(back).toEqual({ chapter, paragraphIndex: expected });
        checked++;
      });
    });
    expect(checked).toBeGreaterThan(5);
  });
});
