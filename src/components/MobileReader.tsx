import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "./Icon";
import { BookBody } from "./BookBody";
import { MobileSheet } from "./MobileSheet";
import { SelectionPopover } from "./SelectionPopover";
import { SelectionOverlay } from "./SelectionOverlay";
import { SelectionHandle } from "./SelectionHandle";
import { HighlightActionPopover } from "./HighlightActionPopover";
import type { EpubBook } from "../epub/types";
import type { BookState, Highlight } from "../store/library";
import { EASE, MOTION, useReducedMotion } from "../styles/motion";
import {
  FONT_STACKS,
  isRtlLanguage,
  type HighlightColor,
  type Theme,
  type ThemeKey,
} from "../styles/tokens";
import {
  anchorFromRange,
  type SelectionAnchor,
} from "../lib/selectionAnchor";
import { HighlightsPanel } from "../panels/HighlightsPanel";
import { ProgressOverlay } from "../panels/ProgressOverlay";
import { SettingsPanel } from "../panels/SettingsPanel";
import { TOCPanel } from "../panels/TOCPanel";
import type { ActivePanel, Tweaks } from "../types/reader";

// ---- Custom selection helpers --------------------------------------
// We replace native text selection on mobile with a hand-rolled
// pointer gesture. The user long-presses a word, drags to extend
// within the same paragraph, and releases. The selection lives only
// in React state — never on window.getSelection() — so the OS
// selection toolbar has no anchor and never appears.

const LONG_PRESS_MS = 400;
const LONG_PRESS_MOVE_TOLERANCE = 8; // px before pointer cancels long-press
const WORD_BOUNDARY_REGEX = /[\s\p{P}\p{S}]/u; // whitespace, punctuation, symbols

interface RangeEndpoint {
  node: Text;
  offset: number;
}

/** Find the text-node + offset at a viewport (clientX, clientY) point. */
function caretFromPoint(x: number, y: number): RangeEndpoint | null {
  // Prefer the standard caretPositionFromPoint when available, falling
  // back to caretRangeFromPoint (Chromium, Android WebView).
  const fromPos =
    (document as unknown as {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    }).caretPositionFromPoint?.(x, y) ?? null;
  if (fromPos && fromPos.offsetNode.nodeType === Node.TEXT_NODE) {
    return { node: fromPos.offsetNode as Text, offset: fromPos.offset };
  }
  const fromRange = document.caretRangeFromPoint?.(x, y) ?? null;
  if (
    fromRange &&
    fromRange.startContainer.nodeType === Node.TEXT_NODE
  ) {
    return {
      node: fromRange.startContainer as Text,
      offset: fromRange.startOffset,
    };
  }
  return null;
}

/** Find the paragraph element (<p data-p-index>) ancestor of a node. */
function paragraphOf(node: Node): HTMLElement | null {
  let n: Node | null = node;
  while (n) {
    if (n instanceof HTMLElement && n.dataset.pIndex !== undefined) return n;
    n = n.parentNode;
  }
  return null;
}

/** Walk left/right within a text node to expand to the surrounding
 *  word's start and end character offsets. */
function wordRangeAt(node: Text, offset: number): [number, number] {
  const text = node.data;
  let start = offset;
  let end = offset;
  while (start > 0 && !WORD_BOUNDARY_REGEX.test(text[start - 1]!)) start--;
  while (end < text.length && !WORD_BOUNDARY_REGEX.test(text[end]!)) end++;
  if (start === end) return [offset, Math.min(offset + 1, text.length)];
  return [start, end];
}

/** Clamp a candidate endpoint so it stays inside the same paragraph
 *  as the anchor endpoint. Returns the closest in-paragraph endpoint. */
function clampToParagraph(
  paragraph: HTMLElement,
  candidate: RangeEndpoint,
): RangeEndpoint {
  if (paragraphOf(candidate.node) === paragraph) return candidate;
  // The candidate is outside the paragraph — return the last text
  // node within the paragraph (if candidate is past) or the first
  // (if candidate is before). Use document position comparison.
  const cmp = paragraph.compareDocumentPosition(candidate.node);
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  let firstText: Text | null = null;
  let lastText: Text | null = null;
  let t: Node | null;
  while ((t = walker.nextNode())) {
    if (!firstText) firstText = t as Text;
    lastText = t as Text;
  }
  if (cmp & Node.DOCUMENT_POSITION_PRECEDING && firstText) {
    return { node: firstText, offset: 0 };
  }
  if (cmp & Node.DOCUMENT_POSITION_FOLLOWING && lastText) {
    return { node: lastText, offset: lastText.data.length };
  }
  // Fallback: clamp to start of paragraph
  if (firstText) return { node: firstText, offset: 0 };
  return candidate;
}

