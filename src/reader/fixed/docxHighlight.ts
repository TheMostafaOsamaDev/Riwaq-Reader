// DOM-coupled helpers for DOCX highlighting: char offsets into a block (how a
// selection is anchored — see fixedSelection.ts), and inject <mark> spans back
// into a rendered block. Char offsets count concatenated text-node content
// (textContent order) so capture and render-back agree.

import { hlBg, type HighlightColor, type ThemeKey } from "../../styles/tokens";

/** Char offset of (node, offset) within `block`, counting text-node content. */
export function charOffsetInBlock(
  block: HTMLElement,
  node: Node,
  offset: number,
): number {
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEnd(node, offset);
  return range.toString().length;
}

export interface BlockMark {
  id: string;
  charStart: number;
  charEnd: number;
  color: HighlightColor;
}

/** Inject `<mark>` spans for each range into a rendered block (mutates it).
 *  Applied in descending start order so wrapping earlier text doesn't shift the
 *  offsets of ranges not yet processed. */
export function applyHighlightsToBlock(
  block: HTMLElement,
  marks: BlockMark[],
  themeKey: ThemeKey,
): void {
  const sorted = [...marks].sort((a, b) => b.charStart - a.charStart);
  for (const m of sorted) wrapRange(block, m, themeKey);
}

function wrapRange(block: HTMLElement, m: BlockMark, themeKey: ThemeKey): void {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let offset = 0;
  const ops: { node: Text; s: number; e: number }[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    const len = t.nodeValue?.length ?? 0;
    const s = Math.max(m.charStart, offset);
    const e = Math.min(m.charEnd, offset + len);
    if (e > s) ops.push({ node: t, s: s - offset, e: e - offset });
    offset += len;
    if (offset >= m.charEnd) break;
  }
  for (const op of ops) {
    const r = document.createRange();
    r.setStart(op.node, op.s);
    r.setEnd(op.node, op.e);
    const mark = document.createElement("mark");
    mark.setAttribute("data-h-id", m.id);
    mark.style.background = hlBg(m.color, themeKey);
    mark.style.color = "inherit";
    mark.style.borderRadius = "2px";
    // surroundContents throws if the range partially selects a non-Text node;
    // our ops are always within a single Text node, so this is safe.
    try {
      r.surroundContents(mark);
    } catch {
      /* skip a range we can't cleanly wrap */
    }
  }
}
