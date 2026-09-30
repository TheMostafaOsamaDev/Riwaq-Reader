// @vitest-environment happy-dom
// The shared rule for "what counts as a block-level item". Both the EPUB
// reader and the DOCX flow adapter walk content through this, so the two
// modes agree on what a paragraph is.
import { describe, expect, it } from "vitest";
import { collectInstructions } from "./chapterInstructions";

function bodyOf(html: string): Element {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${html}</body></html>`,
    "text/html",
  );
  return doc.body;
}

describe("collectInstructions", () => {
  it("emits one text instruction per block, in document order", () => {
    const got = collectInstructions(bodyOf("<p>one</p><p>two</p>"));
    expect(got.map((g) => g.inst)).toEqual([
      { kind: "text", text: "one" },
      { kind: "text", text: "two" },
    ]);
  });

  it("reports the element that produced each instruction", () => {
    const body = bodyOf("<p>one</p><p>two</p>");
    const got = collectInstructions(body);
    expect(got[0].node).toBe(body.children[0]);
    expect(got[1].node).toBe(body.children[1]);
  });

  // li is in BLOCK_SELECTOR, so one <ul> block yields one item per <li>.
  // This is the non-1:1 case blockMap exists to absorb.
  it("emits one instruction per list item", () => {
    const got = collectInstructions(bodyOf("<ul><li>a</li><li>b</li></ul>"));
    expect(got.map((g) => g.inst)).toEqual([
      { kind: "text", text: "a" },
      { kind: "text", text: "b" },
    ]);
  });

  it("drops blocks whose text is empty or whitespace", () => {
    const got = collectInstructions(bodyOf("<p>one</p><p>   </p><p></p>"));
    expect(got).toHaveLength(1);
  });

  // EPUB content routinely wraps a figure in a single-purpose paragraph.
  it("unwraps an image that is a block's only content", () => {
    const got = collectInstructions(
      bodyOf('<p><img src="images/img-001.png" alt="a"/></p>'),
    );
    expect(got.map((g) => g.inst)).toEqual([
      { kind: "image", src: "images/img-001.png", alt: "a" },
    ]);
  });

  it("keeps the text of a block that has both text and an image", () => {
    const got = collectInstructions(
      bodyOf('<p>see <img src="i.png"/> here</p>'),
    );
    expect(got.map((g) => g.inst)).toEqual([
      { kind: "text", text: "see here" },
    ]);
  });

  it("collapses runs of whitespace inside a block", () => {
    const got = collectInstructions(bodyOf("<p>one\n\n   two</p>"));
    expect(got[0].inst).toEqual({ kind: "text", text: "one two" });
  });

  it("returns nothing for an empty container", () => {
    expect(collectInstructions(bodyOf(""))).toEqual([]);
  });
});
