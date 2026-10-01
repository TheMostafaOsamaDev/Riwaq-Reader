// @vitest-environment happy-dom
//
// The two user-facing promises, checked end to end against the real
// paginator and the real converter rather than against each other:
//
//   1. switching modes lands you on the same passage
//   2. a highlight is visible in whichever mode you read in
//
// Both are asserted on TEXT. Comparing indices would only prove the two
// modules agree about numbers; comparing the words proves the reader lands
// where the reader was.
import { beforeAll, describe, expect, it } from "vitest";
import { createDocxPageSourceFromParts } from "../reader/fixed/DocxPageSource";
import type { Highlight } from "../store/library";
import { docxHtmlToFlowDoc } from "./flowDoc";
import { bridgeDocxHighlights } from "./highlightBridge";
import { type ModePosition, positionForMode } from "./modeSwitch";

// Deliberately awkward: headings at two levels, a list (one block, several
// paragraphs), an empty spacer block, and an image — every shape where the
// block count and the paragraph count disagree.
const HTML = [
  "<p>front matter</p>",
  '<h1 id="docx-h-0">Chapter One</h1>',
  ...Array.from({ length: 12 }, (_, i) => `<p>one body ${i}</p>`),
  "<ul><li>bullet alpha</li><li>bullet beta</li></ul>",
  "<p>   </p>",
  '<h2 id="docx-h-1">A section</h2>',
  ...Array.from({ length: 12 }, (_, i) => `<p>section body ${i}</p>`),
  '<p><img src="images/img-001.png"/></p>',
  '<h1 id="docx-h-2">Chapter Two</h1>',
  ...Array.from({ length: 20 }, (_, i) => `<p>two body ${i}</p>`),
].join("");

const OUTLINE = [
  { title: "Chapter One", level: 0, anchorId: "docx-h-0" },
  { title: "A section", level: 1, anchorId: "docx-h-1" },
  { title: "Chapter Two", level: 0, anchorId: "docx-h-2" },
];

// happy-dom reports every rect as 0x0, which would pack the whole document
// onto one page and make every assertion below vacuous.
beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({
      height: 110,
      width: 600,
      top: 0,
      left: 0,
      right: 600,
      bottom: 110,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
});

const flow = () => docxHtmlToFlowDoc(HTML, OUTLINE);
const pages = () =>
  createDocxPageSourceFromParts({ html: HTML, dir: "ltr", outline: OUTLINE });

/** The text of the block the paginator stamped with `blockId`. */
async function blockText(blockId: string): Promise<string> {
  const src = await pages();
  const page = src.pageForBlock?.(blockId);
  expect(page, `no page for ${blockId}`).toBeDefined();
  const host = document.createElement("div");
  document.body.appendChild(host);
  await src.renderPage(page as number, host, 1);
  const el = host.querySelector(`[data-block-id="${blockId}"]`);
  const text = (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  host.remove();
  return text;
}

describe("switching modes lands on the same passage", () => {
  it("every page's top paragraph survives pages -> flow", async () => {
    const src = await pages();
    const { chapters, blockMap } = flow();
    expect(src.pageCount).toBeGreaterThan(3);

    let checked = 0;
    for (let page = 0; page < src.pageCount; page++) {
      const blockId = src.blockForPage?.(page);
      if (!blockId) continue;

      // What the reader is looking at, in pages mode.
      const before = await blockText(blockId);

      // Switch.
      const after = positionForMode("flow", blockMap, {
        fixedAnchor: { blockId, frac: 0 },
      });
      const item =
        chapters[after.currentChapter as number].paragraphs[
          after.paragraphIndex as number
        ];
      const landed = "text" in item ? item.text : "[image]";

      // The paragraph it landed on must be part of the block it left.
      if (landed !== "[image]" && before.length > 0) {
        expect(
          before,
          `page ${page}: left "${before}" and landed on "${landed}"`,
        ).toContain(landed);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it("every paragraph survives flow -> pages", async () => {
    const { chapters, blockMap } = flow();
    let checked = 0;
    for (let c = 0; c < chapters.length; c++) {
      for (let p = 0; p < chapters[c].paragraphs.length; p += 5) {
        const item = chapters[c].paragraphs[p];
        if (!("text" in item) || item.text.length === 0) continue;
        const patch = positionForMode("pages", blockMap, {
          currentChapter: c,
          paragraphIndex: p,
        });
        const text = await blockText(patch.fixedAnchor?.blockId as string);
        expect(
          text,
          `ch${c} para${p}: "${item.text}" is not in the block it mapped to`,
        ).toContain(item.text);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("does not drift after switching back and forth three times", () => {
    const { blockMap } = flow();
    const start: ModePosition = {
      fixedAnchor: { blockId: "b20", frac: 0.42 },
    };
    let cur: ModePosition = start;
    for (let i = 0; i < 3; i++) {
      cur = positionForMode(
        "pages",
        blockMap,
        positionForMode("flow", blockMap, cur),
      );
    }
    expect(cur).toEqual(start);
  });
});

describe("a highlight is visible in both modes", () => {
  const make = (over: Partial<Highlight>): Highlight => ({
    id: "h",
    chapter: 0,
    paragraphIndex: 0,
    charStart: 0,
    charEnd: 0,
    text: "",
    color: "yellow" as Highlight["color"],
    ts: 1,
    ...over,
  });

  it("a flow-made highlight lands on the right block in pages", async () => {
    const { chapters, blockMap } = flow();
    const c = 1;
    const p = 4;
    const item = chapters[c].paragraphs[p];
    const text = "text" in item ? item.text : "";
    expect(text.length).toBeGreaterThan(0);

    const [bridged] = bridgeDocxHighlights(
      [
        make({
          chapter: c,
          paragraphIndex: p,
          charStart: 0,
          charEnd: text.length,
          text,
        }),
      ],
      blockMap,
    );
    expect(bridged.fixed?.fmt).toBe("docx");
    const block = await blockText(
      (bridged.fixed as { blockId: string }).blockId,
    );
    expect(block).toContain(text);
  });

  it("a pages-made highlight lands on the right paragraph in flow", async () => {
    const src = await pages();
    const { chapters, blockMap } = flow();
    const blockId = src.blockForPage?.(2) as string;
    const block = await blockText(blockId);

    const [bridged] = bridgeDocxHighlights(
      [
        make({
          fixed: { fmt: "docx", blockId, charStart: 0, charEnd: 5 },
          text: block.slice(0, 5),
        }),
      ],
      blockMap,
    );
    const item = chapters[bridged.chapter].paragraphs[bridged.paragraphIndex];
    const landed = "text" in item ? item.text : "";
    expect(block).toContain(landed);
  });
});