/** True if endpoint `a` lies strictly before endpoint `b` in document
 *  order. Same node → compare offsets; across nodes → use the DOM's
 *  compareDocumentPosition. */
function comesBefore(a: RangeEndpoint, b: RangeEndpoint): boolean {
  if (a.node === b.node) return a.offset < b.offset;
  return !!(
    a.node.compareDocumentPosition(b.node) &
    Node.DOCUMENT_POSITION_FOLLOWING
  );
}

/** Build a Range from two endpoints, ordered correctly (start before end). */
function buildRange(a: RangeEndpoint, b: RangeEndpoint): Range {
  const range = document.createRange();
  const cmp =
    a.node === b.node
      ? a.offset - b.offset
      : a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1;
  if (cmp < 0) {
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
  } else {
    range.setStart(b.node, b.offset);
    range.setEnd(a.node, a.offset);
  }
  return range;
}
function computeHandleRects(range: Range): { start: DOMRect; end: DOMRect } {
  const start = document.createRange();
  start.setStart(range.startContainer, range.startOffset);
  start.setEnd(range.startContainer, range.startOffset);
  const end = document.createRange();
  end.setStart(range.endContainer, range.endOffset);
  end.setEnd(range.endContainer, range.endOffset);
  // Collapsed ranges yield 0-width rects with valid top/left/height.
  const sr = start.getBoundingClientRect();
  const er = end.getBoundingClientRect();
  // Copy so subsequent range mutations don't invalidate the saved values.
  return {
    start: new DOMRect(sr.x, sr.y, sr.width, sr.height),
    end: new DOMRect(er.x, er.y, er.width, er.height),
  };
}

function orderedEndpoints(range: Range): {
  start: RangeEndpoint;
  end: RangeEndpoint;
} {
  // Range exposes startContainer/startOffset/endContainer/endOffset
  // already in document order — no swapping needed.
  return {
    start: {
      node: range.startContainer as Text,
      offset: range.startOffset,
    },
    end: {
      node: range.endContainer as Text,
      offset: range.endOffset,
    },
  };
}
// ---- end custom selection helpers ----------------------------------

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  t: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  book: EpubBook;
  state: BookState;
  currentChapter: number;
  resumeParagraph: number;
  onChapterChange: (order: number) => void;
  onParagraphChange: (idx: number) => void;
  onCreateHighlight: (input: {
    chapter: number;
    paragraphIndex: number;
    charStart: number;
    charEnd: number;
    text: string;
    color: HighlightColor;
    note?: string;
  }) => void;
  onDeleteHighlight: (id: string) => void;
  onUpdateHighlightNote: (id: string, note: string) => void;
  onJumpToHighlight: (h: Highlight) => void;
  onBack: () => void;
}

