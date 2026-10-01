// @vitest-environment happy-dom
// content.html is the single source of truth for both reading modes. This
// turns it into reflowable chapters while recording which top-level block
// each item came from — the coordinate DocxPageSource paginates by, and so
// the coordinate a mode switch has to preserve.
import { describe, expect, it } from "vitest";
import { docxHtmlToFlowDoc } from "./flowDoc";
import type { DocxOutlineEntry } from "./toFixedDoc";

const outline = (...e: [string, number, string][]): DocxOutlineEntry[] =>
  e.map(([title, level, anchorId]) => ({ title, level, anchorId }));

describe("docxHtmlToFlowDoc", () => {
  it("breaks chapters at the shallowest outline level", () => {
    const html =
      '<h1 id="docx-h-0">One</h1><p>a</p>' +
      '<h2 id="docx-h-1">Sub</h2><p>b</p>' +
      '<h1 id="docx-h-2">Two</h1><p>c</p>';
    const doc = docxHtmlToFlowDoc(
      html,
      outline(
        ["One", 0, "docx-h-0"],
        ["Sub", 1, "docx-h-1"],
        ["Two", 0, "docx-h-2"],
      ),
    );
    expect(doc.chapters.map((c) => c.title)).toEqual(["One", "Two"]);
    // The h2 stays inside chapter 0 as a subhead, not its own chapter.
    expect(
      doc.chapters[0].paragraphs.map((p) => ("text" in p ? p.text : "")),
    ).toEqual(["One", "a", "Sub", "b"]);
  });

  it("puts content before the first heading in its own leading chapter", () => {
    const html = '<p>preface</p><h1 id="docx-h-0">One</h1><p>a</p>';
    const doc = docxHtmlToFlowDoc(html, outline(["One", 0, "docx-h-0"]));
    expect(doc.chapters).toHaveLength(2);
    expect(doc.chapters[0].paragraphs).toEqual([{ text: "preface" }]);
    expect(doc.chapters[1].title).toBe("One");
  });

  it("makes one chapter when the document has no headings", () => {
    const doc = docxHtmlToFlowDoc("<p>a</p><p>b</p>", []);
    expect(doc.chapters).toHaveLength(1);
    expect(doc.chapters[0].paragraphs).toEqual([{ text: "a" }, { text: "b" }]);
  });

  it("records the source block index for every item", () => {
    // blocks: 0=<h1> 1=<p>a</p> 2=<p>b</p>
    const doc = docxHtmlToFlowDoc(
      '<h1 id="docx-h-0">One</h1><p>a</p><p>b</p>',
      outline(["One", 0, "docx-h-0"]),
    );
    expect(doc.blockMap).toEqual([[0, 1, 2]]);
  });

  // One <ul> is ONE block to DocxPageSource but TWO items here, so the map
  // repeats the block index. Index arithmetic would desynchronise from here on.
  it("maps several items from one block back to that one block", () => {
    // blocks: 0=<p>a</p> 1=<ul> 2=<p>z</p>
    const doc = docxHtmlToFlowDoc(
      "<p>a</p><ul><li>x</li><li>y</li></ul><p>z</p>",
      [],
    );
    expect(doc.blockMap).toEqual([[0, 1, 1, 2]]);
  });

  // An empty block produces no item at all, so the map simply skips its index.
  it("skips a block that produced no item", () => {
    // blocks: 0=<p>a</p> 1=<p>   </p> 2=<p>b</p>
    const doc = docxHtmlToFlowDoc("<p>a</p><p>   </p><p>b</p>", []);
    expect(doc.blockMap).toEqual([[0, 2]]);
  });

  it("carries images through as image items", () => {
    const doc = docxHtmlToFlowDoc(
      '<p>a</p><p><img src="images/img-001.png"/></p>',
      [],
    );
    expect(doc.chapters[0].paragraphs[1]).toEqual({
      src: "images/img-001.png",
    });
  });

  it("gives each chapter the EpubChapter fields the reflow reader reads", () => {
    const doc = docxHtmlToFlowDoc(
      '<h1 id="docx-h-0">One</h1><p>a</p>',
      outline(["One", 0, "docx-h-0"]),
    );
    const c = doc.chapters[0];
    expect(c.order).toBe(0);
    expect(typeof c.id).toBe("string");
    expect(c.id.length).toBeGreaterThan(0);
    expect(typeof c.href).toBe("string");
  });

  // The commonest Word book layout: document title as Heading 1, chapters as
  // Heading 2. Breaking at the shallowest level present made the WHOLE BOOK
  // one chapter with no navigation at all.
  it("breaks at the shallowest level that actually divides the document", () => {
    const html =
      '<h1 id="docx-h-0">The Book</h1><p>by someone</p>' +
      '<h2 id="docx-h-1">Ch 1</h2><p>a</p>' +
      '<h2 id="docx-h-2">Ch 2</h2><p>b</p>';
    const doc = docxHtmlToFlowDoc(
      html,
      outline(
        ["The Book", 0, "docx-h-0"],
        ["Ch 1", 1, "docx-h-1"],
        ["Ch 2", 1, "docx-h-2"],
      ),
    );
    expect(doc.chapters.map((c) => c.title)).toEqual([
      "Chapter 1",
      "Ch 1",
      "Ch 2",
    ]);
  });

  // Word puts headings inside layout tables (title pages especially), and
  // mammoth emits them nested. DocxPageSource finds those anchors; flowDoc
  // must too, or the two modes disagree about where a chapter starts.
  it("breaks on a heading nested inside a top-level block", () => {
    const html =
      '<p>a</p><table><tr><td><h1 id="docx-h-0">Nested</h1><p>cell</p></td></tr></table><p>z</p>';
    const doc = docxHtmlToFlowDoc(html, outline(["Nested", 0, "docx-h-0"]));
    expect(doc.chapters.map((c) => c.title)).toEqual(["Chapter 1", "Nested"]);
  });

  it("names a chapter that has no heading of its own", () => {
    const doc = docxHtmlToFlowDoc(
      '<p>preface</p><h1 id="docx-h-0">One</h1><p>a</p>',
      outline(["One", 0, "docx-h-0"]),
      { chapterFallback: (n) => `Fasl ${n}` },
    );
    expect(doc.chapters.map((c) => c.title)).toEqual(["Fasl 1", "One"]);
  });

  // BookBody drops a chapter's first paragraph only when it matches the
  // title exactly; an uncollapsed title means the heading renders twice.
  it("collapses whitespace in a chapter title", () => {
    const doc = docxHtmlToFlowDoc(
      '<h1 id="docx-h-0">One   Two</h1><p>a</p>',
      outline(["One   Two", 0, "docx-h-0"]),
    );
    expect(doc.chapters[0].title).toBe("One Two");
  });

  it("keeps blockMap aligned with paragraphs in every chapter", () => {
    const doc = docxHtmlToFlowDoc(
      '<p>pre</p><h1 id="docx-h-0">One</h1><ul><li>x</li><li>y</li></ul><h1 id="docx-h-1">Two</h1><p>   </p><p>z</p>',
      outline(["One", 0, "docx-h-0"], ["Two", 0, "docx-h-1"]),
    );
    doc.chapters.forEach((c, i) => {
      expect(doc.blockMap[i]).toHaveLength(c.paragraphs.length);
    });
  });
});
