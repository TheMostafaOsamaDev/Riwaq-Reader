// @vitest-environment happy-dom
//
// A reading position has to be portable, and a page number is not.
//
// Page numbers only mean something inside the pagination that produced them:
// re-paginating moves them, and flowing text has none at all. So the fixed
// reader records the topmost BLOCK alongside the page and prefers it on
// resume. These drive the real DocxPageSource, because the whole point is
// that the two directions agree with the paginator rather than with each
// other.
import { beforeAll, describe, expect, it } from "vitest";
import { createDocxPageSourceFromParts } from "./DocxPageSource";
import { docxHtmlToFlowDoc } from "../../docx/flowDoc";
import { blockIdFor, positionForMode } from "../../docx/modeSwitch";

const HTML = Array.from(
  { length: 40 },
  (_, i) => `<p>paragraph number ${i}</p>`,
).join("");

// happy-dom reports every rect as 0x0, so without this the paginator packs
// all forty blocks onto one page — and a one-page document makes every
// assertion here trivially true. (It did: the first version of this file
// passed with blockForPage hardcoded to "b0".) A fixed height per block
// forces a real multi-page split, which is the only shape that can tell a
// correct inverse from a constant.
const BLOCK_H = 120;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({
      height: BLOCK_H,
      width: 600,
      top: 0,
      left: 0,
      right: 600,
      bottom: BLOCK_H,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
});

async function source() {
  return createDocxPageSourceFromParts({ html: HTML, dir: "ltr", outline: [] });
}

describe("blockForPage / pageForBlock", () => {
  it("are inverses for every page", async () => {
    const src = await source();
    for (let page = 0; page < src.pageCount; page++) {
      const blockId = src.blockForPage?.(page);
      expect(blockId, `page ${page} has no block`).toBeDefined();
      expect(src.pageForBlock?.(blockId as string)).toBe(page);
    }
  });

  it("gives the TOPMOST block of a page, not just any block on it", async () => {
    const src = await source();
    const first = src.blockForPage?.(0);
    // Block ids are assigned in document order, so the first page's block is
    // block 0 — anything else means the inverse picked an arbitrary member.
    expect(first).toBe("b0");
  });

  it("has no answer for a page that does not exist", async () => {
    const src = await source();
    expect(src.blockForPage?.(9999)).toBeUndefined();
  });
});

describe("a position survives the round trip through flowing text", () => {
  it("returns to the same block after pages -> flow -> pages", async () => {
    const src = await source();
    const { blockMap } = docxHtmlToFlowDoc(HTML, []);

    // Reading somewhere that is not the start.
    const startBlockId = src.blockForPage?.(Math.min(1, src.pageCount - 1));
    expect(startBlockId).toBeDefined();

    // This is what the reader persists as it scrolls.
    const saved = {
      fixedAnchor: { blockId: startBlockId as string, frac: 0.3 },
    };

    // Switch to flowing text, then back.
    const inFlow = positionForMode("flow", blockMap, saved);
    const backToPages = positionForMode("pages", blockMap, inFlow);

    expect(backToPages.fixedAnchor?.blockId).toBe(startBlockId);
    expect(backToPages.fixedAnchor?.frac).toBe(0.3);

    // And the block still resolves to a real page, which is what the fixed
    // reader's resume actually calls.
    expect(
      src.pageForBlock?.(backToPages.fixedAnchor?.blockId as string),
    ).toBeDefined();
  });

  it("carries a mid-document position into flow as a real paragraph", async () => {
    const src = await source();
    const { chapters, blockMap } = docxHtmlToFlowDoc(HTML, []);
    const lastPage = src.pageCount - 1;
    const blockId = src.blockForPage?.(lastPage) as string;

    const inFlow = positionForMode("flow", blockMap, {
      fixedAnchor: { blockId, frac: 0 },
    });

    // The whole bug this guards: an unwritten anchor made every switch land
    // on paragraph 0. A late page must not.
    if (lastPage > 0) {
      expect(inFlow.paragraphIndex).toBeGreaterThan(0);
    }
    expect(inFlow.currentChapter).toBe(0);
    expect(chapters[0].paragraphs.length).toBeGreaterThan(
      inFlow.paragraphIndex as number,
    );
  });

  it("falls back to the start when nothing was ever saved", () => {
    const { blockMap } = docxHtmlToFlowDoc(HTML, []);
    expect(positionForMode("flow", blockMap, {})).toEqual({
      currentChapter: 0,
      paragraphIndex: 0,
      paragraphOffset: 0,
    });
  });

  it("maps a flow position to a block the paginator knows", async () => {
    const src = await source();
    const { blockMap } = docxHtmlToFlowDoc(HTML, []);
    const patch = positionForMode("pages", blockMap, {
      currentChapter: 0,
      paragraphIndex: 25,
      paragraphOffset: 0.5,
    });
    const blockId = patch.fixedAnchor?.blockId as string;
    expect(blockId).toBe(blockIdFor(25));
    expect(src.pageForBlock?.(blockId)).toBeDefined();
  });
});
