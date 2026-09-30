# DOCX Flow Engine — Implementation Plan (Phase 2a of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a stored DOCX's `content.html` into reflowable chapters, and map a reading position losslessly between fixed-page and reflow coordinates.

**Architecture:** `content.html` is the single source of truth for both modes. This phase builds the pure, headless half: a shared block-instruction collector (extracted from the EPUB parser so the two paths cannot drift), a `flowDoc` builder that produces `EpubChapter[]` plus a `blockMap`, and a position mapper. No UI, no state, no routing — Phase 2b wires it up.

**Tech Stack:** TypeScript, Vitest + happy-dom. No new dependencies. DOMParser only (no Tauri, no browser).

**Spec:** `docs/superpowers/specs/2026-10-01-docx-import-modes-and-background-design.md` (Sections 2 and 3)

## Why this is split from Phase 2b

Phase 2 as specced is seven tasks spanning a conversion engine, position mapping, persisted state, reader routing, two toggles and highlight translation. Tasks 1–3 are where the correctness risk lives and are fully testable with no browser, no Tauri and no React. Tasks 4–7 are mechanical wiring that depends on them. Splitting keeps each plan reviewable and puts the subtle work behind its own gate.

## Global Constraints

- Worktree: `~/Desktop/my-work/Riwaq-import-modes`, branch `feat/import-modes`. The main checkout at `~/Desktop/my-work/Riwaq-reader` is live — never `checkout`/`switch`/`reset` there.
- Never `git add -A`. Stage named paths only.
- Commit messages carry no AI/Claude attribution, written as the user.
- The project gate is `pnpm check` (= `format:check && lint && build && test`). Not `biome check` — that runs an organize-imports assist this repo does not enforce and which already fails on untouched files.
- Baseline entering this plan: 117 files, 1081 passed, 1 skipped.
- **`EpubChapter` must not grow a DOCX-only field.** `blockMap` lives in the DOCX adapter. `src/epub/types.ts` is not modified.
- **`src/reader/fixed/DocxPageSource.ts` is not modified.** Its block indexing is the coordinate this phase maps against; changing it would invalidate every stored `fixedAnchor`.
- Top-level block index N means: the index into `body.children` of the parsed `content.html`. This matches `DocxPageSource.ts:103` (`[...meas.children]`), which is what stamps `data-block-id="b{N}"`. The two must stay in agreement.

## Review Focus

Input classes the spec implies but which no task would otherwise exercise. Each has its test assigned to the task that owns the code.

1. **A top-level block producing several items** — `<ul><li>a</li><li>b</li></ul>` is one block to `DocxPageSource` but two items to the collector (`li` is in `BLOCK_SELECTOR`). Naive index arithmetic breaks here; `blockMap` must absorb it. → Task 3.
2. **A top-level block producing no item** — an empty `<p></p>`, or a `<div>` whose text is whitespace. `parser.ts:582` drops these. Expected: every later position still maps correctly. → Task 3.
3. **A document with no headings at all.** Expected: one chapter covering every block, and mapping still works. → Task 2.
4. **A position in a block that produced no item** (reading a blank spacer paragraph in pages mode, then switching). Expected: nearest preceding item, never a throw, never a silent reset to chapter 0. → Task 3.
5. **Content before the first heading.** Expected: it becomes its own leading chapter rather than being dropped, and its blocks map into that chapter. → Task 2.

---

### Task 1: Extract the block-instruction collector, reporting its source node

**Files:**
- Create: `src/epub/chapterInstructions.ts`
- Modify: `src/epub/parser.ts` (remove the moved code; call the new module at `:129`)
- Test: `src/epub/chapterInstructions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export type ChapterInstruction =
  | { kind: "text"; text: string }
  | { kind: "image"; src: string; alt?: string };

/** One instruction plus the element that produced it, so a caller can
 *  attribute it back to a top-level block. */
export interface LocatedInstruction {
  inst: ChapterInstruction;
  node: Element;
}

export function collectInstructions(container: Element): LocatedInstruction[];
```
Task 2 imports `collectInstructions` and `ChapterInstruction` by these exact names.

**Why this extraction:** `flowDoc` must apply the *same* rules the EPUB reader applies — which blocks count, how a bare `<p><img></p>` is unwrapped, which empties are dropped — or the two modes would disagree about what a paragraph is. Duplicating ~40 lines would drift. `parser.test.ts` guards the move.

