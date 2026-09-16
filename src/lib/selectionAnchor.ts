/**
 * Helpers for resolving a window Selection inside the reader to a
 * paragraph-anchored highlight range we can persist and re-render.
 *
 * The book body renders each paragraph as `<p data-p-index="N">…</p>`,
 * with optional `<mark>` spans inside for already-persisted highlights.
 * A selection may span multiple paragraphs — the anchor stores one
 * `SelectionSegment` per paragraph the range touches.
 */

import type { AnchorBox } from "./popoverPlacement";

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

/** Inverse of `charOffsetWithin`: the (textNode, offset) pair that sits
 *  `charOffset` characters into `paragraph`. Offsets past the end clamp
 *  to the last text node, so a stale anchor degrades to a shorter range
 *  instead of throwing IndexSizeError at the reader. */
function endpointAt(
  paragraph: HTMLElement,
  charOffset: number,
): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let last: { node: Node; offset: number } | null = null;
  let t: Node | null;
  while ((t = walker.nextNode())) {
    const len = t.textContent?.length ?? 0;
    if (charOffset <= pos + len) return { node: t, offset: charOffset - pos };
    pos += len;
    last = { node: t, offset: len };
  }
  return last;
}

/** The paragraph element for a stored index, within the mounted book
 *  body. Null once that chapter/page is no longer rendered. */
