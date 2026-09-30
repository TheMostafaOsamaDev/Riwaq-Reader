// @vitest-environment happy-dom
//
// The invariant everything about reading modes rests on: the block index
// flowDoc records in `blockMap` is the SAME integer DocxPageSource stamps as
// `data-block-id="b{N}"`.
//
// Nothing else guards it. The two modules derive their block list from
// content.html independently — DocxPageSource parses a bare fragment and
// moves the nodes into a measuring container, flowDoc parses a <body>-wrapped
// document — so a future change to either parse could silently shift every
// index by one. Every stored reading position and every DOCX highlight
// anchors on these integers, so a drift would move all of them at once, in a
// way no other test in the suite would notice.
//
// This asserts the meaning, not just the numbers: the block DocxPageSource
// stamped `b{N}` must contain the text flowDoc attributed to block N.
import { describe, expect, it } from "vitest";
import { createDocxPageSourceFromParts } from "../reader/fixed/DocxPageSource";
import { docxHtmlToFlowDoc } from "./flowDoc";

/** Render every page and read back what DocxPageSource actually stamped. */
async function stampedText(html: string): Promise<Map<string, string>> {
  const src = await createDocxPageSourceFromParts({
    html,
    dir: "ltr",
    outline: [],
  });
  const out = new Map<string, string>();
  for (let i = 0; i < src.pageCount; i++) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await src.renderPage(i, host, 1);
    for (const el of host.querySelectorAll("[data-block-id]")) {
      const id = el.getAttribute("data-block-id");
      if (id && !out.has(id)) {
        out.set(id, (el.textContent ?? "").replace(/\s+/g, " ").trim());
      }
    }
    host.remove();
  }
  return out;
}

const SHAPES: [string, string][] = [
  ["plain paragraphs", "<p>alpha</p><p>beta</p><p>gamma</p>"],
  ["a list", "<p>alpha</p><ul><li>one</li><li>two</li></ul><p>beta</p>"],
  ["an empty block", "<p>alpha</p><p>   </p><p>beta</p>"],
  [
    "headings",
    '<h1 id="docx-h-0">Title</h1><p>alpha</p><h1 id="docx-h-1">Next</h1><p>beta</p>',
  ],
  [
    "a heading nested in a table",
    '<p>alpha</p><table><tr><td><h1 id="docx-h-0">Nested</h1><p>cell</p></td></tr></table><p>beta</p>',
  ],
  ["a div wrapper", "<div><p>alpha</p></div><p>beta</p>"],
  ["an inline image", '<p>alpha</p><p><img src="images/img-001.png"/></p>'],
  ["nested lists", "<ul><li>one<ul><li>deep</li></ul></li></ul><p>beta</p>"],
];

describe("blockMap agrees with DocxPageSource's data-block-id", () => {
  for (const [name, html] of SHAPES) {
    it(`holds for ${name}`, async () => {
      const stamped = await stampedText(html);
      const { chapters, blockMap } = docxHtmlToFlowDoc(html, []);

      // Something must have been stamped, or the test is vacuous.
      expect(stamped.size).toBeGreaterThan(0);

      let checked = 0;
      chapters.forEach((c, ci) => {
        c.paragraphs.forEach((item, ii) => {
          const blockId = `b${blockMap[ci][ii]}`;
          expect(
            stamped.has(blockId),
            `${name}: flowDoc referenced ${blockId}, which DocxPageSource never stamped`,
          ).toBe(true);

          // The integer must MEAN the same block in both modules: the text
          // flowDoc took from it has to be inside the block that was stamped.
          if ("text" in item && item.text.length > 0) {
            expect(
              stamped.get(blockId),
              `${name}: ${blockId} holds a different block in each module`,
            ).toContain(item.text);
            checked++;
          }
        });
      });
      expect(checked).toBeGreaterThan(0);
    });
  }
});