- [ ] **Step 1: Write the failing test**

Create `src/epub/chapterInstructions.test.ts`:

```ts
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
    const got = collectInstructions(bodyOf('<p><img src="images/img-001.png" alt="a"/></p>'));
    expect(got.map((g) => g.inst)).toEqual([
      { kind: "image", src: "images/img-001.png", alt: "a" },
    ]);
  });

  it("keeps the text of a block that has both text and an image", () => {
    const got = collectInstructions(bodyOf('<p>see <img src="i.png"/> here</p>'));
    expect(got.map((g) => g.inst)).toEqual([{ kind: "text", text: "see here" }]);
  });

  it("collapses runs of whitespace inside a block", () => {
    const got = collectInstructions(bodyOf("<p>one\n\n   two</p>"));
    expect(got[0].inst).toEqual({ kind: "text", text: "one two" });
  });

  it("returns nothing for an empty container", () => {
    expect(collectInstructions(bodyOf(""))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run chapterInstructions`
Expected: FAIL — cannot resolve `./chapterInstructions`.

- [ ] **Step 3: Create the module by moving the code**

Create `src/epub/chapterInstructions.ts`. Move `BLOCK_SELECTOR`, `ITEM_SELECTOR`, the `ChapterInstruction` type and the body of `collectChapterInstructions` from `src/epub/parser.ts` (currently `:536-601`), changing only the signature and the return shape:

```ts
// What counts as a block-level item, and how one is read.
//
// Shared deliberately: the EPUB reader (parser.ts) and the DOCX flow
// adapter (docx/flowDoc.ts) both walk content through here, so the two
// reading modes agree on what a paragraph is. Two copies of these rules
// would drift, and a drift here moves every reading position.

const BLOCK_SELECTOR =
  "p, blockquote, h1, h2, h3, h4, h5, h6, li, figcaption, div.para";
const ITEM_SELECTOR = `${BLOCK_SELECTOR}, img`;

/** A flat document-order list of text spans + image references. The image
 *  step is deferred so a zip-read can run async without scattering awaits
 *  inside the DOM walk. */
export type ChapterInstruction =
  | { kind: "text"; text: string }
  | { kind: "image"; src: string; alt?: string };

/** One instruction plus the element that produced it. The EPUB path
 *  discards `node`; the DOCX flow adapter uses it to attribute each item
 *  back to the top-level block it came from, which is the coordinate
 *  DocxPageSource paginates by. */
export interface LocatedInstruction {
  inst: ChapterInstruction;
  node: Element;
}

export function collectInstructions(container: Element): LocatedInstruction[] {
  const nodes = container.querySelectorAll(ITEM_SELECTOR);
  const seen = new Set<Element>();
  const out: LocatedInstruction[] = [];

  nodes.forEach((node) => {
    const isImg = node.tagName.toLowerCase() === "img";

    // Skip elements nested inside another matching block. Exception: a bare
    // `<p><img/></p>` wrapper passes the img through, since EPUB content
    // routinely wraps images in single-purpose paragraphs.
    let anc = node.parentElement;
    while (anc && anc !== container) {
      if (anc.matches(BLOCK_SELECTOR)) {
        const ancText = (anc.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!isImg || ancText.length > 0) return;
      }
      anc = anc.parentElement;
    }
    if (seen.has(node)) return;
    seen.add(node);

    if (isImg) {
      const src = node.getAttribute("src");
      if (!src) return;
      const alt = node.getAttribute("alt") || undefined;
      out.push({ inst: { kind: "image", src, alt }, node });
      return;
    }

    // Block element. If its only meaningful content is an inner <img> with
    // no surrounding text, emit that image directly so we don't drop it on
    // the (text.length > 0) check below.
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length === 0) {
      const innerImg = node.querySelector("img");
      if (innerImg) {
        const src = innerImg.getAttribute("src");
        if (src) {
          seen.add(innerImg);
          out.push({
            inst: {
              kind: "image",
              src,
              alt: innerImg.getAttribute("alt") || undefined,
            },
            node,
          });
        }
      }
      return;
    }
    out.push({ inst: { kind: "text", text }, node });
  });

  return out;
}
```