function paragraphElement(index: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-book-body] [data-p-index="${index}"]`,
  );
}

/**
 * Rebuild a live Range from a previously-resolved anchor's segments.
 *
 * This is how a popover keeps up with its text: the stored
 * (paragraph, charStart, charEnd) description is stable, so re-measuring
 * through it survives both scrolling and the paragraph being re-rendered
 * with `<mark>` children. Re-reading `window.getSelection()` instead
 * would not — focusing the note editor clobbers the document selection.
 *
 * Returns null when the paragraphs are no longer in the DOM.
 */
export function rangeForSegments(segments: SelectionSegment[]): Range | null {
  if (segments.length === 0) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const startP = paragraphElement(first.paragraphIndex);
  const endP = paragraphElement(last.paragraphIndex);
  if (!startP || !endP) return null;

  const start = endpointAt(startP, first.charStart);
  const end = endpointAt(endP, last.charEnd);
  if (!start || !end) return null;

  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  return range;
}

/** Live viewport rect of a stored anchor, for popovers that follow
 *  their text as the reading column scrolls. Null when the text is no
 *  longer rendered. */
export function rectForSegments(
  segments: SelectionSegment[],
): AnchorBox | null {
  const range = rangeForSegments(segments);
  if (!range) return null;
  const dir = dirOf(range.commonAncestorContainer);
  const lines = boxFromRects(Array.from(range.getClientRects()), dir);
  if (lines) return lines;
  // No line boxes: either the range is not laid out at all, or we are
  // somewhere without layout. A zero rect means the former — its page is
  // `display:none` in the paginated view — and there is nothing to point
  // at. Anything else is still a usable anchor.
  const whole = range.getBoundingClientRect();
  if (whole.width === 0 && whole.height === 0) return null;
  return boxFromRect(whole, dir);
}

/**
 * One already-measured rect as an anchor.
 *
 * For the fixed-layout readers, where a page is a bitmap or a laid-out
 * DOCX page and the viewer hands back a single rect for the whole
 * selection. Treated as one line box, so the toolbar still attaches to
 * the selection's start edge rather than the middle of the block.
 */
export function boxFromRect(
  rect: { top: number; bottom: number; left: number; right: number },
  dir: "rtl" | "ltr",
): AnchorBox {
  const edges = { left: rect.left, right: rect.right };
  return {
    top: rect.top,
    bottom: rect.bottom,
    firstLine: edges,
    lastLine: edges,
    dir,
  };
}

/**
 * The selection as it is RIGHT NOW, rather than as it was when the
 * toolbar opened.
 *
 * The toolbar is created from a snapshot taken on `pointerup`, and that
 * snapshot is what keeps it alive once the reader clicks a swatch and
 * the browser throws the selection away. But a snapshot cannot see the
 * selection still being dragged, and an early pointerup — the first of
 * a double-click, or a click that precedes a drag — captures a single
 * word. Measured on a real chapter: the toolbar opened against an
 * anchor 56px wide and only reached the real paragraph, 1212px, a
 * second later, which is the jump the reader saw.
 *
 * So the live selection wins while there is one, and the snapshot is
 * the fallback. Anchored to the selection's START, which is where the
 * drag began, the toolbar then holds still for the whole drag instead
 * of chasing the end of it.
 *
 * Null when there is no usable selection, or when it is outside the
 * reading column — a selection in the sidebar or a dialog must not drag
 * the reader's toolbar across the screen.
 */
export function liveSelectionBox(): AnchorBox | null {
  if (typeof window === "undefined") return null;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const host =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (!host?.closest("[data-book-body]")) return null;
  return boxFromRects(
    Array.from(range.getClientRects()),
    dirOf(range.commonAncestorContainer),
  );
}

/** Reading direction of the app itself, for anchors that carry no
 *  element of their own — a fixed page's selection rect comes from the
 *  viewer as plain geometry. */
export function docDir(): "rtl" | "ltr" {
  if (typeof document === "undefined") return "ltr";
  return document.documentElement.dir === "rtl" ? "rtl" : "ltr";
}

/** Reading direction of the text itself.
 *
 *  Read off the element rather than the document, because a chapter can
 *  hold a quote in the other script and the toolbar should attach to the
 *  end of the line the reader's eye actually starts from. */
function dirOf(node: Node): "rtl" | "ltr" {
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  if (!el) return "ltr";
  return getComputedStyle(el).direction === "rtl" ? "rtl" : "ltr";
}

/**
 * Collapse a run of line boxes into the shape placement needs.
 *
 * `getClientRects()` returns one rect per line, in document order, and
 * a multi-paragraph selection contributes several runs — so first and
 * last are taken by position, not by array index, which stays correct
 * if a browser ever reorders them.
 *
 * Empty and zero-area rects are dropped first: a range that resolved
 * but is not laid out (its page is `display:none` in the paginated
 * view) reports one, and it would otherwise become a line box at the
 * origin and drag the toolbar to the corner.
 */
function boxFromRects(rects: DOMRect[], dir: "rtl" | "ltr"): AnchorBox | null {
  const lines = rects.filter((r) => r.width > 0 || r.height > 0);
  if (lines.length === 0) return null;

  let first = lines[0];
  let last = lines[0];
  for (const r of lines) {
    if (r.top < first.top) first = r;
    if (r.bottom > last.bottom) last = r;
  }

  return {
    top: first.top,
    bottom: last.bottom,
    firstLine: { left: first.left, right: first.right },
    lastLine: { left: last.left, right: last.right },
    dir,
  };
}

/** Live viewport rect of a persisted highlight's `<mark>`. Multi-segment
 *  highlights render one mark per paragraph; the first is what the
 *  action popover points at. */
export function rectForMark(highlightId: string): AnchorBox | null {
  const el = document.querySelector<HTMLElement>(
    `[data-h-id="${highlightId}"]`,
  );
  if (!el) return null;
  const dir = dirOf(el);
  // The mark's own line boxes, not its bounding rect — a highlight that
  // wraps has the same column-wide bounding rect a selection does. The
  // bounding rect is a fallback rather than a null, because the mark IS
  // rendered and the popover has something to attach to; a mark on a
  // hidden page reports a zero box, which placement treats as
  // off-region and fades.
  return (
    boxFromRects(Array.from(el.getClientRects()), dir) ??
    boxFromRect(el.getBoundingClientRect(), dir)
  );
}
