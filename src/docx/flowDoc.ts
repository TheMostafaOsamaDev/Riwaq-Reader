// A stored DOCX read as reflowing text.
//
// `books/<id>/content.html` is the single source of truth for both reading
// modes: DocxPageSource paginates it into fixed cards, and this turns the
// same file into chapters the reflowable reader consumes. Nothing is
// converted, zipped or copied — book.json already stores chapters inline
// (see epub/types.ts) and the reflow reader never opens an archive at read
// time, so a reflowable DOCX needs no EPUB and no second copy of any image.
//
// Chapters break at the shallowest heading level that actually divides the
// document. Flow mode's table of contents is therefore FLATTER than fixed
// mode's: EpubChapter[] is a flat list, while DocxPageSource's outline keeps
// every h1/h2/h3 level. The two agree on where chapters start, not on how
// many levels they show — an earlier draft of the spec claimed both modes
// show an identical TOC, and that is not achievable with a flat chapter list.
//
// The other half of this module's job is `blockMap`. Both modes index
// block-level content in document order, but not one-for-one: one <ul> is a
// single block to the paginator and one item per <li> here, and an empty
// paragraph is a block that yields no item at all. So the correspondence is
// RECORDED as the walk runs rather than computed afterwards — index
// arithmetic would desynchronise at the first list or blank line and move
// every reading position after it.

import {
  type ChapterInstruction,
  collectInstructions,
} from "../epub/chapterInstructions";
import type { ChapterItem, EpubChapter } from "../epub/types";
import type { DocxOutlineEntry } from "./toFixedDoc";

export interface FlowDocOptions {
  /** Name for a chapter with no heading of its own. The app passes a
   *  localized formatter (`reader.chapterNumber`); the English default is a
   *  last-resort net for callers that have no translator, never what ships. */
  chapterFallback?: (oneBasedIndex: number) => string;
}

export interface FlowDoc {
  chapters: EpubChapter[];
  /** blockMap[chapterIndex][itemIndex] = index of the top-level block in
   *  content.html that produced that item. Recorded during the walk, never
   *  inferred — the mapping is not 1:1.
   *
   *  Block-level only, deliberately. When one block produced several items
   *  (a list), every one of them maps back to that single block, so this is
   *  enough to carry a reading POSITION but not enough to place a highlight
   *  that sits on the third <li> of a list: converting it back would land on
   *  the first. Cross-mode highlight placement needs each item's character
   *  offset within its block, which is not recoverable from this map — see
   *  blockParity.test.ts for what this coordinate does guarantee. */
  blockMap: number[][];
}

const DEFAULT_FALLBACK = (n: number) => `Chapter ${n}`;

export function docxHtmlToFlowDoc(
  html: string,
  outline: DocxOutlineEntry[],
  options: FlowDocOptions = {},
): FlowDoc {
  const chapterFallback = options.chapterFallback ?? DEFAULT_FALLBACK;
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

  // Which anchors start a chapter: the shallowest level that actually
  // DIVIDES the document — the shallowest with more than one heading.
  //
  // Taking the shallowest level present instead is what the old DOCX->EPUB
  // splitter did, and it collapses the commonest Word book layout — document
  // title as Heading 1, chapters as Heading 2 — into a single chapter with no
  // navigation at all. A lone top-level heading is a title, not a division.
  const levels = new Map<number, number>();
  for (const o of outline) levels.set(o.level, (levels.get(o.level) ?? 0) + 1);
  const ascending = [...levels.keys()].sort((a, b) => a - b);
  const breakLevel =
    ascending.find((l) => (levels.get(l) ?? 0) > 1) ?? ascending[0] ?? null;
  const breakTitleByAnchor = new Map<string, string>();
  for (const o of outline) {
    if (o.level === breakLevel) {
      // Collapsed: BookBody drops a chapter's first paragraph only when it
      // matches the title exactly, and item text is already collapsed. An
      // uncollapsed title means the heading renders twice.
      breakTitleByAnchor.set(o.anchorId, o.title.replace(/\s+/g, " ").trim());
    }
  }

  /** The break title a top-level block opens, if any. Checks the block's own
   *  id AND ids nested inside it — Word puts headings in layout tables, and
   *  DocxPageSource maps those nested anchors too (DocxPageSource.ts:111-114).
   *  Reading only the block's own id would let the two modes disagree about
   *  where a chapter starts. */
  const breakTitleOf = (block: Element | undefined): string | undefined => {
    if (!block) return undefined;
    if (block.id && breakTitleByAnchor.has(block.id)) {
      return breakTitleByAnchor.get(block.id);
    }
    for (const el of block.querySelectorAll("[id^='docx-h-']")) {
      const t = breakTitleByAnchor.get(el.id);
      if (t !== undefined) return t;
    }
    return undefined;
  };

  /** The top-level block an instruction belongs to. The collector reports
   *  the element that produced it, which may be nested (an <li> inside a
   *  <ul>), so walk up to the child of body. */
  const topLevelIndex = (node: Element): number => {
    let el: Element | null = node;
    while (el?.parentElement && el.parentElement !== body) {
      el = el.parentElement;
    }
    return el ? (blockIndexOf.get(el) ?? 0) : 0;
  };

  const chapters: EpubChapter[] = [];
  const blockMap: number[][] = [];
  let items: ChapterItem[] = [];
  let map: number[] = [];
  let title: string | null = null;
  let lastBreakBlock = -1;

  const flush = () => {
    // A chapter with no items and no title never existed — a document
    // opening directly on a heading would otherwise get an empty leading
    // chapter before it.
    if (items.length === 0 && title === null) return;
    const order = chapters.length;
    chapters.push({
      id: `docx-ch-${order}`,
      href: `docx-ch-${order}`,
      // A chapter with no heading still needs a name: the TOC row, the top
      // bar and the chapter scrubber's screen-reader label all render this
      // string raw, so "" leaves them blank rather than falling back.
      title: title || chapterFallback(order + 1),
      paragraphs: items,
      order,
    });
    blockMap.push(map);
    items = [];
    map = [];
  };

  for (const located of collectInstructions(body)) {
    const blockIdx = topLevelIndex(located.node);

    // A break heading closes the previous chapter and opens the next. The
    // heading itself leads the new chapter, exactly as it reads on the page.
    // Guarded on the block CHANGING, so a table holding both a heading and
    // its following paragraphs breaks once, not once per item.
    if (blockIdx !== lastBreakBlock) {
      const breakTitle = breakTitleOf(blocks[blockIdx]);
      if (breakTitle !== undefined) {
        flush();
        title = breakTitle;
        lastBreakBlock = blockIdx;
      }
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
      title: chapterFallback(1),
      paragraphs: [],
      order: 0,
    });
    blockMap.push([]);
  }

  return { chapters, blockMap };
}

function toItem(inst: ChapterInstruction): ChapterItem {
  if (inst.kind === "text") {
    return inst.level
      ? { text: inst.text, level: inst.level }
      : { text: inst.text };
  }
  // DOCX images already sit at `images/img-NNN.ext` under books/<id>/ —
  // the same shape EPUB extraction produces — so the href passes straight
  // through and chapterImageSrcFor resolves it unchanged.
  return inst.alt ? { src: inst.src, alt: inst.alt } : { src: inst.src };
}