- [ ] **Step 4: Point parser.ts at the new module**

In `src/epub/parser.ts`: delete `BLOCK_SELECTOR`, `ITEM_SELECTOR`, the local `ChapterInstruction` type and `collectChapterInstructions` (the block at `:536-601`). Add to the imports:

```ts
import {
  collectInstructions,
  type ChapterInstruction,
} from "./chapterInstructions";
```

At `:129`, replace:

```ts
    const instructions = collectChapterInstructions(root);
```

with:

```ts
    // `.inst` — the EPUB path does not need to know which element produced
    // each item; the DOCX flow adapter does.
    const instructions = collectInstructions(
      root.body ?? root.documentElement,
    ).map((l) => l.inst);
```

If `ChapterInstruction` is referenced anywhere else in `parser.ts` (e.g. `resolveChapterItems`'s parameter type at `:610`), it now comes from the import — no other change needed.

- [ ] **Step 5: Run both test files to verify green**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run chapterInstructions parser`
Expected: PASS. `chapterInstructions` 8/8, and **every existing `parser.test.ts` test still passes** — that suite is the proof this move was behaviour-preserving. If any parser test goes red, the move was not faithful; fix the move, do not edit the parser test.

- [ ] **Step 6: Run the whole suite**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run`
Expected: 118 files, 1089 passed, 1 skipped.

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/my-work/Riwaq-import-modes
git add src/epub/chapterInstructions.ts src/epub/chapterInstructions.test.ts src/epub/parser.ts
git commit -m "refactor(epub): share the block-instruction rules

Moved the block selector and the document-order walk out of parser.ts so
the DOCX flow adapter can apply the same rules. Two copies would drift,
and a drift in what counts as a paragraph moves every reading position.

Each instruction now reports the element that produced it. The EPUB path
discards it; the flow adapter needs it to attribute an item back to the
top-level block DocxPageSource paginates by.

No behaviour change — parser.test.ts is the proof."
```

---

### Task 2: `flowDoc` — content.html to chapters + blockMap

**Files:**
- Create: `src/docx/flowDoc.ts`
- Test: `src/docx/flowDoc.test.ts`

**Interfaces:**
- Consumes: `collectInstructions`, `LocatedInstruction` from `../epub/chapterInstructions` (Task 1). `EpubChapter`, `ChapterItem` from `../epub/types`. `DocxOutlineEntry` from `./toFixedDoc`.
- Produces:
```ts
export interface FlowDoc {
  chapters: EpubChapter[];
  /** blockMap[chapterIndex][itemIndex] = index of the top-level block in
   *  content.html that produced that item. Recorded during the walk, never
   *  inferred — the mapping is not 1:1. */
  blockMap: number[][];
}

export function docxHtmlToFlowDoc(
  html: string,
  outline: DocxOutlineEntry[],
): FlowDoc;
```
Task 3 imports `FlowDoc` and consumes `blockMap` by this exact shape.

**Chaptering rule:** break at the *shallowest* level present in `outline` (`level` 0 beats 1 beats 2), matching `pickBreakLevel`'s intent but driven by the stored outline rather than re-sniffing the HTML, so both modes show the same TOC. Blocks before the first break heading become a leading chapter. No headings at all → one chapter covering everything.

- [ ] **Step 1: Write the failing test**

Create `src/docx/flowDoc.test.ts`:

```ts
// content.html is the single source of truth for both reading modes. This
// turns it into reflowable chapters while recording which top-level block
// each item came from — the coordinate DocxPageSource paginates by, and so
// the coordinate a mode switch has to preserve.
import { describe, expect, it } from "vitest";
import { docxHtmlToFlowDoc } from "./flowDoc";
import type { DocxOutlineEntry } from "./toFixedDoc";

const outline = (
  ...e: [string, number, string][]
): DocxOutlineEntry[] =>
  e.map(([title, level, anchorId]) => ({ title, level, anchorId }));

describe("docxHtmlToFlowDoc", () => {
  it("breaks chapters at the shallowest outline level", () => {
    const html =
      '<h1 id="docx-h-0">One</h1><p>a</p>' +
      '<h2 id="docx-h-1">Sub</h2><p>b</p>' +
      '<h1 id="docx-h-2">Two</h1><p>c</p>';
    const doc = docxHtmlToFlowDoc(
      html,
      outline(["One", 0, "docx-h-0"], ["Sub", 1, "docx-h-1"], ["Two", 0, "docx-h-2"]),
    );
    expect(doc.chapters.map((c) => c.title)).toEqual(["One", "Two"]);
    // The h2 stays inside chapter 0 as a subhead, not its own chapter.
    expect(doc.chapters[0].paragraphs.map((p) => ("text" in p ? p.text : ""))).toEqual(
      ["One", "a", "Sub", "b"],
    );
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
    const doc = docxHtmlToFlowDoc("<p>a</p><ul><li>x</li><li>y</li></ul><p>z</p>", []);
    expect(doc.blockMap).toEqual([[0, 1, 1, 2]]);
  });

  // An empty block produces no item at all, so the map simply skips its index.
  it("skips a block that produced no item", () => {
    // blocks: 0=<p>a</p> 1=<p></p> 2=<p>b</p>
    const doc = docxHtmlToFlowDoc("<p>a</p><p>   </p><p>b</p>", []);
    expect(doc.blockMap).toEqual([[0, 2]]);
  });

  it("carries images through as image items", () => {
    const doc = docxHtmlToFlowDoc('<p>a</p><p><img src="images/img-001.png"/></p>', []);
    expect(doc.chapters[0].paragraphs[1]).toEqual({ src: "images/img-001.png" });
  });

  it("gives each chapter the EpubChapter fields the reflow reader reads", () => {
    const doc = docxHtmlToFlowDoc('<h1 id="docx-h-0">One</h1><p>a</p>', outline(["One", 0, "docx-h-0"]));
    const c = doc.chapters[0];
    expect(c.order).toBe(0);
    expect(typeof c.id).toBe("string");
    expect(c.id.length).toBeGreaterThan(0);
    expect(typeof c.href).toBe("string");
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run flowDoc`
Expected: FAIL — cannot resolve `./flowDoc`.

- [ ] **Step 3: Write the implementation**

Create `src/docx/flowDoc.ts`:

```ts
// A stored DOCX read as reflowing text.
//
// `books/<id>/content.html` is the single source of truth for both reading
// modes: DocxPageSource paginates it into fixed cards, and this turns the
// same file into chapters the reflowable reader consumes. Nothing is
// converted, zipped or copied — book.json already stores chapters inline
// (see epub/types.ts) and the reflow reader never opens an archive at read
// time, so a reflowable DOCX needs no EPUB and no second copy of any image.
//
// The other half of this module's job is `blockMap`. Both modes index
// block-level content in document order, but not one-for-one: one <ul> is a
// single block to the paginator and one item per <li> here, and an empty
// paragraph is a block that yields no item at all. So the correspondence is
// RECORDED as the walk runs rather than computed afterwards — index
// arithmetic would desynchronise at the first list or blank line and move
// every reading position after it.

import {
  collectInstructions,
  type ChapterInstruction,
} from "../epub/chapterInstructions";
import type { ChapterItem, EpubChapter } from "../epub/types";
import type { DocxOutlineEntry } from "./toFixedDoc";

export interface FlowDoc {
  chapters: EpubChapter[];
  /** blockMap[chapterIndex][itemIndex] = index of the top-level block in
   *  content.html that produced that item. Recorded during the walk, never
   *  inferred — the mapping is not 1:1. */
  blockMap: number[][];
}

/** Title for a chapter that has no heading of its own. Left in English at
 *  this layer only as an id-ish default; the reader shows chapter titles
 *  from this list, and a DOCX preface genuinely has no name in the file. */
const LEADING_CHAPTER_TITLE = "";

export function docxHtmlToFlowDoc(
  html: string,
  outline: DocxOutlineEntry[],
): FlowDoc {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${html}</body></html>`,
    "text/html",
  );
  const body = doc.body;

  // The top-level blocks, in the same order and with the same indices
  // DocxPageSource assigns (`[...meas.children]`). This is the shared
  // coordinate; it must not be derived any other way.
  const blocks = [...body.children];
  const blockIndexOf = new Map<Element, number>();
  blocks.forEach((b, i) => blockIndexOf.set(b, i));

  // Which anchors start a chapter: the shallowest level present wins, so an
  // h2-only document chapters cleanly and a mixed h1/h2 document breaks at
  // h1 with the h2s living inside as subheads.
  const breakLevel = outline.length
    ? Math.min(...outline.map((o) => o.level))
    : null;
  const breakTitleByAnchor = new Map<string, string>();
  for (const o of outline) {
    if (o.level === breakLevel) breakTitleByAnchor.set(o.anchorId, o.title);
  }

  /** The top-level block an instruction belongs to. The collector reports
   *  the element that produced it, which may be nested (an <li> inside a
   *  <ul>), so walk up to the child of body. */
  const topLevelIndex = (node: Element): number => {
    let el: Element | null = node;
    while (el && el.parentElement && el.parentElement !== body) {
      el = el.parentElement;
    }
    return el ? (blockIndexOf.get(el) ?? 0) : 0;
  };

  const chapters: EpubChapter[] = [];
  const blockMap: number[][] = [];
  let items: ChapterItem[] = [];
  let map: number[] = [];
  let title: string | null = null;

  const flush = () => {
    // A chapter with no items and no title never existed — a document
    // opening directly on a heading would otherwise get an empty leading
    // chapter before it.
    if (items.length === 0 && title === null) return;
    const order = chapters.length;
    chapters.push({
      id: `docx-ch-${order}`,
      href: `docx-ch-${order}`,
      title: title ?? LEADING_CHAPTER_TITLE,
      paragraphs: items,
      order,
    });
    blockMap.push(map);
    items = [];
    map = [];
  };

  for (const located of collectInstructions(body)) {
    const blockIdx = topLevelIndex(located.node);
    const anchorId = blocks[blockIdx]?.id;

    // A break heading closes the previous chapter and opens the next. The
    // heading itself leads the new chapter, exactly as it reads on the page.
    if (anchorId && breakTitleByAnchor.has(anchorId)) {
      flush();
      title = breakTitleByAnchor.get(anchorId) ?? "";
    }

    items.push(toItem(located.inst));
    map.push(blockIdx);
  }
  flush();

  // A document with no content at all still needs one chapter, or the
  // reader has nothing to render and no position to hold.
  if (chapters.length === 0) {
    chapters.push({
      id: "docx-ch-0",
      href: "docx-ch-0",
      title: LEADING_CHAPTER_TITLE,
      paragraphs: [],
      order: 0,
    });
    blockMap.push([]);
  }

  return { chapters, blockMap };
}

function toItem(inst: ChapterInstruction): ChapterItem {
  if (inst.kind === "text") return { text: inst.text };
  // DOCX images already sit at `images/img-NNN.ext` under books/<id>/ —
  // the same shape EPUB extraction produces — so the href passes straight
  // through and chapterImageSrcFor resolves it unchanged.
  return inst.alt ? { src: inst.src, alt: inst.alt } : { src: inst.src };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run flowDoc`
Expected: PASS, 9/9.

- [ ] **Step 5: Tamper check**

Replace the `map.push(blockIdx)` line with `map.push(items.length - 1)` (index arithmetic instead of the recorded block). Re-run.
Expected: "maps several items from one block back to that one block" and "skips a block that produced no item" both FAIL. Restore and confirm green. This is the proof that `blockMap` is doing real work rather than coincidentally matching an index.

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/my-work/Riwaq-import-modes
git add src/docx/flowDoc.ts src/docx/flowDoc.test.ts
git commit -m "feat(docx): read a stored DOCX as reflowing chapters

content.html is the single source of truth for both reading modes, so
reflow needs no EPUB, no zip and no second copy of any image: book.json
already stores chapters inline and the reflow reader never opens an
archive at read time.

Chapters break at the shallowest level in the stored outline, so both
modes show the same table of contents, and content before the first
heading keeps its own leading chapter instead of being dropped.

blockMap records which top-level block produced each item as the walk
runs. The correspondence is not 1:1 — one <ul> is one block and one item
per <li>, an empty paragraph is a block with no item — so computing it
afterwards would desynchronise at the first list and move every position
after it."
```

---

### Task 3: Position mapping between the two modes

**Files:**
- Create: `src/docx/flowPosition.ts`
- Test: `src/docx/flowPosition.test.ts`

**Interfaces:**
- Consumes: `FlowDoc["blockMap"]` from `./flowDoc` (Task 2).
- Produces:
```ts
export interface FlowPosition { chapter: number; paragraphIndex: number }

/** Fixed-page anchor (block index) -> flow position. */
export function flowPositionForBlock(
  blockMap: number[][],
  blockIndex: number,
): FlowPosition;

/** Flow position -> fixed-page anchor (block index). */
export function blockForFlowPosition(
  blockMap: number[][],
  pos: FlowPosition,
): number;
```
Phase 2b consumes both by these exact names, converting `blockIndex` to/from the `"b{N}"` string form that `BookState.fixedAnchor.blockId` and `DocxPageSource.pageForBlock()` use.

- [ ] **Step 1: Write the failing test**

Create `src/docx/flowPosition.test.ts`:

```ts
// Switching reading mode must land on the same paragraph, both directions.
// Both modes index block-level content in document order, but not
// one-for-one, so every conversion is a blockMap lookup — never arithmetic.
import { describe, expect, it } from "vitest";
import { blockForFlowPosition, flowPositionForBlock } from "./flowPosition";
import { docxHtmlToFlowDoc } from "./flowDoc";

// chapter 0: blocks 0,1,1,2   chapter 1: blocks 4,6
const MAP = [
  [0, 1, 1, 2],
  [4, 6],
];

describe("flowPositionForBlock", () => {
  it("finds the chapter and item a block produced", () => {
    expect(flowPositionForBlock(MAP, 0)).toEqual({ chapter: 0, paragraphIndex: 0 });
    expect(flowPositionForBlock(MAP, 2)).toEqual({ chapter: 0, paragraphIndex: 3 });
    expect(flowPositionForBlock(MAP, 4)).toEqual({ chapter: 1, paragraphIndex: 0 });
    expect(flowPositionForBlock(MAP, 6)).toEqual({ chapter: 1, paragraphIndex: 1 });
  });

  it("takes the FIRST item when one block produced several", () => {
    // Block 1 produced items 1 and 2; landing on the first is what puts the
    // reader at the top of the list they were looking at.
    expect(flowPositionForBlock(MAP, 1)).toEqual({ chapter: 0, paragraphIndex: 1 });
  });

  // Reading a blank spacer paragraph in pages mode, then switching.
  it("falls back to the nearest preceding item for a block with no item", () => {
    expect(flowPositionForBlock(MAP, 3)).toEqual({ chapter: 0, paragraphIndex: 3 });
    expect(flowPositionForBlock(MAP, 5)).toEqual({ chapter: 1, paragraphIndex: 0 });
  });

  it("clamps past the end rather than throwing", () => {
    expect(flowPositionForBlock(MAP, 999)).toEqual({ chapter: 1, paragraphIndex: 1 });
  });

  it("clamps before the start rather than throwing", () => {
    expect(flowPositionForBlock(MAP, -1)).toEqual({ chapter: 0, paragraphIndex: 0 });
  });

  it("returns the origin for an empty map", () => {
    expect(flowPositionForBlock([], 5)).toEqual({ chapter: 0, paragraphIndex: 0 });
    expect(flowPositionForBlock([[]], 5)).toEqual({ chapter: 0, paragraphIndex: 0 });
  });
});

describe("blockForFlowPosition", () => {
  it("returns the block an item came from", () => {
    expect(blockForFlowPosition(MAP, { chapter: 0, paragraphIndex: 0 })).toBe(0);
    expect(blockForFlowPosition(MAP, { chapter: 0, paragraphIndex: 2 })).toBe(1);
    expect(blockForFlowPosition(MAP, { chapter: 1, paragraphIndex: 1 })).toBe(6);
  });

  it("clamps an out-of-range position rather than throwing", () => {
    expect(blockForFlowPosition(MAP, { chapter: 9, paragraphIndex: 0 })).toBe(4);
    expect(blockForFlowPosition(MAP, { chapter: 0, paragraphIndex: 99 })).toBe(2);
    expect(blockForFlowPosition(MAP, { chapter: -1, paragraphIndex: -1 })).toBe(0);
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
        const block = blockForFlowPosition(blockMap, { chapter, paragraphIndex });
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run flowPosition`
Expected: FAIL — cannot resolve `./flowPosition`.

- [ ] **Step 3: Write the implementation**

Create `src/docx/flowPosition.ts`:

```ts
// Converting a reading position between the two DOCX reading modes.
//
// Fixed pages anchor to a top-level block index (`data-block-id="b{N}"`,
// see reader/fixed/DocxPageSource.ts); reflow anchors to a chapter plus an
// item index. Both count block-level content in document order, but not
// one-for-one, so every conversion here is a lookup in the blockMap that
// flowDoc recorded — never arithmetic over indices.
//
// Nothing throws and nothing resets to the start: a position that cannot be
// matched exactly resolves to the nearest preceding one, because landing a
// few lines early is a rounding error and landing at chapter 0 is losing
// someone's place in a book.

export interface FlowPosition {
  chapter: number;
  paragraphIndex: number;
}

const ORIGIN: FlowPosition = { chapter: 0, paragraphIndex: 0 };

/** Fixed-page anchor -> flow position.
 *
 *  When one block produced several items (a list), this returns the FIRST —
 *  the top of the thing the reader was looking at. When a block produced no
 *  item at all (an empty spacer paragraph), it returns the nearest preceding
 *  item rather than nothing. */
export function flowPositionForBlock(
  blockMap: number[][],
  blockIndex: number,
): FlowPosition {
  let best: FlowPosition | null = null;

  for (let chapter = 0; chapter < blockMap.length; chapter++) {
    const blocks = blockMap[chapter];
    for (let paragraphIndex = 0; paragraphIndex < blocks.length; paragraphIndex++) {
      const b = blocks[paragraphIndex];
      if (b === blockIndex) {
        // First item of this block wins; later ones are the same block.
        return { chapter, paragraphIndex };
      }
      // Document order is monotonic, so anything at or before the target is
      // a candidate and the last such candidate is the nearest preceding.
      if (b < blockIndex) best = { chapter, paragraphIndex };
    }
  }

  return best ?? ORIGIN;
}

/** Flow position -> fixed-page anchor. Out-of-range input clamps into the
 *  document rather than throwing: state on disk can outlive the content it
 *  described (a re-import, a repaired book). */
export function blockForFlowPosition(
  blockMap: number[][],
  pos: FlowPosition,
): number {
  if (blockMap.length === 0) return 0;
  const chapter = clamp(pos.chapter, 0, blockMap.length - 1);
  const blocks = blockMap[chapter];
  if (blocks.length === 0) return 0;
  return blocks[clamp(pos.paragraphIndex, 0, blocks.length - 1)];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run flowPosition`
Expected: PASS, 10/10 including the round trip.

- [ ] **Step 5: Tamper check**

Change `if (b < blockIndex) best = …` to `if (b < blockIndex) best = best ?? { chapter, paragraphIndex };` (keeps the *first* preceding candidate instead of the nearest). Re-run.
Expected: "falls back to the nearest preceding item for a block with no item" FAILS. Restore and confirm green.

- [ ] **Step 6: Run the whole suite and the project gate**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm check`
Expected: format, lint, tsc and tests all clean. 120 files, 1108 passed, 1 skipped.

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/my-work/Riwaq-import-modes
git add src/docx/flowPosition.ts src/docx/flowPosition.test.ts
git commit -m "feat(docx): map a reading position between the two modes

Fixed pages anchor to a top-level block index, reflow to a chapter plus
an item index. Both count block-level content in document order but not
one-for-one, so each conversion is a blockMap lookup rather than
arithmetic.

Nothing throws and nothing resets to the start: an unmatched position
resolves to the nearest preceding item. Landing a few lines early is a
rounding error; landing at chapter 0 is losing someone's place."
```

---

## Verification

After all three tasks:

- [ ] `pnpm check` — format, lint, typecheck, full suite green.
- [ ] `git log --oneline main..HEAD` shows three new commits on top of Phase 1.
- [ ] No file under `src/reader/fixed/` was modified (`git diff --name-only main..HEAD` must not list `DocxPageSource.ts`).
- [ ] `src/epub/types.ts` was not modified.

## Out of scope for this phase

Phase 2b wires this up: `BookState.readingMode`, `loadDocxFlowBook`, `App.tsx` routing, the `SegRow` toggle in **both** readers (fixed and reflow — omitting either makes flow mode a one-way door), highlight translation across modes, and the i18n strings. Phase 3 is background import. Nothing here touches state, routing, React or Tauri.
