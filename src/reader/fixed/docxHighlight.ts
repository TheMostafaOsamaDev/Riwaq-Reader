// DOM-coupled helpers for DOCX highlighting: resolve a browser text selection
// to a stable {blockId, charStart, charEnd} anchor, and inject <mark> spans back
// into a rendered block. Char offsets count concatenated text-node content
// (textContent order) so capture and render-back agree.

import { hlBg, type HighlightColor, type ThemeKey } from "../../styles/tokens";

/** Nearest ancestor element carrying a `data-block-id` (the DOCX block). */
function docxBlockOf(node: Node | null): HTMLElement | null {
  let el: Element | null =
    node && node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : (node?.parentElement ?? null);
  while (el) {
    if (el instanceof HTMLElement && el.hasAttribute("data-block-id")) return el;
    el = el.parentElement;
  }
  return null;
}

/** Char offset of (node, offset) within `block`, counting text-node content. */
function charOffsetInBlock(block: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEnd(node, offset);
  return range.toString().length;
}

export interface DocxSelectionAnchor {
  blockId: string;
  charStart: number;
  charEnd: number;
  text: string;
  /** Viewport-coordinate rect of the selection, for popover placement. */
  rect: DOMRect;
}

/** Resolve the current window selection to a single-block DOCX anchor, or null
 *  if there's no usable selection (collapsed, outside `root`, or spanning more
 *  than one block — multi-block is deferred to a later phase). */
export function resolveDocxSelection(root: HTMLElement): DocxSelectionAnchor | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }
  const block = docxBlockOf(range.startContainer);
  if (!block || block !== docxBlockOf(range.endContainer)) return null;
  const blockId = block.getAttribute("data-block-id");
  if (!blockId) return null;
  const a = charOffsetInBlock(block, range.startContainer, range.startOffset);
  const b = charOffsetInBlock(block, range.endContainer, range.endOffset);
  const charStart = Math.min(a, b);
  const charEnd = Math.max(a, b);
  if (charEnd <= charStart) return null;
  return { blockId, charStart, charEnd, text, rect: range.getBoundingClientRect() };
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
