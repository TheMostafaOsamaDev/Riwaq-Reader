/**
 * Helpers for resolving a window Selection inside the reader to a
 * paragraph-anchored highlight range we can persist and re-render.
 *
 * The book body renders each paragraph as `<p data-p-index="N">…</p>`,
 * with optional `<mark>` spans inside for already-persisted highlights.
 * A selection may span multiple paragraphs — the anchor stores one
 * `SelectionSegment` per paragraph the range touches.
 */

export interface SelectionSegment {
  paragraphIndex: number;
  charStart: number;
  charEnd: number;
  text: string;
}

export interface SelectionAnchor {
  /** One segment per paragraph touched by the range, in document
   *  order. At least one entry. */
  segments: SelectionSegment[];
  /** Overall bounding rect across all segments — used to anchor the
   *  SelectionPopover. */
  rect: DOMRect;
}

/** Walk up to the nearest `<p data-p-index>` ancestor, or null if the
 *  node isn't inside a rendered paragraph (e.g. selection in chrome). */
function findParagraph(node: Node | null): HTMLElement | null {
  let n: Node | null = node;
  while (n) {
    if (n instanceof HTMLElement && n.dataset.pIndex !== undefined) return n;
    n = n.parentNode;
  }
  return null;
}

/** Character offset of `(node, offset)` within `paragraph` — sums up the
 *  text content of every preceding text node in document order. Works
 *  whether the cursor lands directly in the `<p>`'s text or inside a
 *  nested `<mark>` span. */
function charOffsetWithin(
  paragraph: HTMLElement,
  node: Node,
  offset: number,
): number {
  if (node.nodeType !== Node.TEXT_NODE) {
    let pos = 0;
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let t: Node | null;
    while ((t = walker.nextNode())) {
      const cmp = node.compareDocumentPosition(t);
      if (
        cmp & Node.DOCUMENT_POSITION_CONTAINED_BY ||
        cmp & Node.DOCUMENT_POSITION_PRECEDING
      ) {
        const boundary = node.childNodes[offset] ?? null;
        if (
          boundary &&
          boundary.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING
        ) {
          pos += t.textContent?.length ?? 0;
        } else if (!boundary) {
          pos += t.textContent?.length ?? 0;
        }
      }
    }
    return pos;
  }
  let pos = 0;
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  let t: Node | null;
  while ((t = walker.nextNode())) {
    if (t === node) return pos + offset;
    pos += t.textContent?.length ?? 0;
  }
  return pos;
}

/** Total text length of a paragraph — sums all descendant text nodes. */
function paragraphTextLength(paragraph: HTMLElement): number {
  let len = 0;
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  let t: Node | null;
  while ((t = walker.nextNode())) {
    len += t.textContent?.length ?? 0;
  }
  return len;
}

/** Walk forward from `paragraph` to the next sibling `<p data-p-index>`,
 *  skipping non-paragraph elements (e.g. figures). Returns null if
 *  there is none in this BookBody. */
function nextParagraph(paragraph: HTMLElement): HTMLElement | null {
  let el: Element | null = paragraph.nextElementSibling;
  while (el) {
    if (
      el instanceof HTMLElement &&
      el.dataset.pIndex !== undefined &&
      el.tagName === "P"
    ) {
      return el;
    }
    el = el.nextElementSibling;
  }
  return null;
}

/**
 * Resolve an arbitrary Range to a paragraph-anchored anchor. The range
 * may span multiple `<p>` elements within the same BookBody — each
 * paragraph becomes one segment. Returns null if either endpoint is
 * outside any rendered paragraph.
 */
export function anchorFromRange(range: Range): SelectionAnchor | null {
  if (range.collapsed) return null;
  const startP = findParagraph(range.startContainer);
  const endP = findParagraph(range.endContainer);
  if (!startP || !endP) return null;

  const segments: SelectionSegment[] = [];
  let current: HTMLElement | null = startP;
  while (current) {
    const pIndex = Number(current.dataset.pIndex);
    if (Number.isFinite(pIndex)) {
      const isStart = current === startP;
      const isEnd = current === endP;
      const charStart = isStart
        ? charOffsetWithin(current, range.startContainer, range.startOffset)
        : 0;
      const charEnd = isEnd
        ? charOffsetWithin(current, range.endContainer, range.endOffset)
        : paragraphTextLength(current);
      if (charEnd > charStart) {
        const text = (current.textContent ?? "").slice(charStart, charEnd);
        segments.push({
          paragraphIndex: pIndex,
          charStart,
          charEnd,
          text,
        });
      }
    }
    if (current === endP) break;
    current = nextParagraph(current);
  }

  if (segments.length === 0) return null;
  const rect = range.getBoundingClientRect();
  return { segments, rect };
}

/**
 * Resolve the current window selection to a paragraph-anchored anchor.
 * Used by the desktop reader (which keeps native selection alive).
 */
export function resolveSelectionAnchor(): SelectionAnchor | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  return anchorFromRange(sel.getRangeAt(0));
}
