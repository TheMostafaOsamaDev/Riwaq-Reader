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
  type ChapterInstruction,
  collectInstructions,
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

/** Title for a chapter that has no heading of its own. Empty, not a literal:
 *  a DOCX preface genuinely has no name in the file, and the reader's own
 *  display fallback localizes a blank chapter title. */
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
