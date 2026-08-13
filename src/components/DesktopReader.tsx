import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { AnimatedPanel } from "./AnimatedPanel";
import { Icon } from "./Icon";
import { BookBody } from "./BookBody";
import { PaginatedView, type PaginatedAPI } from "./PaginatedView";
import { ChapterProgressBar } from "./ChapterProgressBar";
import {
  chapterScrollFraction,
  paragraphScrollOffset,
  restoreScrollTop,
  fractionToWidth,
} from "./readerProgress";
import { SelectionPopover } from "./SelectionPopover";
import { HighlightActionPopover } from "./HighlightActionPopover";
import type { EpubBook } from "../epub/types";
import type { BookState, Highlight } from "../store/library";
import type { HighlightColor } from "../styles/tokens";
import {
  resolveSelectionAnchor,
  type SelectionAnchor,
} from "../lib/selectionAnchor";
import {
  FONT_STACKS,
  isArabicTitle,
  isRtlLanguage,
  titleFontFor,
  type Theme,
  type ThemeKey,
} from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";
import type { Tr } from "../i18n";
import { HighlightsPanel } from "../panels/HighlightsPanel";
import { ProgressOverlay } from "../panels/ProgressOverlay";
import { SettingsPanel } from "../panels/SettingsPanel";
import { TOCPanel } from "../panels/TOCPanel";
import type { ActivePanel, Tweaks } from "../types/reader";

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  t: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  book: EpubBook;
  state: BookState;
  currentChapter: number;
  /** Paragraph to scroll to when the chapter mounts. Read once per chapter
      change; live scroll position is owned by the reader itself. */
  resumeParagraph: number;
  /** 0..1 sub-paragraph scroll offset to resume at (scroll mode). Optional;
      defaults to 0 (paragraph top) for callers that don't track it yet. */
  resumeOffset?: number;
  /** Bumped by App when a targeted scroll (e.g., highlight jump) should
   *  re-fire the chapter-mount scroll effect even if `currentChapter`
   *  didn't change. */
  jumpNonce: number;
  onChapterChange: (order: number) => void;
  onParagraphChange: (idx: number, offset?: number) => void;
  onCreateHighlight: (input: {
    chapter: number;
    paragraphIndex: number;
    charStart: number;
    charEnd: number;
    text: string;
    color: HighlightColor;
    note?: string;
    groupId?: string;
  }) => void;
  onDeleteHighlight: (id: string) => void;
  onUpdateHighlightNote: (id: string, note: string) => void;
  onJumpToHighlight: (h: Highlight) => void;
  activePanel: ActivePanel;
  setActivePanel: (next: ActivePanel) => void;
  onBack: () => void;
}

function chromeBtn(theme: Theme, active = false): CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: "none",
    background: active ? theme.hover : "transparent",
    color: active ? theme.ink : theme.chromeInk,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