function mobileTab(theme: Theme): CSSProperties {
  return {
    width: 44,
    height: 44,
    borderRadius: 10,
    border: "none",
    background: "transparent",
    color: theme.chromeInk,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

export function MobileReader({
  theme,
  themeKey,
  t,
  setTweak,
  book,
  state,
  currentChapter,
  resumeParagraph,
  onChapterChange,
  onParagraphChange,
  onCreateHighlight,
  onDeleteHighlight,
  onUpdateHighlightNote,
  onJumpToHighlight,
  onBack,
}: Props) {
  const [showChrome, setShowChrome] = useState(true);
  const [showProgress, setShowProgress] = useState(true);
  const reduced = useReducedMotion();
  // Top/bottom chrome bars stay mounted and animate via transform +
  // opacity when `showChrome` toggles, so a tap-to-read fade is
  // smooth instead of a hard cut. Pointer-events are dropped while
  // hidden so taps fall through to the reader.
  const chromeHidden = !showChrome;
  const chromeTransition = reduced
    ? "none"
    : `transform ${MOTION.med}ms ${EASE.enter}, opacity ${MOTION.med}ms ${EASE.enter}`;
  const [sheet, setSheet] = useState<ActivePanel>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startEndpointRef = useRef<RangeEndpoint | null>(null);
  const endEndpointRef = useRef<RangeEndpoint | null>(null);
  const paragraphRef = useRef<HTMLElement | null>(null);
  const resumeRef = useRef(resumeParagraph);
  resumeRef.current = resumeParagraph;
  const onParagraphChangeRef = useRef(onParagraphChange);
  onParagraphChangeRef.current = onParagraphChange;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Resuming at paragraph 0 means "start of chapter" — snap to the very
    // top so the chapter heading BookBody renders above paragraph 0 stays
    // visible. Using offsetTop of p0 would scroll the heading off-screen.
    if (resumeRef.current === 0) {
      el.scrollTop = 0;
      return;
    }
    const target = el.querySelector<HTMLElement>(
      `[data-p-index="${resumeRef.current}"]`,
    );
    el.scrollTop = target ? target.offsetTop : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter, book.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let queued = false;
    const handler = () => {
      if (queued) return;
      queued = true;
      window.setTimeout(() => {
        queued = false;
        const ps = el.querySelectorAll<HTMLElement>("[data-p-index]");
        if (ps.length === 0) return;
        const containerTop = el.getBoundingClientRect().top;
        let best = 0;
        for (const p of ps) {
          const offset = p.getBoundingClientRect().top - containerTop;
          if (offset > 8) break;
          best = Number(p.dataset.pIndex);
        }
        onParagraphChangeRef.current(best);
      }, 250);
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  const chapter = book.chapters[currentChapter] ?? book.chapters[0];
  const chapterCount = book.chapters.length;

  // Drag-scrub the progress bar to jump chapters. While dragging, the
  // thumb and fill follow the finger but the reader stays on
  // `currentChapter` — only release commits the chapter change. This
  // avoids chapter loads thrashing under the finger and lets the user
  // preview the target via the floating chip without overshooting.
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [draggingTarget, setDraggingTarget] = useState<number | null>(null);
  const chapterFromClientX = (clientX: number): number | null => {
    const el = trackRef.current;
    if (!el || chapterCount === 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return null;
    const ratio = Math.min(
      1,
      Math.max(0, (clientX - rect.left) / rect.width),
    );
    return Math.min(chapterCount - 1, Math.floor(ratio * chapterCount));
  };
  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (chapterCount <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDraggingTarget(chapterFromClientX(e.clientX) ?? currentChapter);
  };
  const onTrackPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const next = chapterFromClientX(e.clientX);
    if (next !== null) setDraggingTarget(next);
  };
  const onTrackPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDraggingTarget((target) => {
      if (target !== null && target !== currentChapter) {
        onChapterChange(target);
      }
      return null;
    });
  };

  const displayChapter = draggingTarget ?? currentChapter;
  const pct = chapterCount > 0
    ? Math.round(((displayChapter + 1) / chapterCount) * 100)
    : 0;
  const ticks =
    chapterCount > 1
      ? Array.from({ length: chapterCount - 1 }, (_, i) => (i + 1) / chapterCount)
      : [];

  const prevChapter = () => {
    if (currentChapter > 0) onChapterChange(currentChapter - 1);
  };
  const nextChapter = () => {
    if (currentChapter < chapterCount - 1) onChapterChange(currentChapter + 1);
  };

  // Two mutually-exclusive popovers:
  //   - selAnchor: shown when the user just finished a selection
  //   - activeHl: shown when the user tapped an existing highlight
  // Showing one always clears the other.
  const [selAnchor, setSelAnchor] = useState<SelectionAnchor | null>(null);
  const [selRects, setSelRects] = useState<DOMRect[]>([]);
  const [handleRects, setHandleRects] = useState<{
    start: DOMRect;
    end: DOMRect;
  } | null>(null);
  const [activeHl, setActiveHl] = useState<{
    highlight: Highlight;
    rect: DOMRect;
  } | null>(null);
  const draggingHandleRef = useRef<"start" | "end" | null>(null);
  const draggingPointerIdRef = useRef<number | null>(null);
  // True for one click after a custom-selection gesture ends. The
  // browser synthesizes a click on touchup/pointerup; without this
  // guard, the document-level click listener would treat that click
  // as an outside-tap and dismiss the just-set selection.
  const ignoreNextClickRef = useRef(false);

  // Custom long-press + drag selection on mobile. Replaces native
  // selection so the OS toolbar (which we can't suppress on Samsung
  // One UI) never has a live window selection to anchor to.
  //
  // BookBody uses touch-action: pan-y so the browser handles vertical
  // scroll natively with momentum. We only call preventDefault on
  // pointermove during active selection drag — that suppresses scroll
  // for the in-flight selection without affecting normal swipes.
  useEffect(() => {
    const bodyEl = document.querySelector<HTMLElement>("[data-book-body]");
    if (!bodyEl) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let longPressTimer: number | null = null;
    let isSelecting = false;
    // Saved word boundaries from the long-press. Form a "minimum
    // range" — pointer movement inside this range leaves the
    // selection alone; movement past either side extends in that
    // direction.
    let wordStart: RangeEndpoint | null = null;
    let wordEnd: RangeEndpoint | null = null;

    const updateFromRange = (range: Range) => {
      const anchor = anchorFromRange(range);
      if (anchor) {
        setSelAnchor(anchor);
        setActiveHl(null);
        setSelRects(
          Array.from(range.getClientRects()).map(
            (r) => new DOMRect(r.x, r.y, r.width, r.height),
          ),
        );
        setHandleRects(computeHandleRects(range));
      }
    };

    const startSelection = (cx: number, cy: number) => {
      const ep = caretFromPoint(cx, cy);
      if (!ep) return false;
      const p = paragraphOf(ep.node);
      if (!p) return false;
      const [ws, we] = wordRangeAt(ep.node, ep.offset);
      const range = document.createRange();
      range.setStart(ep.node, ws);
      range.setEnd(ep.node, we);
      startEndpointRef.current = { node: ep.node, offset: ws };
      endEndpointRef.current = { node: ep.node, offset: we };
      wordStart = { node: ep.node, offset: ws };
      wordEnd = { node: ep.node, offset: we };
      paragraphRef.current = p;
      updateFromRange(range);
      return true;
    };

    const cancelLongPressTimer = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (pointerId !== null) return;
      if ((e.target as HTMLElement | null)?.closest("[data-h-id]")) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      isSelecting = false;
      cancelLongPressTimer();
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        if (pointerId === null) return;
        try {
          bodyEl.setPointerCapture(pointerId);
        } catch {
          return;
        }
        if (startSelection(startX, startY)) {
          isSelecting = true;
        }
      }, LONG_PRESS_MS);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!isSelecting) {
        // Before long-press fires, we let the browser scroll natively.
        // If movement exceeds the tap tolerance, cancel the long-press
        // timer — the user's gesture is a scroll, not a hold.
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) {
          cancelLongPressTimer();
          pointerId = null;
        }
        return;
      }
      // Selecting — extend the range and preventDefault to keep the
      // browser from also scrolling. The long-pressed word forms a
      // minimum: while the finger sits inside it (or just jitters),
      // we leave the selection alone. Movement past either side of
      // the word extends in that direction.
      const para = paragraphRef.current;
      if (!para || !wordStart || !wordEnd) return;
      const currentEp = caretFromPoint(e.clientX, e.clientY);
      if (!currentEp) return;
      const clamped = clampToParagraph(para, currentEp);
      let newStart: RangeEndpoint;
      let newEnd: RangeEndpoint;
      if (comesBefore(clamped, wordStart)) {
        // Finger crossed before the word's start — extend backward,
        // keep the word's end as the far boundary.
        newStart = clamped;
        newEnd = wordEnd;
      } else if (comesBefore(wordEnd, clamped)) {
        // Finger crossed past the word's end — extend forward.
        newStart = wordStart;
        newEnd = clamped;
      } else {
        // Inside the word — no change.
        newStart = wordStart;
        newEnd = wordEnd;
      }
      startEndpointRef.current = newStart;
      endEndpointRef.current = newEnd;
      const range = buildRange(newStart, newEnd);
      if (!range.collapsed) updateFromRange(range);
      e.preventDefault();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      cancelLongPressTimer();
      if (isSelecting) {
        try {
          bodyEl.releasePointerCapture(e.pointerId);
        } catch {
          // already released
        }
        // The browser will synthesize a click event right after this
        // pointerup. Tell the document click listener to swallow it
        // so it doesn't dismiss the selection we just settled.
        ignoreNextClickRef.current = true;
      }
      pointerId = null;
      isSelecting = false;
      wordStart = null;
      wordEnd = null;
    };

    bodyEl.addEventListener("pointerdown", onPointerDown);
    bodyEl.addEventListener("pointermove", onPointerMove);
    bodyEl.addEventListener("pointerup", onPointerUp);
    bodyEl.addEventListener("pointercancel", onPointerUp);
    return () => {
      cancelLongPressTimer();
      bodyEl.removeEventListener("pointerdown", onPointerDown);
      bodyEl.removeEventListener("pointermove", onPointerMove);
      bodyEl.removeEventListener("pointerup", onPointerUp);
      bodyEl.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  // Handle-drag effect: tracks pointer movement after the user grabs
  // one of the start/end handles and extends the selection range.
  useEffect(() => {
    const para = paragraphRef.current;
    if (!handleRects || !para) return;

    const onMove = (e: PointerEvent) => {
      if (
        draggingHandleRef.current === null ||
        e.pointerId !== draggingPointerIdRef.current
      ) {
        return;
      }
      const start = startEndpointRef.current;
      const end = endEndpointRef.current;
      const paragraph = paragraphRef.current;
      if (!start || !end || !paragraph) return;

      const currentEp = caretFromPoint(e.clientX, e.clientY);
      if (!currentEp) return;
      const clamped = clampToParagraph(paragraph, currentEp);

      const nextStart =
        draggingHandleRef.current === "start" ? clamped : start;
      const nextEnd = draggingHandleRef.current === "end" ? clamped : end;

      // If the user crossed the other handle, swap so start stays before end.
      const range = buildRange(nextStart, nextEnd);
      if (!range.collapsed) {
        // Re-derive ordered endpoints from the built range so future
        // drags continue from the visually-correct side.
        const ordered = orderedEndpoints(range);
        startEndpointRef.current = ordered.start;
        endEndpointRef.current = ordered.end;
        const anchor = anchorFromRange(range);
        if (anchor) {
          setSelAnchor(anchor);
          setSelRects(
            Array.from(range.getClientRects()).map(
              (r) => new DOMRect(r.x, r.y, r.width, r.height),
            ),
          );
          setHandleRects(computeHandleRects(range));
        }
      }
      e.preventDefault();
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== draggingPointerIdRef.current) return;
      if (draggingHandleRef.current !== null) {
        ignoreNextClickRef.current = true;
      }
      draggingHandleRef.current = null;
      draggingPointerIdRef.current = null;
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [handleRects]);

  // All popover dismissal flows through clicks: tap an existing
  // highlight to open its action popover, tap outside everything to
  // dismiss. We deliberately don't use selectionchange — the
  // note-editor textarea fires it on every keystroke, which would
  // tear the popover down mid-typing.
  const highlightById = (id: string) =>
    state.highlights.find((h) => h.id === id);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ignoreNextClickRef.current) {
        // Synthetic click right after a custom-selection gesture
        // finished. Skip dismissal exactly once.
        ignoreNextClickRef.current = false;
        return;
      }
      // composedPath snapshots the ancestor chain at dispatch time —
      // robust against post-dispatch DOM mutations (e.g. clicking the
      // pencil button swaps it for a textarea before this handler
      // runs, leaving target.closest() walking a detached subtree).
      const path = (e.composedPath?.() ?? []) as EventTarget[];
      const inPopover = path.some(
        (node) =>
          node instanceof HTMLElement &&
          node.dataset.popover === "highlight",
      );
      if (inPopover) return;

      // Used to bail out if the native selection was still live — our
      // custom selection model no longer uses the native selection at all,
      // so this guard is now meaningless and gets dropped.

      const markNode = path.find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.dataset.hId !== undefined,
      );
      if (markNode && markNode.dataset.hId) {
        const h = highlightById(markNode.dataset.hId);
        if (h) {
          setActiveHl({ highlight: h, rect: markNode.getBoundingClientRect() });
          setSelAnchor(null);
          return;
        }
      }
      setActiveHl(null);
      setSelAnchor(null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.highlights]);

  const dismissSelection = () => {
    setSelAnchor(null);
    setSelRects([]);
    setHandleRects(null);
    startEndpointRef.current = null;
    endEndpointRef.current = null;
    paragraphRef.current = null;
  };
  const createFromSelection = (color: HighlightColor, note?: string) => {
    if (!selAnchor) return;
    onCreateHighlight({
      chapter: currentChapter,
      paragraphIndex: selAnchor.paragraphIndex,
      charStart: selAnchor.charStart,
      charEnd: selAnchor.charEnd,
      text: selAnchor.text,
      color,
      note: note?.trim() || undefined,
    });
    dismissSelection();
  };

  return (
    <div
      // Mobile reader chrome stays LTR — RTL applies only to BookBody.
      dir="ltr"
      style={{
        width: "100%",
        height: "100%",
        background: theme.bg,
        color: theme.ink,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        fontFamily: FONT_STACKS.sans,
      }}
    >
      {/* Top chrome — always mounted so it can transform/fade rather
          than hard-cut. Hidden state slides up off-screen and disables
          pointer events so taps fall through to the reader. */}
      <div
        aria-hidden={chromeHidden}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          padding: "env(safe-area-inset-top, 12px) 14px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: `linear-gradient(180deg, ${theme.chrome} 70%, transparent)`,
          transform: chromeHidden ? "translateY(-100%)" : "translateY(0)",
          opacity: chromeHidden ? 0 : 1,
          transition: chromeTransition,
          pointerEvents: chromeHidden ? "none" : "auto",
          // Keep chrome out of text selection — without this, a long-
          // press 'Select all' grabs the chapter title and progress
          // text along with the body paragraphs, which then resolves
          // to a nonsense highlight range.
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
          <button
            onClick={onBack}
            style={{ ...mobileTab(theme), width: 36, height: 36 }}
            aria-label="Back to library"
          >
            <Icon name="arrowL" size={16} />
          </button>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1,
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontFamily: '"Fraunces", serif',
                fontSize: 13,
                fontStyle: "italic",
                fontWeight: 500,
                color: theme.ink,
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
              }}
            >
              {book.title}
            </div>
            <div style={{ fontSize: 10, color: theme.muted }}>
              Chapter {currentChapter + 1} / {chapterCount}
            </div>
          </div>
        </div>

      <div
        ref={scrollRef}
        onClick={(e) => {
          // Tapping a highlight goes through the document-level click
          // handler (it opens the action popover); toggle chrome to
          // match the existing behavior in that case.
          const target = e.target as HTMLElement | null;
          if (target?.closest("[data-h-id]")) {
            setShowChrome((s) => !s);
            return;
          }
          // Tap-zones off → simple chrome toggle (the legacy gesture).
          if (!t.mobileTapNav) {
            setShowChrome((s) => !s);
            return;
          }
          // Three vertical bands: left third pages back, right third
          // pages forward, center toggles the chrome. We page by ~one
          // viewport with a small overlap so the user keeps a line of
          // context across the jump.
          const el = e.currentTarget;
          const rect = el.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const edge = rect.width / 3;
          const stride = Math.max(120, rect.height - 80);
          if (x < edge) {
            el.scrollBy({ top: -stride, behavior: "smooth" });
          } else if (x > rect.width - edge) {
            el.scrollBy({ top: stride, behavior: "smooth" });
          } else {
            setShowChrome((s) => !s);
          }
        }}
        style={{
          flex: 1,
          overflow: "auto",
          // Padding stays constant whether chrome is shown or hidden —
          // the chrome bars are absolutely positioned and act as a
          // translucent overlay (iOS Books / Kindle style). Swapping
          // padding on toggle was reflowing the visible lines and
          // moving the user's reading position.
          padding: "44px 28px 44px",
          position: "relative",
        }}
        className="no-scrollbar"
      >
        <BookBody
          bookId={book.id}
          chapter={chapter}
          chapterCount={chapterCount}
          theme={theme}
          themeKey={themeKey}
          highlights={state.highlights}
          fontFamily={t.fontFamily}
          fontSize={t.fontSize}
          lineHeight={t.lineHeight}
          letterSpacing={t.letterSpacing}
          textAlign={t.textAlign}
          // Mobile ignores the desktop-only layout tweaks (reading mode,
          // page width) — the screen is narrow enough that paginated columns
          // or >360px page width would just overflow.
          rtl={isRtlLanguage(book.language)}
          widthPercent={t.contentWidth}
          selectable={false}
        />
      </div>

      {/* Bottom chrome — same always-mounted pattern as the top bar.
          Slides down off-screen when hidden and gives up pointer events. */}
      <div
        aria-hidden={chromeHidden}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          padding: "14px 20px calc(env(safe-area-inset-bottom, 0px) + 16px)",
          color: theme.chromeInk,
          background: `linear-gradient(0deg, ${theme.chrome} 70%, transparent)`,
          transform: chromeHidden ? "translateY(100%)" : "translateY(0)",
          opacity: chromeHidden ? 0 : 1,
          transition: chromeTransition,
          pointerEvents: chromeHidden ? "none" : "auto",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
          {showProgress && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
              color: theme.muted,
              fontSize: 10.5,
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                prevChapter();
              }}
              disabled={currentChapter === 0}
              aria-label="Previous chapter"
              style={{
                ...mobileTab(theme),
                width: 28,
                height: 28,
                opacity: currentChapter === 0 ? 0.35 : 1,
              }}
            >
              <Icon name="arrowL" size={14} />
            </button>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
            <div
              ref={trackRef}
              onPointerDown={onTrackPointerDown}
              onPointerMove={onTrackPointerMove}
              onPointerUp={onTrackPointerEnd}
              onPointerCancel={onTrackPointerEnd}
              role="slider"
              aria-label="Chapter progress"
              aria-valuemin={1}
              aria-valuemax={chapterCount}
              aria-valuenow={displayChapter + 1}
              aria-valuetext={book.chapters[displayChapter]?.title}
              style={{
                flex: 1,
                position: "relative",
                // Visible bar stays 3px; padding + negative margin grow the
                // touch target to ~27px without shifting layout.
                paddingBlock: 12,
                margin: "-12px 0",
                touchAction: "none",
                cursor: chapterCount > 1 ? "pointer" : "default",
              }}
            >
              <div style={{ position: "relative", height: 3 }}>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: theme.rule,
                    borderRadius: 1.5,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${pct}%`,
                    background: theme.ink,
                    borderRadius: 1.5,
                  }}
                />
                {ticks.map((p, i) => (
                  <span
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${p * 100}%`,
                      top: -2,
                      width: 1,
                      height: 7,
                      background: theme.muted,
                      opacity: 0.5,
                    }}
                  />
                ))}
                <div
                  style={{
                    position: "absolute",
                    left: `${pct}%`,
                    top: "50%",
                    transform: `translate(-50%, -50%) scale(${draggingTarget !== null ? 1.4 : 1})`,
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    background: theme.ink,
                    boxShadow: `0 0 0 3px ${theme.chrome}`,
                    transition: "transform 120ms ease-out",
                  }}
                />
              </div>
              {draggingTarget !== null && (
                <div
                  style={{
                    position: "absolute",
                    // Anchor on the thumb and shift the chip back by a
                    // fraction of its own width that matches how far along
                    // the bar we are. pct=0% → no shift (chip extends
                    // right); pct=100% → full -100% shift (chip extends
                    // left); pct=50% → -50% (centered). Net effect: the
                    // chip slides under itself as the thumb approaches
                    // either edge and never overflows the track.
                    left: `${pct}%`,
                    bottom: "calc(100% - 4px)",
                    transform: `translateX(-${pct}%)`,
                    background: theme.chrome,
                    color: theme.ink,
                    border: `0.5px solid ${theme.rule}`,
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 11,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    maxWidth: 240,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    pointerEvents: "none",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.18)",
                  }}
                >
                  Chapter {draggingTarget + 1} —{" "}
                  {book.chapters[draggingTarget]?.title ?? ""}
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      // Mirror the chip's slide so the arrow always sits
                      // under the thumb's real screen position. Clamped
                      // inside the chip so it doesn't poke past the
                      // rounded corners at the extremes.
                      left: `clamp(12px, ${pct}%, calc(100% - 12px))`,
                      bottom: -4,
                      width: 8,
                      height: 8,
                      transform: "translateX(-50%) rotate(45deg)",
                      background: theme.chrome,
                      borderRight: `0.5px solid ${theme.rule}`,
                      borderBottom: `0.5px solid ${theme.rule}`,
                    }}
                  />
                </div>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                nextChapter();
              }}
              disabled={currentChapter >= chapterCount - 1}
              aria-label="Next chapter"
              style={{
                ...mobileTab(theme),
                width: 28,
                height: 28,
                opacity: currentChapter >= chapterCount - 1 ? 0.35 : 1,
              }}
            >
              <Icon name="arrowR" size={14} />
            </button>
          </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-around" }}>
            <button
              onClick={() => setSheet("toc")}
              style={mobileTab(theme)}
              aria-label="Table of contents"
            >
              <Icon name="list" size={18} />
            </button>
            <button
              onClick={() => setSheet("highlights")}
              style={mobileTab(theme)}
              aria-label="Highlights"
            >
              <Icon name="highlight" size={18} />
            </button>
            <button
              onClick={() => setShowProgress((s) => !s)}
              style={mobileTab(theme)}
              aria-label={showProgress ? "Hide progress bar" : "Show progress bar"}
              aria-pressed={showProgress}
            >
              <Icon name="slider" size={18} />
            </button>
            <button
              onClick={() => setSheet("progress")}
              style={mobileTab(theme)}
              aria-label="Progress"
            >
              <Icon name="clock" size={18} />
            </button>
            <button
              onClick={() => setSheet("settings")}
              style={mobileTab(theme)}
              aria-label="Settings"
            >
              <Icon name="type" size={18} />
            </button>
          </div>
        </div>

      {/* Sheet stays mounted while it animates out — pass `open` so it
          knows whether to show the enter or exit keyframes. */}
      <MobileSheet
        theme={theme}
        open={sheet !== null}
        onClose={() => setSheet(null)}
        height="82%"
        label={
          sheet === "toc"
            ? "Table of contents"
            : sheet === "settings"
              ? "Reading settings"
              : sheet === "highlights"
                ? "Highlights"
                : sheet === "progress"
                  ? "Reading progress"
                  : undefined
        }
      >
        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {sheet === "toc" && (
              <TOCPanel
                theme={theme}
                onClose={() => setSheet(null)}
                bookTitle={book.title}
                chapters={book.chapters}
                currentChapter={currentChapter}
                onJump={(order) => {
                  onChapterChange(order);
                  setSheet(null);
                }}
                // Fluid layout inside the sheet — phone widths vary
                // (360px to 430px+) and the desktop 340px column would
                // leave dead space on the right. The sheet itself owns
                // the rounded chrome, so we drop the panel's side border.
                width="100%"
                side={undefined}
              />
            )}
            {sheet === "highlights" && (
              <HighlightsPanel
                theme={theme}
                themeKey={themeKey}
                onClose={() => setSheet(null)}
                highlights={state.highlights}
                onJump={(h) => {
                  onJumpToHighlight(h);
                  setSheet(null);
                }}
                onDelete={onDeleteHighlight}
                onUpdateNote={onUpdateHighlightNote}
                width="100%"
                side={undefined}
              />
            )}
            {sheet === "settings" && (
              <SettingsPanel
                theme={theme}
                themeKey={themeKey}
                t={t}
                setTweak={setTweak}
                onClose={() => setSheet(null)}
                width="100%"
                side={undefined}
                mobile
              />
            )}
            {sheet === "progress" && (
              <div
                style={{
                  padding: 22,
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "center",
                }}
              >
                <ProgressOverlay
                  theme={theme}
                  themeKey={themeKey}
                  currentChapter={currentChapter}
                  chapterCount={chapterCount}
                  chapterTitle={chapter.title}
                />
              </div>
            )}
        </div>
      </MobileSheet>
      {selAnchor && (
        <>
          <SelectionOverlay rects={selRects} />
          {handleRects && (
            <>
              <SelectionHandle
                rect={handleRects.start}
                position="start"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  draggingHandleRef.current = "start";
                  draggingPointerIdRef.current = e.pointerId;
                }}
              />
              <SelectionHandle
                rect={handleRects.end}
                position="end"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  draggingHandleRef.current = "end";
                  draggingPointerIdRef.current = e.pointerId;
                }}
              />
            </>
          )}
          <SelectionPopover
            theme={theme}
            anchor={selAnchor.rect}
            placement="below"
            onPick={(color) => createFromSelection(color)}
            onAddNote={(color, note) => createFromSelection(color, note)}
            onDismiss={dismissSelection}
          />
        </>
      )}
      {activeHl && (
        <HighlightActionPopover
          theme={theme}
          highlight={activeHl.highlight}
          anchor={activeHl.rect}
          onDelete={() => {
            onDeleteHighlight(activeHl.highlight.id);
            setActiveHl(null);
          }}
          onUpdateNote={(note) => {
            onUpdateHighlightNote(activeHl.highlight.id, note);
            setActiveHl(null);
          }}
          onDismiss={() => setActiveHl(null)}
        />
      )}
    </div>
  );
}