export function DesktopReader({
  theme,
  themeKey,
  t,
  setTweak,
  book,
  state,
  currentChapter,
  resumeParagraph,
  resumeOffset = 0,
  jumpNonce,
  onChapterChange,
  onParagraphChange,
  onCreateHighlight,
  onDeleteHighlight,
  onUpdateHighlightNote,
  onJumpToHighlight,
  activePanel,
  setActivePanel,
  onBack,
}: Props) {
  const { tr, dir } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const mode = t.readingMode;
  const isPaginated = mode !== "scroll";
  const paginatedColumns: 1 | 2 = mode === "paginated-2" ? 2 : 1;
  // Content direction — derived from the BOOK's own language, independent of
  // the UI locale above. Feeds BookBody/PaginatedView's own `dir` attribute
  // (set on their own elements, so it never inherits from the chrome below).
  const rtl = isRtlLanguage(book.language);

  // The live paragraph for the current chapter — updated by both the
  // scroll listener and PaginatedView. Used so that switching reading
  // modes mid-chapter lands the user on the same paragraph they were
  // reading, not on the chapter's resume hint (which only updates on
  // chapter switch / highlight jump).
  const livePara = useRef(resumeParagraph);
  // Sub-paragraph scroll offset (0..1) to resume at, kept in sync with
  // livePara — re-seeded from resumeOffset on the same chapter/jump changes.
  const liveOffset = useRef(resumeOffset);
  // Imperatively-updated fill for the header's within-chapter progress bar.
  const progressFillRef = useRef<HTMLDivElement>(null);
  const lastChapterRef = useRef(currentChapter);
  const lastJumpNonceRef = useRef(jumpNonce);
  if (lastChapterRef.current !== currentChapter) {
    lastChapterRef.current = currentChapter;
    livePara.current = resumeParagraph;
    liveOffset.current = resumeOffset;
  }
  if (lastJumpNonceRef.current !== jumpNonce) {
    // A targeted jump (e.g., from the highlights panel) within the same
    // chapter — adopt resumeParagraph so the chapter-mount effect lands
    // on the new target instead of where the user was last reading.
    lastJumpNonceRef.current = jumpNonce;
    livePara.current = resumeParagraph;
    liveOffset.current = resumeOffset;
  }

  // Set when we step backward into the previous chapter via scroll-up
  // overscroll. The chapter-mount effect picks this up and lands the
  // viewport at the bottom of the new chapter — natural for an upward
  // scroll, since the reader was just continuing through the chapter
  // edge. Cleared after the effect consumes it.
  const landAtEndRef = useRef(false);

  const handleParagraphChange = useCallback(
    (idx: number, offset?: number) => {
      livePara.current = idx;
      if (offset !== undefined) liveOffset.current = offset;
      onParagraphChange(idx, offset);
    },
    [onParagraphChange],
  );
  // Stable so PaginatedView's progress effect only re-fires on page changes,
  // not on every DesktopReader re-render. Writes the bar fill imperatively.
  const onPaginatedProgress = useCallback((f: number) => {
    if (progressFillRef.current)
      progressFillRef.current.style.width = fractionToWidth(f);
  }, []);
  // Same ref trick for the scroll listener — keeps the listener stable
  // while still calling the freshest handler.
  const onParagraphChangeRef = useRef(handleParagraphChange);
  onParagraphChangeRef.current = handleParagraphChange;
  const chapter = book.chapters[currentChapter] ?? book.chapters[0];
  const chapterCount = book.chapters.length;
  const pct = chapterCount > 0
    ? Math.round(((currentChapter + 1) / chapterCount) * 100)
    : 0;
  const toggle = (panel: ActivePanel) =>
    setActivePanel(activePanel === panel ? null : panel);

  const prevChapter = () => {
    if (currentChapter > 0) onChapterChange(currentChapter - 1);
  };
  const nextChapter = () => {
    if (currentChapter < chapterCount - 1) onChapterChange(currentChapter + 1);
  };

  // Centered chapter-name toast. Fires whenever the chapter actually
  // changes (skipping the initial mount, since the user just opened the
  // book and already knows where they are). The `seq` field is bumped
  // each fire so re-keying the React node restarts the CSS animation
  // even when the user lands on the same chapter twice in a row.
  const [chapterToast, setChapterToast] = useState<{
    title: string;
    number: number;
    total: number;
    seq: number;
  } | null>(null);
  const toastChapterRef = useRef(currentChapter);
  const toastSeqRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (toastChapterRef.current === currentChapter) return;
    toastChapterRef.current = currentChapter;
    toastSeqRef.current += 1;
    setChapterToast({
      title: chapter.title,
      number: currentChapter + 1,
      total: chapterCount,
      seq: toastSeqRef.current,
    });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    // Slightly longer than the CSS animation (1500ms) so the element
    // unmounts after the fade-out finishes, not mid-animation.
    toastTimerRef.current = window.setTimeout(() => {
      setChapterToast(null);
      toastTimerRef.current = null;
    }, 1550);
  }, [currentChapter, chapter.title, chapterCount]);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Scroll to the live paragraph whenever the chapter changes or the
  // mode flips back to scroll — only active in scroll mode. Paginated
  // mode owns its own resume logic via PaginatedView's `initialParagraph`
  // prop. Using `livePara` (not `resumeRef`) means a paginated→scroll
  // switch lands on the same paragraph the user was just reading, not on
  // the chapter's original entry point.
  useEffect(() => {
    if (mode !== "scroll") return;
    const el = scrollRef.current;
    if (!el) return;
    // Streamed (source) chapters load their body async; the paragraphs aren't
    // in the DOM on this effect's first run. Bail until they exist — the
    // chapter content-id dep re-runs this once they mount. Returning here also
    // preserves landAtEndRef (we don't consume it on an empty pass).
    if (el.querySelectorAll("[data-p-index]").length === 0) return;
    if (landAtEndRef.current) {
      // Came in via scroll-up overscroll — drop the reader at the bottom
      // of the new (previous) chapter so reading continues naturally
      // upward instead of jumping to the chapter's top.
      landAtEndRef.current = false;
      el.scrollTop = el.scrollHeight;
      const ps = el.querySelectorAll<HTMLElement>("[data-p-index]");
      if (ps.length > 0) {
        let lastIdx = 0;
        for (const p of ps) {
          const idx = Number(p.dataset.pIndex);
          if (idx > lastIdx) lastIdx = idx;
        }
        livePara.current = lastIdx;
        // Persist so resume after a restart matches what the user sees.
        onParagraphChangeRef.current(lastIdx);
      }
      return;
    }
    // When resuming at the very first paragraph, snap to scrollTop=0 so
    // the chapter heading (Chapter N of M + title) BookBody renders above
    // paragraph 0 stays visible. Using paragraph 0's offsetTop scrolls the
    // heading off-screen and looks like the title is clipped on load.
    if (livePara.current === 0 && liveOffset.current <= 0.001) {
      el.scrollTop = 0;
      return;
    }
    const target = el.querySelector<HTMLElement>(
      `[data-p-index="${livePara.current}"]`,
    );
    if (target) {
      el.scrollTop = restoreScrollTop(
        target.offsetTop,
        target.offsetHeight,
        liveOffset.current,
      );
    } else {
      el.scrollTop = 0;
    }
    // book.chapters[currentChapter]?.id changes when a streamed chapter's
    // content is spliced in (its `#0` → `#<n>` id bump), re-running this so
    // resume fires once the paragraphs are actually in the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter, book.id, mode, jumpNonce, book.chapters[currentChapter]?.id]);

  // Throttled scroll listener — find the topmost-visible paragraph and
  // bubble its index up to the App state for persistence. Only runs in
  // scroll mode; paginated mode reports paragraphs through PaginatedView.
  useEffect(() => {
    if (mode !== "scroll") return;
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
        let bestEl: HTMLElement | null = null;
        for (const p of ps) {
          const offset = p.getBoundingClientRect().top - containerTop;
          if (offset > 8) break;
          best = Number(p.dataset.pIndex);
          bestEl = p;
        }
        const intoPara = bestEl
          ? paragraphScrollOffset(el.scrollTop, bestEl.offsetTop, bestEl.offsetHeight)
          : 0;
        onParagraphChangeRef.current(best, intoPara);
      }, 250);
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [mode]);

  // Live within-chapter progress for the header bar. Separate from the 250ms
  // paragraph listener (too coarse for a smooth bar) and written imperatively
  // so scrolling never re-renders React.
  useEffect(() => {
    if (mode !== "scroll") return;
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const paint = () => {
      raf = 0;
      if (!progressFillRef.current) return;
      progressFillRef.current.style.width = fractionToWidth(
        chapterScrollFraction(el.scrollTop, el.scrollHeight, el.clientHeight),
      );
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(paint);
    };
    paint(); // initial fill for this chapter
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [mode, currentChapter, book.id]);

  // Imperative handle on the paginated view so the keyboard handler and
  // the bottom-bar arrow buttons can flip pages without rebuilding the
  // PaginatedView's internal page state on every render.
  const paginatedApiRef = useRef<PaginatedAPI | null>(null);
  const onPaginatedApi = useCallback((api: PaginatedAPI) => {
    paginatedApiRef.current = api;
  }, []);

  // Ref on the paginated wrapper so the wheel listener can preventDefault
  // (must be non-passive) without touching the scroll container.
  const paginatedWrapRef = useRef<HTMLDivElement>(null);

  // Wheel-to-flip-page in paginated modes. A short cooldown prevents a
  // single trackpad gesture from skipping multiple pages in one swipe.
  // At a chapter boundary (first/last page) it falls through to chapter
  // navigation so the user can keep scrolling through the book.
  useEffect(() => {
    if (!isPaginated) return;
    const el = paginatedWrapRef.current;
    if (!el) return;
    let cooldown = false;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 4) return; // ignore minor trackpad noise
      e.preventDefault();
      if (cooldown) return;
      cooldown = true;
      window.setTimeout(() => { cooldown = false; }, 380);
      const api = paginatedApiRef.current;
      if (e.deltaY > 0) {
        // Forward — next page, or next chapter at the last page.
        if (!api?.nextPage()) {
          if (currentChapter < chapterCount - 1) onChapterChange(currentChapter + 1);
        }
      } else {
        // Backward — prev page, or prev chapter at the first page.
        if (!api?.prevPage()) {
          if (currentChapter > 0) onChapterChange(currentChapter - 1);
        }
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaginated, currentChapter, chapterCount, onChapterChange]);

  // Overscroll state: when the reader is in scroll mode and the user
  // keeps scrolling past the chapter's edge, a small indicator builds up
  // at the relevant edge until a threshold flips chapters. Lets the user
  // continue reading without reaching for the prev/next buttons.
  const [overscroll, setOverscroll] = useState<{
    dir: "down" | "up";
    pct: number;
  } | null>(null);
  const overscrollAmtRef = useRef(0);
  const overscrollDirRef = useRef<"down" | "up" | null>(null);
  const overscrollResetTimer = useRef<number | null>(null);
  const OVERSCROLL_THRESHOLD = 140; // px of accumulated wheel delta

  useEffect(() => {
    if (mode !== "scroll") return;
    const el = scrollRef.current;
    if (!el) return;

    const reset = () => {
      overscrollAmtRef.current = 0;
      overscrollDirRef.current = null;
      setOverscroll(null);
      if (overscrollResetTimer.current) {
        clearTimeout(overscrollResetTimer.current);
        overscrollResetTimer.current = null;
      }
    };

    const onWheel = (e: WheelEvent) => {
      const goingDown = e.deltaY > 0;
      const goingUp = e.deltaY < 0;
      // Tolerate sub-pixel rounding when measuring the chapter edge.
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
      const atTop = el.scrollTop <= 1;
      let dir: "down" | "up" | null = null;
      if (atBottom && goingDown && currentChapter < chapterCount - 1) {
        dir = "down";
      } else if (atTop && goingUp && currentChapter > 0) {
        dir = "up";
      }
      if (dir === null) {
        if (overscrollDirRef.current !== null) reset();
        return;
      }
      // Block the browser's own bounce so the wheel events stay ours
      // until we've decided whether to flip chapters.
      e.preventDefault();
      if (overscrollDirRef.current !== dir) {
        overscrollDirRef.current = dir;
        overscrollAmtRef.current = 0;
      }
      overscrollAmtRef.current = Math.min(
        OVERSCROLL_THRESHOLD * 1.05,
        overscrollAmtRef.current + Math.abs(e.deltaY),
      );
      const pct = Math.min(1, overscrollAmtRef.current / OVERSCROLL_THRESHOLD);
      setOverscroll({ dir, pct });

      if (overscrollAmtRef.current >= OVERSCROLL_THRESHOLD) {
        const triggered = dir;
        reset();
        if (triggered === "down") {
          nextChapter();
        } else {
          // Going up: land at the bottom of the previous chapter so the
          // reader's eye picks up where it left off, mid-flow.
          landAtEndRef.current = true;
          prevChapter();
        }
        return;
      }
      // No more wheel events for ~280ms? Treat as the user releasing —
      // fade the indicator instead of leaving it stuck.
      if (overscrollResetTimer.current)
        clearTimeout(overscrollResetTimer.current);
      overscrollResetTimer.current = window.setTimeout(reset, 280);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      // Drop any in-flight indicator state — if the chapter changed via
      // some other path (TOC, scrub, keyboard) we don't want a stale
      // pill stuck on screen.
      if (overscrollResetTimer.current) {
        clearTimeout(overscrollResetTimer.current);
        overscrollResetTimer.current = null;
      }
      overscrollAmtRef.current = 0;
      overscrollDirRef.current = null;
      setOverscroll(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentChapter, chapterCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable))
        return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      // In RTL, "forward in the book" is the LEFT arrow — the same arrow
      // that visually points the way pages flip in a RTL-bound book.
      const forward = rtl ? e.key === "ArrowLeft" : e.key === "ArrowRight";
      if (isPaginated) {
        // Paginated: arrows flip pages. At a chapter boundary, fall
        // through to chapter navigation so the user can keep pressing
        // the arrow to keep moving through the book.
        const api = paginatedApiRef.current;
        if (forward) {
          if (!api || !api.nextPage()) nextChapter();
        } else {
          if (!api || !api.prevPage()) prevChapter();
        }
      } else {
        if (forward) nextChapter();
        else prevChapter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Chapter ticks on the bottom progress bar — skip current position so
  // the scrubber sits cleanly on top.
  const ticks =
    chapterCount > 1
      ? Array.from({ length: chapterCount - 1 }, (_, i) => (i + 1) / chapterCount)
      : [];

  // Two mutually-exclusive popovers:
  //   - selAnchor: shown when the user just finished selecting text
  //   - activeHl: shown when the user clicked an existing highlight
  // Showing one always clears the other.
  const [selAnchor, setSelAnchor] = useState<SelectionAnchor | null>(null);
  const [activeHl, setActiveHl] = useState<{
    highlight: Highlight;
    rect: DOMRect;
  } | null>(null);

  // Resolve the selection only when the user *stops* selecting (pointerup),
  // not while they're still dragging. Pointerups inside our popover are
  // ignored — those are interactions with the toolbar itself.
  useEffect(() => {
    const onPointerUp = (e: PointerEvent) => {
      const path = (e.composedPath?.() ?? []) as EventTarget[];
      const inPopover = path.some(
        (node) =>
          node instanceof HTMLElement &&
          node.dataset.popover === "highlight",
      );
      if (inPopover) return;
      // Defer one tick so the browser has finalized the selection.
      window.setTimeout(() => {
        const next = resolveSelectionAnchor();
        if (next) {
          setSelAnchor(next);
          setActiveHl(null);
        }
      }, 0);
    };
    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, []);

  // All popover dismissal flows through clicks: outside a popover and
  // outside a mark → dismiss both. We deliberately don't use
  // selectionchange — typing in the popover's note editor moves the
  // textarea's caret, which would trigger spurious dismissals.
  const highlightById = (id: string) =>
    state.highlights.find((h) => h.id === id);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // composedPath snapshots the ancestor chain at dispatch time. By
      // the time this bubble-phase handler runs, React may have already
      // unmounted the clicked element (e.g. clicking the popover's
      // pencil swaps in a textarea), so target.closest() would walk a
      // detached node and miss the popover ancestor. Path-based check
      // works regardless of post-dispatch DOM mutations.
      const path = (e.composedPath?.() ?? []) as EventTarget[];
      const inPopover = path.some(
        (node) =>
          node instanceof HTMLElement &&
          node.dataset.popover === "highlight",
      );
      if (inPopover) return;

      // Tail of a drag-select that landed on a mark/text — let the
      // pointerup handler set the create popover; don't dismiss here.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;

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
      // Click outside any highlight or popover — dismiss everything.
      setActiveHl(null);
      setSelAnchor(null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
    // Re-bind when the highlights list changes so the closure sees the
    // fresh array (new IDs need to resolve).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.highlights]);

  const dismissSelection = () => {
    setSelAnchor(null);
    window.getSelection()?.removeAllRanges();
  };
  const createFromSelection = (color: HighlightColor, note?: string) => {
    if (!selAnchor) return;
    // Multi-paragraph selections become N highlights that share one
    // groupId so they delete together. Single-paragraph selections
    // need no groupId. The note (if any) attaches only to the first
    // segment so it isn't duplicated.
    const trimmedNote = note?.trim() || undefined;
    const groupId =
      selAnchor.segments.length > 1 ? crypto.randomUUID() : undefined;
    selAnchor.segments.forEach((seg, i) => {
      onCreateHighlight({
        chapter: currentChapter,
        paragraphIndex: seg.paragraphIndex,
        charStart: seg.charStart,
        charEnd: seg.charEnd,
        text: seg.text,
        color,
        note: i === 0 ? trimmedNote : undefined,
        groupId,
      });
    });
    dismissSelection();
  };

  // Click + drag the bottom progress bar to scrub through chapters.
  // Pointer capture keeps drag alive after the cursor leaves the track.
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
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
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    const next = chapterFromClientX(e.clientX);
    if (next !== null && next !== currentChapter) onChapterChange(next);
  };
  const onTrackPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const next = chapterFromClientX(e.clientX);
    if (next !== null && next !== currentChapter) onChapterChange(next);
  };
  const onTrackPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      // Reader CHROME follows the UI language (toolbars, panels, bottom
      // progress bar all mirror under Arabic). Book CONTENT direction is
      // independent — BookBody/PaginatedView set their own `dir` from the
      // book's language on their own elements below, which overrides this
      // cascade for their subtree regardless of what `dir` resolves to here.
      dir={dir}
      style={{
        width: "100%",
        height: "100%",
        background: theme.bg,
        color: theme.ink,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: FONT_STACKS.sans,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 22px",
          borderBottom: `0.5px solid ${theme.rule}`,
          color: theme.chromeInk,
          flexShrink: 0,
          position: "relative",
        }}
      >
        <ChapterProgressBar fillRef={progressFillRef} theme={theme} rtl={rtl} />
        <button onClick={onBack} style={chromeBtn(theme)} aria-label={tr("reader.backToLibrary")}>
          <Icon name="home" size={16} />
        </button>
        <div style={{ width: 1, height: 18, background: theme.rule, margin: "0 4px" }} />
        <button
          onClick={() => toggle("toc")}
          style={chromeBtn(theme, activePanel === "toc")}
          aria-label={tr("reader.toc")}
        >
          <Icon name="list" size={16} />
        </button>
        <button
          onClick={() => toggle("highlights")}
          style={chromeBtn(theme, activePanel === "highlights")}
          aria-label={tr("reader.highlights")}
        >
          <Icon name="highlight" size={16} />
        </button>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            minWidth: 0,
          }}
        >
          <div
            title={chapter.title}
            style={{
              // Arabic / mixed titles render in Readex Pro (via the sans
              // stack) so digits and Latin punctuation interleaved with
              // Arabic share the same family. Suppress italic on Arabic
              // — Readex Pro doesn't ship an italic, and synthetic
              // italic on Arabic looks broken.
              fontFamily: titleFontFor(chapter.title),
              fontSize: 13,
              // Explicit line-height — Readex Pro's Arabic glyphs need
              // more vertical room than Fraunces' Latin, and without it
              // `overflow: hidden` (needed for the ellipsis) clips the
              // ascenders/descenders.
              lineHeight: 1.55,
              fontStyle: isArabicTitle(chapter.title) ? "normal" : "italic",
              fontWeight: 500,
              color: theme.ink,
              letterSpacing: "-0.01em",
              width: "100%",
              textAlign: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {chapter.title}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: theme.muted,
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <span>
              {tr("reader.chapterOfTotal", { n: currentChapter + 1, total: chapterCount })}
            </span>
          </div>
        </div>

        <button
          onClick={() => toggle("progress")}
          style={chromeBtn(theme, activePanel === "progress")}
          aria-label={tr("reader.progress")}
        >
          <Icon name="clock" size={16} />
        </button>
        <button
          onClick={() => toggle("settings")}
          style={chromeBtn(theme, activePanel === "settings")}
          aria-label={tr("reader.settings")}
        >
          <Icon name="type" size={16} />
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <AnimatedPanel open={activePanel === "toc"} side="left">
          <TOCPanel
            theme={theme}
            onClose={() => setActivePanel(null)}
            bookTitle={book.title}
            chapters={book.chapters}
            currentChapter={currentChapter}
            onJump={(order) => {
              onChapterChange(order);
              setActivePanel(null);
            }}
          />
        </AnimatedPanel>
        <AnimatedPanel open={activePanel === "highlights"} side="left">
          <HighlightsPanel
            theme={theme}
            themeKey={themeKey}
            onClose={() => setActivePanel(null)}
            highlights={state.highlights}
            onJump={(h) => {
              onJumpToHighlight(h);
              setActivePanel(null);
            }}
            onDelete={onDeleteHighlight}
            onUpdateNote={onUpdateHighlightNote}
          />
        </AnimatedPanel>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            position: "relative",
            minWidth: 0,
          }}
        >
          {isPaginated ? (
            <div
              ref={paginatedWrapRef}
              style={{
                flex: 1,
                padding: "60px 80px 30px",
                position: "relative",
                minHeight: 0,
                minWidth: 0,
              }}
            >
              <PaginatedView
                columnsPerPage={paginatedColumns}
                rtl={rtl}
                initialParagraph={livePara.current}
                onParagraphChange={handleParagraphChange}
                onApi={onPaginatedApi}
                onChapterProgress={onPaginatedProgress}
              >
                <div key={chapter.id} className="leaflet-chapter-enter">
                  <BookBody
                    bookId={book.id}
                    chapter={chapter}
                    chapterCount={chapterCount}
                    theme={theme}
                    themeKey={themeKey}
                    fontFamily={t.fontFamily}
                    fontSize={t.fontSize}
                    lineHeight={t.lineHeight}
                    letterSpacing={t.letterSpacing}
                    textAlign={t.textAlign}
                    rtl={rtl}
                    highlights={state.highlights}
                  />
                </div>
              </PaginatedView>
            </div>
          ) : (
            <div
              ref={scrollRef}
              style={{
                flex: 1,
                overflow: "auto",
                padding: "60px 80px 30px",
                position: "relative",
                // overscroll-behavior: contain stops the browser's own
                // chrome bounce so our wheel preventDefault is the
                // authority on what happens past the edge.
                overscrollBehavior: "contain",
              }}
              className="no-scrollbar"
            >
              <div key={chapter.id} className="leaflet-chapter-enter">
                <BookBody
                  bookId={book.id}
                  chapter={chapter}
                  chapterCount={chapterCount}
                  theme={theme}
                  themeKey={themeKey}
                  fontFamily={t.fontFamily}
                  fontSize={t.fontSize}
                  lineHeight={t.lineHeight}
                  letterSpacing={t.letterSpacing}
                  textAlign={t.textAlign}
                  rtl={rtl}
                  widthPercent={t.contentWidth}
                  highlights={state.highlights}
                />
              </div>
            </div>
          )}
          {overscroll && (
            <OverscrollIndicator theme={theme} state={overscroll} tr={tr} />
          )}
          {chapterToast && (
            <ChapterToast key={chapterToast.seq} theme={theme} info={chapterToast} tr={tr} />
          )}

          <div
            style={{
              padding: "14px 80px 22px",
              display: "flex",
              alignItems: "center",
              gap: 16,
              color: theme.muted,
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            <button
              onClick={prevChapter}
              disabled={currentChapter === 0}
              aria-label={tr("reader.prevChapter")}
              style={{
                ...chromeBtn(theme),
                width: 28,
                height: 28,
                opacity: currentChapter === 0 ? 0.35 : 1,
                cursor: currentChapter === 0 ? "not-allowed" : "pointer",
              }}
            >
              <Icon name="arrowL" size={14} className="rtl-flip-x" />
            </button>
            <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 32 }}>
              {pct}%
            </span>
            <div
              role="slider"
              aria-label={tr("reader.chapterProgress")}
              aria-valuemin={1}
              aria-valuemax={Math.max(1, chapterCount)}
              aria-valuenow={currentChapter + 1}
              aria-valuetext={chapter.title}
              onPointerDown={onTrackPointerDown}
              onPointerMove={onTrackPointerMove}
              onPointerUp={onTrackPointerUp}
              onPointerCancel={onTrackPointerUp}
              style={{
                flex: 1,
                height: 22,
                display: "flex",
                alignItems: "center",
                cursor: dragging ? "grabbing" : "pointer",
                // Stop the browser from interpreting horizontal pointer
                // moves as scroll/zoom while we're scrubbing.
                touchAction: "none",
                userSelect: "none",
              }}
            >
              <div
                ref={trackRef}
                style={{ position: "relative", width: "100%", height: 3 }}
              >
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
                      insetInlineStart: `${p * 100}%`,
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
                    insetInlineStart: `${pct}%`,
                    top: "50%",
                    transform: `translate(-50%, -50%) scale(${dragging ? 1.25 : 1})`,
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    background: theme.ink,
                    boxShadow: `0 0 0 3px ${theme.bg}`,
                    transition: "transform 120ms ease",
                  }}
                />
              </div>
            </div>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                maxWidth: 200,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {chapter.title}
            </span>
            <button
              onClick={nextChapter}
              disabled={currentChapter >= chapterCount - 1}
              aria-label={tr("reader.nextChapter")}
              style={{
                ...chromeBtn(theme),
                width: 28,
                height: 28,
                opacity: currentChapter >= chapterCount - 1 ? 0.35 : 1,
                cursor:
                  currentChapter >= chapterCount - 1 ? "not-allowed" : "pointer",
              }}
            >
              <Icon name="arrowR" size={14} className="rtl-flip-x" />
            </button>
          </div>
        </div>

        <AnimatedPanel open={activePanel === "settings"} side="right">
          <SettingsPanel
            theme={theme}
            themeKey={themeKey}
            t={t}
            setTweak={setTweak}
            onClose={() => setActivePanel(null)}
          />
        </AnimatedPanel>
        <AnimatedPanel open={activePanel === "progress"} side="right">
          <div
            style={{
              width: 380,
              // Kept physical (not borderInlineStart): AnimatedPanel's
              // side="right" slide is itself a physical translateX(100%)
              // unaffected by `dir` (out of this task's scope — panel-side
              // mirroring is a separate concern), so this panel always sits
              // on the physical right; the divider must stay on its
              // physical-left edge (the one facing the reading column)
              // regardless of UI direction.
              borderLeft: `0.5px solid ${theme.rule}`,
              background: theme.bg,
              padding: 24,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              flexShrink: 0,
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
        </AnimatedPanel>
      </div>
      {selAnchor && (
        <SelectionPopover
          theme={theme}
          anchor={selAnchor.rect}
          onPick={(color) => createFromSelection(color)}
          onAddNote={(color, note) => createFromSelection(color, note)}
          onDismiss={dismissSelection}
        />
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

/**
 * Centered chapter-name pop-up. Fires on each chapter swap so the reader
 * gets a clear "you're now on Chapter X" cue without needing to look at
 * the chrome bar. Animation timing is owned by CSS (.leaflet-chapter-toast),
 * the host just renders + unmounts.
 */
function ChapterToast({
  theme,
  info,
  tr,
}: {
  theme: Theme;
  info: { title: string; number: number; total: number };
  tr: Tr;
}) {
  return (
    <div
      className="leaflet-chapter-toast"
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        // Initial transform is overridden by the keyframes; setting it
        // here keeps SSR / pre-animation paint centered too.
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        zIndex: 50,
        padding: "16px 28px",
        borderRadius: 14,
        background: theme.chrome,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        boxShadow: "0 16px 44px rgba(0,0,0,0.22)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        fontFamily: FONT_STACKS.sans,
        textAlign: "center",
        minWidth: 220,
        maxWidth: 360,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: theme.muted,
          marginBottom: 6,
        }}
      >
        {tr("reader.chapterOfTotal", { n: info.number, total: info.total })}
      </div>
      <div
        style={{
          fontFamily: titleFontFor(info.title),
          fontSize: 18,
          fontStyle: isArabicTitle(info.title) ? "normal" : "italic",
          fontWeight: 500,
          letterSpacing: "-0.01em",
          lineHeight: 1.3,
          color: theme.ink,
          // Truncate very long titles to two lines so the toast doesn't
          // turn into a full-screen takeover for chapters with long
          // editorial subheads.
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {info.title}
      </div>
    </div>
  );
}

/**
 * Subtle pill that fades in at the chapter edge when the reader keeps
 * scrolling past the end (or top). Fills as accumulated overscroll
 * approaches the chapter-flip threshold.
 */
function OverscrollIndicator({
  theme,
  state,
  tr,
}: {
  theme: Theme;
  state: { dir: "down" | "up"; pct: number };
  tr: Tr;
}) {
  const isDown = state.dir === "down";
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        [isDown ? "bottom" : "top"]: 60,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        borderRadius: 999,
        background: theme.chrome,
        color: theme.muted,
        border: `0.5px solid ${theme.rule}`,
        fontSize: 11,
        fontFamily: FONT_STACKS.sans,
        pointerEvents: "none",
        opacity: 0.4 + state.pct * 0.6,
        boxShadow: `0 6px 18px ${theme.rule}`,
        zIndex: 30,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          transform: isDown ? "none" : "rotate(180deg)",
        }}
      >
        <Icon name="chevronD" size={12} />
      </span>
      <span>
        {isDown ? tr("reader.keepScrollingNext") : tr("reader.keepScrollingPrev")}
      </span>
      <div
        style={{
          width: 50,
          height: 2,
          background: theme.rule,
          borderRadius: 1,
        }}
      >
        <div
          style={{
            width: `${state.pct * 100}%`,
            height: "100%",
            background: theme.ink,
            borderRadius: 1,
            transition: "width 80ms linear",
          }}
        />
      </div>
    </div>
  );
}
