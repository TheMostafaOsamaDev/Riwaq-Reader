import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { Icon } from "./Icon";
import { BookBody, readingGutter } from "./BookBody";
import { ChapterEndCard, ChapterStartLink } from "./ChapterEnd";
import { jumpScrollTop } from "./scrollJump";
import { ChapterProgressBar } from "./ChapterProgressBar";
import {
  chapterScrollFraction,
  landingAppliesTo,
  paragraphScrollOffset,
  restoreScrollTop,
} from "./readerProgress";
import { MobileSheet } from "./MobileSheet";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  MAX_TICKS,
  ReaderProgressBar,
} from "../reader/chrome/ReaderProgressBar";
import { ReaderTabBar } from "../reader/chrome/ReaderTabBar";
import { FocusRail } from "../reader/chrome/FocusRail";
import { useProgressRails } from "../reader/chrome/useProgressRails";
import {
  FOCUS_TOAST_MS,
  FocusLock,
  FocusPill,
} from "../reader/chrome/FocusSigns";
import { isDoubleTap, type Tap } from "../reader/chrome/focusGesture";
import {
  isPageTap,
  LONG_PRESS_MOVE_TOLERANCE,
  LONG_PRESS_MS,
} from "../reader/chrome/pageTap";
import { glassBar } from "../reader/chrome/glass";
import { attachSmoothWheel } from "../reader/scroll/smoothWheel";
import {
  attachTouchPanFallback,
  movesThePage,
} from "../reader/scroll/touchPanFallback";
import { SelectionPopover } from "./SelectionPopover";
import { HANDLE_CLEARANCE, SelectionLayer } from "./SelectionLayer";
import {
  caretInBody,
  snapEndpoint,
  type TextEndpoint,
  wordAround,
} from "../reader/selection/textCaret";
import {
  contentOrigin,
  measureSelection,
  sameGeometry,
  type SelectionGeometry,
} from "../reader/selection/selectionGeometry";
import { HighlightActionPopover } from "./HighlightActionPopover";
import type { EpubBook } from "../epub/types";
import type { BookState, Highlight } from "../store/library";
import {
  EASE,
  isReducedMotion,
  MOTION,
  useReducedMotion,
} from "../styles/motion";
import {
  FONT_STACKS,
  isRtlLanguage,
  type HighlightColor,
  type Theme,
  type ThemeKey,
  readingSurfaces,
  Z,
  readingStack,
} from "../styles/tokens";
import {
  anchorFromRange,
  rangeForSegments,
  rectForMark,
  rectForSegments,
  type SelectionAnchor,
} from "../lib/selectionAnchor";
import { copySelection } from "../lib/clipboard";
import { useI18n } from "../i18n/useI18n";
import { formatNum } from "../i18n";
import { HighlightsPanel } from "../panels/HighlightsPanel";
import { ProgressOverlay } from "../panels/ProgressOverlay";
import { SettingsPanel } from "../panels/SettingsPanel";
import { TOCPanel } from "../panels/TOCPanel";
import type { ActivePanel, TocVolume, Tweaks } from "../types/reader";

// ---- Custom selection helpers --------------------------------------
// We replace native text selection on mobile with a hand-rolled
// pointer gesture. The user long-presses a word, drags to extend, and
// releases; the two handles then adjust either end. The selection lives
// only in React state — never on window.getSelection() — so the OS
// selection toolbar has no anchor and never appears. Where a finger is in
// the text is reader/selection/textCaret.ts; what gets drawn is
// reader/selection/selectionGeometry.ts.

// The two numbers that separate a hold from a tap from a scroll live with the
// test that decides between them — reader/chrome/pageTap.ts.

/** True if endpoint `a` lies strictly before endpoint `b` in document
 *  order. Same node → compare offsets; across nodes → use the DOM's
 *  compareDocumentPosition. */
function comesBefore(a: TextEndpoint, b: TextEndpoint): boolean {
  if (a.node === b.node) return a.offset < b.offset;
  return !!(
    a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING
  );
}

/** Build a Range from two endpoints, ordered correctly (start before end). */
function buildRange(a: TextEndpoint, b: TextEndpoint): Range {
  const range = document.createRange();
  if (comesBefore(b, a)) {
    range.setStart(b.node, b.offset);
    range.setEnd(a.node, a.offset);
  } else {
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
  }
  return range;
}

/** How close to the reading region's top or bottom a dragged handle has to
 *  be before the page scrolls to follow it, and how fast it then goes at
 *  the very edge (px per frame). Selecting past the bottom of the screen is
 *  otherwise impossible: the handle cannot be dragged off the glass. */
const EDGE_SCROLL_ZONE = 56;
const EDGE_SCROLL_MAX = 14;

/** How long after the last scroll event the page counts as still. The
 *  selection toolbar comes back after that. */
const SCROLL_SETTLE_MS = 220;

/** Height of the guard over the system's swipe-up edge in full screen, where
 *  the safe-area inset reads 0. Android's gesture strip is 24-32dp. */
const SYSTEM_EDGE_PX = 28;
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
  /** 0..1 sub-paragraph scroll offset to resume at. Optional; defaults to 0
      (paragraph top) for callers that don't track it yet. */
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
  /** Volume ranges for the Contents sheet, when the book's origin knows them
   *  (source novels). Omit for local EPUBs — Contents stays ungrouped. */
  tocVolumes?: TocVolume[];
  /** Whether the NEXT chapter is already on the device, shown on the
   *  end-of-chapter card because it predicts whether the turn will wait.
   *  Omit when unknown — the card then says nothing rather than guessing. */
  nextChapterAvailability?: "device" | "online";
  /** Navigate to the top-level Settings page (from the quick-panel link). */
  onOpenFullSettings?: () => void;
  /** DOCX only — the reading-mode toggle, forwarded to the shared settings
   *  panel. Absent for PDF and EPUB, which have no second mode. */
  docxMode?: "pages" | "flow";
  onDocxModeChange?: (mode: "pages" | "flow") => void;
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

/** The phone reader's own chrome. Its reading column is padded 44px at
 *  each end (see the scroller below); the desktop's 66/65 bars are a
 *  different shape, and clamping a toolbar to the wrong ones parks it
 *  inside the text. */
const MOBILE_READING_INSETS = { top: 44, bottom: 44 };

/**
 * The top bar's vertical geometry, as numbers that have to move together.
 *
 * The bar overlays the scroller rather than displacing it, so the scroller's
 * top inset is the ONLY thing holding the first line out from under the bar
 * — and it has to be a constant rather than a padding that appears with the
 * bar, for the reflow reason on the scroller below. Two independent magic
 * numbers is precisely how that drifts: grow the bar, forget the inset, and
 * the previous-chapter link goes back under the glass. So the inset is
 * derived here instead of written down twice.
 *
 * All of these sit ON TOP of `env(safe-area-inset-top)`, which is the status
 * bar's own claim and is added at both call sites.
 */
/** Air between the status bar and the bar's first row of controls. */
export const CHROME_AIR_TOP = 8;
/** The bar's content box under that air — the control row, the title block,
 *  and the 10px that closes the bar off. Measured, not derived: the chrome
 *  font is fixed, so it does not move. */
export const CHROME_CONTENT_H = 86;
/** Gap between the underside of the bar and the first line of the page. */
export const CHROME_CLEARANCE = 8;
/** What the scroller reserves at the top, over the safe-area inset. */
export const READING_INSET_TOP =
  CHROME_AIR_TOP + CHROME_CONTENT_H + CHROME_CLEARANCE;

/** A control standing on the reading surface, as opposed to the surface
 *  itself. Tapping one is a request to use it, never to toggle the chrome —
 *  see the reading surface's `onClick`. */
const PAGE_CONTROL = 'button, a, [role="button"], [data-h-id]';

export function MobileReader({
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
  tocVolumes,
  nextChapterAvailability,
  onOpenFullSettings,
  docxMode,
  onDocxModeChange,
  onBack,
}: Props) {
  const { tr, dir, locale } = useI18n();
  // Focus mode is the PERSISTED tweak, the same one the desktop reader uses
  // — not local state. It used to be a `showChrome` boolean that reset to
  // true on every mount, so a reload, a hot update or simply re-opening the
  // book dropped the reader out of the mode with no acknowledgement. A mode
  // you entered on purpose should still be there when you come back.
  const focusOn = t.focusMode;
  const setFocusOn = (next: boolean) => setTweak("focusMode", next);
  // Whether the bars are up right now, OUTSIDE focus mode. Session state, not
  // a tweak: hiding the bars is a gesture made about this sitting with the
  // book, not a preference about the app, so it resets when the reader comes
  // back. It outlives a chapter turn because this component does — a reader
  // who cleared the page and then turned the page has not asked for the
  // furniture back.
  const [barsUp, setBarsUp] = useState(true);
  // Mirrored so the touchmove listener can ask without a dep or a re-subscribe.
  const barsUpRef = useRef(barsUp);
  barsUpRef.current = barsUp;
  const [showProgress, setShowProgress] = useState(true);
  const reduced = useReducedMotion();
  // Top/bottom chrome bars stay mounted and animate via transform + opacity,
  // so the bars leaving is a fade rather than a hard cut. Pointer-events are
  // dropped while hidden so taps fall through to the reader.
  //
  // Two ways to the same bare page, and the difference between them is how you
  // get back: outside focus mode one tap is enough, inside it takes a
  // double-tap. That is what makes focus mode a mode — a stray tap cannot end
  // it — and what keeps the plain toggle as cheap as it should be.
  const chromeHidden = focusOn || !barsUp;
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  /** End focus mode, from wherever. Always lands with the bars up: a reader
   *  who left the mode asked for their controls back, and the one route in
   *  that does not go through here (the header button) is unreachable without
   *  them. Without this, entering focus mode from an already-bare page and
   *  leaving it again gave back a screen just as empty. */
  const leaveFocus = () => {
    setFocusOn(false);
    setBarsUp(true);
    setPillUp(false);
  };
  /** Where the finger landed. The click is the only event that says a gesture
   *  ENDED, and on its own it cannot say WHICH gesture: a tap, a scroll and
   *  the hold that starts a highlight all finish with one. Comparing the two
   *  ends settles it — see reader/chrome/pageTap.ts. */
  const onPagePointerDown = (e: ReactPointerEvent) => {
    pressRef.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  };

  /**
   * A tap on the page takes the chrome away, and brings it back.
   *
   * "The page" is the paper and the type, NOT the things standing on it. The
   * previous-chapter capsule, the end-of-chapter card and a highlight are all
   * children of the scroller, so their tap bubbles up here — and a reader in
   * focus mode who turned a chapter used to get the header and the bottom bar
   * back with it, thrown out of the mode by the one control whose whole job is
   * to keep them reading.
   *
   * Asked of the DOM in one question rather than threaded through each control
   * as `stopPropagation`: a control says it is one in the markup, so this
   * settles the ones that exist and whatever is added next to the foot of a
   * chapter. Narrow on purpose — the paper AROUND a control still toggles, and
   * so does the text.
   */
  const onPageClick = (e: ReactMouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest(PAGE_CONTROL)) return;
    // And the tap that DISMISSES a popover, which lands on plain text, so only
    // the state says what it was for. By now it is set: the handler that sets
    // it ran on the click that opened the popover.
    if (selAnchor || activeHl) return;
    const press = pressRef.current;
    pressRef.current = null;
    const up = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    // Reaching for a highlight is a press that never moves, and a scroll is one
    // that does. Both end in a click, and treating either as a tap took the
    // chrome away every time a reader went to select something.
    if (!isPageTap(press, up)) return;
    if (!focusOn) {
      // One tap, both ways. This is the whole difference from focus mode,
      // which needs two to let go.
      setBarsUp((wasUp) => !wasUp);
      return;
    }
    if (isDoubleTap(lastTapRef.current, up)) {
      lastTapRef.current = null;
      leaveFocus();
      return;
    }
    lastTapRef.current = up;
    // A single tap inside the mode does nothing — deliberately. It used to
    // re-raise the toast, which made the thing a reader saw most of a mode
    // they chose for quiet a message about it. The lock in the corner answers
    // the same question, all the time, silently.
  };

  // The toast, shown on EVERY entry rather than once per install: it carries
  // the exit gesture, and a reader who enters focus mode twice a year needs
  // telling both times. It is NOT re-shown by a tap inside the mode — that
  // made the thing a reader saw most of a mode they chose for quiet.
  //
  // One flag is enough to restart the keyframe: the toast is mounted only
  // while it is up, and the only way in clears it on the way out, so it has
  // always left the tree before it can be asked for again.
  const [pillUp, setPillUp] = useState(false);
  useEffect(() => {
    if (!pillUp) return;
    const id = window.setTimeout(() => setPillUp(false), FOCUS_TOAST_MS);
    return () => window.clearTimeout(id);
  }, [pillUp]);

  const chromeTransition = reduced
    ? "none"
    : `transform ${MOTION.med}ms ${EASE.enter}, opacity ${MOTION.med}ms ${EASE.enter}`;
  const glassTop = glassBar(theme, "top");
  const glassBottom = glassBar(theme, "bottom");

  // Android full screen. The app draws edge-to-edge, so hiding the reader's
  // own bars used to leave the SYSTEM bars painted over the page — the clock
  // and battery icons sat on the first line, with the text running under them.
  // The system bars now go with the chrome. They come back on an edge swipe
  // (transient) or the moment the chrome is tapped back in.
  //
  // Rejects and no-ops everywhere but Android, so no platform check is needed.
  //
  // Keyed to the bars being AWAY, not to focus mode: a reader who tapped the
  // page clear outside focus mode asked for the same thing, and leaving the
  // clock and the nav bar behind on an otherwise bare page is the half-measure
  // this was added to stop.
  useEffect(() => {
    void invoke("set_immersive_mode", { immersive: chromeHidden }).catch(
      () => {},
    );
  }, [chromeHidden]);
  // Leaving the reader always restores them, whatever state the chrome was in.
  // Kept apart from the effect above deliberately: as that one's cleanup it
  // would fire on every toggle, showing the bars again a frame after each
  // request to hide them. Mount-only, so it runs on unmount and nowhere else.
  useEffect(
    () => () => {
      void invoke("set_immersive_mode", { immersive: false }).catch(() => {});
    },
    [],
  );
  const [sheet, setSheet] = useState<ActivePanel>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** A long-press selection owns the pointer. Set by the selection effect,
   *  read by the pan fallback, which must not scroll under a selection. */
  const selectingRef = useRef(false);
  /** The last page tap, for the double-tap test. */
  const lastTapRef = useRef<Tap | null>(null);
  /** Where and when the finger landed, for the test that decides whether the
   *  click it ends with was a tap at all. */
  const pressRef = useRef<Tap | null>(null);
  const resumeRef = useRef(resumeParagraph);
  resumeRef.current = resumeParagraph;
  const resumeOffsetRef = useRef(resumeOffset);
  resumeOffsetRef.current = resumeOffset;
  // The chapter we stepped BACK into, or null. Holds the chapter INDEX rather
  // than a boolean so a request left pending while a streamed chapter is
  // still fetching cannot be spent on whatever chapter the reader moves to
  // next — see landingAppliesTo.
  const landAtStartRef = useRef<number | null>(null);
  // The header's chapter rail, and the same rail pinned to the top of the
  // screen while the chrome is away. See useProgressRails.
  const { progressFillRef, focusFillRef, lastFractionRef, paintProgress } =
    useProgressRails();
  // Content direction — derived from the BOOK's own language, independent of
  // the UI locale above. BookBody sets its own `dir` from this on its own
  // element, so it never inherits from the chrome wrapper below.
  const rtl = isRtlLanguage(book.language);

  // Reading colours come from the theme, full stop. The page sits on the
  // theme's paper with the surround a shade behind it, so the sheet reads as a
  // sheet without needing a border.
  const surfaces = readingSurfaces(theme);
  const contentTheme: Theme = theme;

  // Read by the scroll-to-resume effect so it knows whether the chrome is
  // currently occluding the top of the scroll area. Tracked via a ref so a
  // chrome toggle alone doesn't re-trigger the scroll.
  const showChromeRef = useRef(!chromeHidden);
  showChromeRef.current = !chromeHidden;
  const onParagraphChangeRef = useRef(onParagraphChange);
  onParagraphChangeRef.current = onParagraphChange;

  // useLayoutEffect, not useEffect: positioning has to happen before the
  // browser paints the new chapter. Painting at the top and scrolling
  // afterwards leaves the revealed region unpainted in WKWebView — a chapter
  // that is present and selectable but invisible until something scrolls (see
  // jumpScrollTop). Same shape of bug, same fix, on both readers.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Streamed (source) chapters load their body async, so the paragraphs
    // aren't in the DOM on this effect's first run. Bail until they exist —
    // the chapter content-id dep re-runs this effect once they mount, so
    // resume lands on the saved paragraph instead of falling through to
    // scrollTop = 0 (which dropped the reader at the chapter start).
    if (el.querySelectorAll("[data-p-index]").length === 0) return;
    if (landingAppliesTo(landAtStartRef.current, currentChapter)) {
      // Stepped back a chapter: open it at its beginning, heading and all —
      // NOT at the saved position, which on a chapter already read is
      // wherever the reader left off. Going back is a request to re-read it,
      // so it has to override resume rather than fall through to it.
      // The saved paragraph catches up from the scroll listener this fires.
      landAtStartRef.current = null;
      jumpScrollTop(el, 0);
      return;
    }
    // Resuming at paragraph 0 means "start of chapter" — snap to the very
    // top so the chapter heading BookBody renders above paragraph 0 stays
    // visible. Using offsetTop of p0 would scroll the heading off-screen.
    if (resumeRef.current === 0 && resumeOffsetRef.current <= 0.001) {
      jumpScrollTop(el, 0);
      return;
    }
    const target = el.querySelector<HTMLElement>(
      `[data-p-index="${resumeRef.current}"]`,
    );
    if (!target) {
      jumpScrollTop(el, 0);
      return;
    }
    // The top chrome is position:absolute, so it overlays the scroll area
    // rather than displacing it. When visible, it covers a chunk of the
    // very top — landing scrollTop exactly at target.offsetTop would hide
    // the target's first line behind it. Offset by the chrome's intrinsic
    // height (plus a small visual gap) when it's actually shown.
    const chromeOffset =
      showChromeRef.current && chromeRef.current
        ? chromeRef.current.offsetHeight + 8
        : 0;
    jumpScrollTop(
      el,
      Math.max(
        0,
        restoreScrollTop(
          target.offsetTop,
          target.offsetHeight,
          resumeOffsetRef.current,
        ) - chromeOffset,
      ),
    );
    // book.chapters[currentChapter]?.id changes when a streamed chapter's
    // content is spliced in (its `#0` → `#<n>` id bump), re-running this so
    // resume fires once the paragraphs are actually in the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter, book.id, jumpNonce, book.chapters[currentChapter]?.id]);

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
        let bestEl: HTMLElement | null = null;
        for (const p of ps) {
          const offset = p.getBoundingClientRect().top - containerTop;
          if (offset > 8) break;
          best = Number(p.dataset.pIndex);
          bestEl = p;
        }
        const intoPara = bestEl
          ? paragraphScrollOffset(
              el.scrollTop,
              bestEl.offsetTop,
              bestEl.offsetHeight,
            )
          : 0;
        onParagraphChangeRef.current(best, intoPara);
      }, 250);
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  // Live within-chapter progress for the header bar. Separate from the 250ms
  // paragraph listener (too coarse for a smooth bar) and written imperatively
  // so scrolling never re-renders React.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const paint = () => {
      raf = 0;
      paintProgress(
        chapterScrollFraction(el.scrollTop, el.scrollHeight, el.clientHeight),
      );
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(paint);
    };
    paint();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter, book.id]);

  const chapter = book.chapters[currentChapter] ?? book.chapters[0];
  const chapterCount = book.chapters.length;

  // Chapter landmarks and the bar's own position. The fraction is
  // `chapter / (count - 1)` — chapter 0 at the start, the last chapter at the
  // end — so it round-trips through a seek and a landmark sits exactly where
  // its chapter begins. The drag itself now lives in ReaderProgressBar, which
  // previews under the finger and commits on release; this reader used to
  // carry its own copy of that logic, and the desktop one carried a different
  // copy that committed on every move.
  const chapterAt = (f: number) =>
    Math.min(
      chapterCount - 1,
      Math.max(0, Math.round(f * Math.max(0, chapterCount - 1))),
    );
  const barFraction =
    chapterCount > 1 ? currentChapter / (chapterCount - 1) : 0;
  const ticks =
    chapterCount > 2 && chapterCount - 2 <= MAX_TICKS
      ? Array.from(
          { length: chapterCount - 2 },
          (_, i) => (i + 1) / (chapterCount - 1),
        )
      : [];

  /** Back to this chapter's own opening — the block with its number and
   *  title, not merely scrollTop 0 of whatever is on screen. Smooth, because
   *  the reader asked to travel a known distance within a page they are
   *  already on; a jump here reads as a chapter change. */
  const toTopOfChapter = () => {
    scrollRef.current?.scrollTo({
      top: 0,
      behavior: reduced ? "auto" : "smooth",
    });
  };
  const prevChapter = () => {
    if (currentChapter > 0) onChapterChange(currentChapter - 1);
  };
  /**
   * Back a chapter, landing at its START.
   *
   * Used by the link above the chapter heading. That link NAMES the chapter it
   * leads to, so tapping it reads as "take me to that chapter" — and a chapter
   * begins at its opening block, not three screens past its own title.
   *
   * It has to be an explicit request rather than a plain chapter change: the
   * resume effect would otherwise restore the saved position, which for an
   * already-read chapter is its end.
   */
  const prevChapterAtStart = () => {
    if (currentChapter <= 0) return;
    landAtStartRef.current = currentChapter - 1;
    prevChapter();
  };
  const nextChapter = () => {
    if (currentChapter < chapterCount - 1) onChapterChange(currentChapter + 1);
  };

  // Two mutually-exclusive popovers:
  //   - selAnchor: shown when the user just finished a selection
  //   - activeHl: shown when the user tapped an existing highlight
  // Showing one always clears the other.
  const [selAnchor, setSelAnchor] = useState<SelectionAnchor | null>(null);
  /** The selection's tint and handles, in the scroller's content
   *  coordinates. Derived from `selAnchor` by the layout effect below and
   *  nowhere else. */
  const [selGeom, setSelGeom] = useState<SelectionGeometry | null>(null);
  /** A selection edge is being dragged — the long-press drag, or a handle.
   *  The toolbar stands aside until it is let go. */
  const [selDragging, setSelDragging] = useState(false);
  /** The page is moving under an open toolbar. */
  const [pageMoving, setPageMoving] = useState(false);
  const [activeHl, setActiveHl] = useState<{
    highlight: Highlight;
    rect: DOMRect;
  } | null>(null);
  /** The handle being dragged: the selection edge that stays put, and the
   *  offset from the finger to the caret it is moving (see onHandleDown). */
  const handleDragRef = useRef<{
    pointerId: number;
    fixed: TextEndpoint;
    dx: number;
    dy: number;
  } | null>(null);
  // Swallow the click that a custom-selection gesture ends with. The
  // browser synthesizes one on pointerup; without this guard the
  // document-level click listener would treat it as an outside-tap and
  // dismiss the just-set selection.
  //
  // A deadline rather than a "skip the next click" flag. A long press often
  // ends in NO click — the platform turns a held touch into a long-press
  // gesture, not a tap — and a flag left armed by it swallowed the reader's
  // next real tap instead, so the selection could not be dismissed.
  const suppressClickUntilRef = useRef(0);
  const CLICK_AFTER_UP_MS = 350;

  // Custom long-press + drag selection on mobile. Replaces native
  // selection so the OS toolbar (which we can't suppress on Samsung
  // One UI) never has a live window selection to anchor to.
  //
  // The reading surface is touch-action: pan-y (`data-pan-scroller`), so
  // the browser handles vertical scroll natively with momentum. The
  // preventDefault on pointermove below cannot stop that — a pointer event
  // does not cancel a scroll. A drag that goes vertical after the long-press
  // is taken by the browser (pointercancel), which ends the selection drag;
  // the handles then take over.
  useEffect(() => {
    // Our OWN body, not the document's first: during a layout-flip crossfade
    // the outgoing DesktopReader is still mounted, earlier in the DOM, and
    // this effect runs once — bound to that, nothing here ever selects.
    const bodyEl =
      rootRef.current?.querySelector<HTMLElement>("[data-book-body]") ?? null;
    if (!bodyEl) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let longPressTimer: number | null = null;
    // The long-pressed word. It is a minimum: while the finger sits inside
    // it the selection is left alone, and movement past either side
    // extends in that direction, whole words at a time.
    let wordStart: TextEndpoint | null = null;
    let wordEnd: TextEndpoint | null = null;

    const select = (range: Range) => {
      const anchor = anchorFromRange(range);
      if (!anchor) return;
      setSelAnchor(anchor);
      setActiveHl(null);
    };

    const startSelection = (cx: number, cy: number) => {
      const ep = caretInBody(bodyEl, cx, cy);
      if (!ep) return false;
      const [ws, we] = wordAround(ep.node.data, ep.offset);
      if (ws === we) return false;
      wordStart = { node: ep.node, offset: ws };
      wordEnd = { node: ep.node, offset: we };
      select(buildRange(wordStart, wordEnd));
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
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-h-id]")) return;
      // On the text. A hold on a heading, a figure or the paper between
      // paragraphs is not a request to select the nearest word.
      if (!target?.closest("p[data-p-index]")) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      selectingRef.current = false;
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
          selectingRef.current = true;
          setSelDragging(true);
        }
      }, LONG_PRESS_MS);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!selectingRef.current) {
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
      if (!wordStart || !wordEnd) return;
      const hit = caretInBody(bodyEl, e.clientX, e.clientY);
      if (!hit) return;
      let from = wordStart;
      let to = wordEnd;
      if (comesBefore(hit, wordStart)) from = snapEndpoint(hit, "start");
      else if (comesBefore(wordEnd, hit)) to = snapEndpoint(hit, "end");
      const range = buildRange(from, to);
      if (!range.collapsed) select(range);
      e.preventDefault();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      cancelLongPressTimer();
      if (selectingRef.current) {
        try {
          bodyEl.releasePointerCapture(e.pointerId);
        } catch {
          // already released
        }
        // Only a real release is followed by a click; a cancel (the
        // browser took the drag for a scroll) is not.
        if (e.type === "pointerup") {
          suppressClickUntilRef.current = e.timeStamp + CLICK_AFTER_UP_MS;
        }
        setSelDragging(false);
      }
      pointerId = null;
      selectingRef.current = false;
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

  // The swipes the browser will not scroll — see reader/scroll/touchPan.ts.
  // A swipe whose first few pixels lean sideways (pan-y drops it), and one
  // that starts on the floating bars, which are not inside the scroller. Both
  // used to move the page 0px for the whole gesture: measured on the emulator,
  // a 46-degree start, and ANY swipe starting in the top 106px or bottom 124px
  // of a 915px screen. Every other swipe stays native. The scroller and the
  // bars say which is which in the markup (`data-pan-scroller`,
  // `data-pan-zone`).
  useEffect(() => {
    const root = rootRef.current;
    const scroller = scrollRef.current;
    if (!root || !scroller) return;
    return attachTouchPanFallback(
      root,
      scroller,
      () => selectingRef.current || handleDragRef.current !== null,
    );
  }, []);

  // The phone layout also runs in a narrow desktop window, where a mouse
  // wheel jumps the page a few lines per notch. Smoothed there exactly as in
  // the desktop reader; on a phone no wheel ever arrives.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    return attachSmoothWheel(scroller, { reducedMotion: isReducedMotion });
  }, []);

  // Scrolling the page takes the bars with it. Reading is the gesture; the
  // furniture is what you ask for in between, and a reader who has started
  // moving down the page has stopped asking.
  //
  // Driven by the finger (`touchmove`) rather than by the `scroll` event,
  // which the reader does not own: `jumpScrollTop` deliberately nudges the
  // scroller a pixel and back after every chapter turn (to make WKWebView
  // paint), and the resume effect scrolls on mount. Both would read as the
  // reader scrolling, so the bars would vanish on their own the moment a book
  // opened. A fling is covered — it begins with a real touchmove.
  //
  // In focus mode this is already true and `setBarsUp(false)` is a no-op React
  // bails out of; leaveFocus puts them back up either way.
  useEffect(() => {
    const root = rootRef.current;
    const scroller = scrollRef.current;
    if (!root || !scroller) return;
    const onTouchMove = (e: TouchEvent) => {
      // Already away. Returning here rather than leaning on React to bail out
      // of an unchanged `setState`: its cheap path needs the fiber to have no
      // pending work, and the one flip that matters schedules a render over
      // this whole component — so every touchmove landing in that window
      // would buy another full pass to compute the same `false`. Scroll is
      // the one gesture this reader refuses to do React work on.
      if (!barsUpRef.current) return;
      // A long-press drag is extending a selection, not scrolling — the page
      // is not moving, and the reader is working with the text, not past it.
      if (selectingRef.current) return;
      const target = e.target as Element | null;
      if (!target || !movesThePage(scroller, target)) return;
      setBarsUp(false);
    };
    // On the ROOT, not the scroller: the bars are `data-pan-zone` elements
    // OUTSIDE it, and the pan fallback scrolls the page for a swipe that
    // starts on one. Listening on the scroller alone left the bars up for
    // exactly the swipe that began on them.
    root.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => root.removeEventListener("touchmove", onTouchMove);
  }, []);

  // Handle drags. A handle moves one edge of the selection; the other edge
  // (`fixed`) stays where it was, and the moving one may cross it — the
  // range is rebuilt from the two every move, so start and end simply
  // trade places.
  //
  // Mounted while handles are up, NOT keyed to where they are: the geometry
  // changes every drag frame, and re-registering document listeners that
  // often dropped moves.
  const handlesUp = selAnchor !== null && selGeom !== null;
  useEffect(() => {
    if (!handlesUp) return;
    const bodyEl =
      rootRef.current?.querySelector<HTMLElement>("[data-book-body]") ?? null;
    const scroller = scrollRef.current;
    if (!bodyEl || !scroller) return;

    let last: { x: number; y: number } | null = null;
    let raf = 0;

    const extendTo = (x: number, y: number) => {
      const drag = handleDragRef.current;
      if (!drag) return;
      // Asked at the CARET, not at the finger: the grip hangs off the line,
      // so the finger is most of a line away from the edge it moves.
      const hit = caretInBody(bodyEl, x + drag.dx, y + drag.dy);
      if (!hit) return;
      const forward = !comesBefore(hit, drag.fixed);
      const moving = snapEndpoint(hit, forward ? "end" : "start");
      const range = buildRange(drag.fixed, moving);
      if (range.collapsed) return;
      const anchor = anchorFromRange(range);
      if (anchor) setSelAnchor(anchor);
    };

    // A handle held near the top or bottom of the reading region scrolls
    // the page towards it, faster the closer it is to the edge, and keeps
    // extending the selection as text comes past.
    const edgeScroll = () => {
      raf = 0;
      if (!handleDragRef.current || !last) return;
      const r = scroller.getBoundingClientRect();
      const top = r.top + MOBILE_READING_INSETS.top + EDGE_SCROLL_ZONE;
      const bottom = r.bottom - MOBILE_READING_INSETS.bottom - EDGE_SCROLL_ZONE;
      const depth =
        last.y < top
          ? -(top - last.y) / EDGE_SCROLL_ZONE
          : last.y > bottom
            ? (last.y - bottom) / EDGE_SCROLL_ZONE
            : 0;
      if (depth === 0) return;
      const step =
        Math.sign(depth) *
        Math.max(2, Math.round(EDGE_SCROLL_MAX * Math.min(1, Math.abs(depth))));
      const before = scroller.scrollTop;
      scroller.scrollTop = before + step;
      if (scroller.scrollTop === before) return; // at an end of the chapter
      extendTo(last.x, last.y);
      raf = requestAnimationFrame(edgeScroll);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== handleDragRef.current?.pointerId) return;
      last = { x: e.clientX, y: e.clientY };
      extendTo(e.clientX, e.clientY);
      if (!raf) raf = requestAnimationFrame(edgeScroll);
      e.preventDefault();
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== handleDragRef.current?.pointerId) return;
      if (e.type === "pointerup") {
        suppressClickUntilRef.current = e.timeStamp + CLICK_AFTER_UP_MS;
      }
      handleDragRef.current = null;
      last = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      setSelDragging(false);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [handlesUp]);

  const onHandleDown = (
    which: "start" | "end",
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selAnchor) return;
    // The edges from the stored segments rather than from refs kept since
    // the gesture: they survive the paragraph re-rendering underneath.
    const range = rangeForSegments(selAnchor.segments);
    if (!range) return;
    const start = {
      node: range.startContainer as Text,
      offset: range.startOffset,
    };
    const end = { node: range.endContainer as Text, offset: range.endOffset };
    if (
      start.node.nodeType !== Node.TEXT_NODE ||
      end.node.nodeType !== Node.TEXT_NODE
    ) {
      return;
    }
    // Where the caret this handle moves is, against where the finger came
    // down. Every move is then asked at finger + this offset: the edge stays
    // under the bar, not under the thumb a line below it — which is what
    // used to drop a paragraph's end into the next paragraph's start the
    // moment the end handle was touched.
    const bar = (
      e.currentTarget.parentElement ?? e.currentTarget
    ).getBoundingClientRect();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety; the document listeners still see the drag.
    }
    handleDragRef.current = {
      pointerId: e.pointerId,
      fixed: which === "start" ? end : start,
      dx: bar.left + bar.width / 2 - e.clientX,
      dy: bar.top + bar.height / 2 - e.clientY,
    };
    setSelDragging(true);
  };

  // The selection's geometry, measured whenever there is a new selection or
  // the text reflows (a resize, a font change). Never on scroll — it is drawn
  // in the scroller's own coordinates and moves with the text by itself.
  //
  // If the paragraphs have gone (chapter turned), the last geometry is left
  // alone and the dismissal paths take over.
  useLayoutEffect(() => {
    if (!selAnchor) {
      setSelGeom(null);
      return;
    }
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => {
      const range = rangeForSegments(selAnchor.segments);
      if (!range) return;
      const next = measureSelection(range, contentOrigin(scroller));
      if (!next) return;
      setSelGeom((prev) => (sameGeometry(prev, next) ? prev : next));
    };
    measure();
    const bodyEl = scroller.querySelector<HTMLElement>("[data-book-body]");
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (ro && bodyEl) ro.observe(bodyEl);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [selAnchor]);

  // While a toolbar is open, note when the page is moving under it. It
  // stands aside for the scroll and comes back once the page is still —
  // following a compositor scroll from the main thread, it trailed the text.
  // Only two renders a scroll: one as it starts, one as it settles.
  const popoverOpen = selAnchor !== null || activeHl !== null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!popoverOpen || !el) return;
    let timer = 0;
    let moving = false;
    const onScroll = () => {
      // The edge scroll of a handle drag is the drag's own; the toolbar is
      // already aside for it.
      if (handleDragRef.current) return;
      if (!moving) {
        moving = true;
        setPageMoving(true);
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        moving = false;
        setPageMoving(false);
      }, SCROLL_SETTLE_MS);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
      setPageMoving(false);
    };
  }, [popoverOpen]);

  // All popover dismissal flows through clicks: tap an existing
  // highlight to open its action popover, tap outside everything to
  // dismiss. We deliberately don't use selectionchange — the
  // note-editor textarea fires it on every keystroke, which would
  // tear the popover down mid-typing.
  const highlightById = (id: string) =>
    state.highlights.find((h) => h.id === id);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.timeStamp < suppressClickUntilRef.current) {
        // The synthetic click a custom-selection gesture ends with.
        suppressClickUntilRef.current = 0;
        return;
      }
      // composedPath snapshots the ancestor chain at dispatch time —
      // robust against post-dispatch DOM mutations (e.g. clicking the
      // pencil button swaps it for a textarea before this handler
      // runs, leaving target.closest() walking a detached subtree).
      const path = (e.composedPath?.() ?? []) as EventTarget[];
      const inPopover = path.some(
        (node) =>
          node instanceof HTMLElement && node.dataset.popover === "highlight",
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
    handleDragRef.current = null;
    setSelDragging(false);
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

  return (
    <div
      ref={rootRef}
      // Reader CHROME follows the UI language (toolbars, sheet all mirror
      // under Arabic). Book CONTENT direction is independent — BookBody
      // sets its own `dir` from the book's language on its own element
      // below, overriding this cascade for its subtree regardless of what
      // `dir` resolves to here.
      dir={dir}
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
        ref={chromeRef}
        className={glassTop.className}
        aria-hidden={chromeHidden}
        // A swipe that starts on the bar scrolls the page, although the bar is
        // not inside the scroller — see reader/scroll/touchPanFallback.ts.
        data-pan-zone
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: Z.readerChrome,
          padding: `calc(env(safe-area-inset-top, 12px) + ${CHROME_AIR_TOP}px) 14px 10px`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          // Frosted, so the paragraph passing under the bar stays visible
          // instead of being clipped off by an opaque strip — see
          // reader/chrome/glass.ts.
          ...glassTop.style,
          transform: chromeHidden ? "translateY(-100%)" : "translateY(0)",
          opacity: chromeHidden ? 0 : 1,
          transition: chromeTransition,
          pointerEvents: chromeHidden ? "none" : "auto",
        }}
      >
        <ChapterProgressBar fillRef={progressFillRef} theme={theme} rtl={rtl} />
        <button
          onClick={onBack}
          style={{ ...mobileTab(theme), width: 36, height: 36 }}
          aria-label={tr("reader.backToLibrary")}
        >
          {/* `home`, not a back arrow: the other two readers have always used
                it, and this button leaves the reader for the library rather
                than stepping back through history. */}
          <Icon name="home" size={16} />
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
            // Inherits FONT_STACKS.sans (Readex Pro) from the chrome
            // wrapper — same UI font used by panel headers / bottom
            // tabs, and renders Arabic glyphs natively instead of
            // through Fraunces' Latin-shaped italic.
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: theme.ink,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "100%",
            }}
          >
            {book.title || tr("common.untitled")}
          </div>
          <div style={{ fontSize: 10, color: theme.muted }}>
            {tr("reader.chapterOfTotal", {
              n: currentChapter + 1,
              total: chapterCount,
            })}
          </div>
        </div>
        {/* The way IN to focus mode, in the corner opposite the home button.
              That corner was an aria-hidden spacer whose only job was keeping
              the title centred on the BAR rather than on the space left beside
              the back button — so the control costs no layout at all: it is
              the same 36px box, now with something in it, and the title stays
              centred for the same reason it was before.

              Not a sixth tab in the bottom row: that row is shared with the
              fixed-page reader, which has its own focus control already.

              36px of ink, 44px of target. The negative margin gives back the
              8px the padding takes, so the row's metrics are unchanged. */}
        <button
          onClick={() => {
            setFocusOn(true);
            // Entering is "just the book": a sheet left open would float over
            // a chrome-less page with no way back to its own controls.
            setSheet(null);
            setPillUp(true);
          }}
          aria-label={tr("reader.focusMode")}
          style={{
            ...mobileTab(theme),
            width: 36,
            height: 36,
            padding: 4,
            margin: -4,
            boxSizing: "content-box",
            flexShrink: 0,
          }}
        >
          <Icon name="focus" size={16} />
        </button>
      </div>

      <div
        ref={scrollRef}
        // touch-action: pan-y, for the whole page rather than just the text,
        // so a swipe that leans sideways is declined the same way wherever it
        // starts and the pan fallback scrolls it (global.css).
        data-pan-scroller
        onPointerDown={onPagePointerDown}
        onClick={onPageClick}
        style={{
          flex: 1,
          overflow: "auto",
          background: surfaces.page,
          // Padding stays constant whether chrome is shown or hidden —
          // the chrome bars are absolutely positioned and act as a
          // translucent overlay (iOS Books / Kindle style). Swapping
          // padding on toggle was reflowing the visible lines and
          // moving the user's reading position.
          // Horizontal inset scales with the content-width setting so 100%
          // actually reaches the edges — see readingGutter. Vertical padding
          // stays constant per the note above.
          //
          // The TOP inset clears the top chrome rather than merely spacing
          // the text. Because the bar overlays the scroll area, 44px put the
          // first thing in the chapter — the previous-chapter link — entirely
          // underneath it: measured, a 98px bar over a capsule spanning
          // 44–85px, so toggling the chrome on hid the control completely.
          // It has to be a constant, not a padding that appears with the bar,
          // for the reflow reason above.
          //
          // READING_INSET_TOP + env() tracks the bar exactly, because it is
          // built from the bar's own parts — see the note there. Both sides
          // carry the same env(), so this stays CHROME_CLEARANCE clear of the
          // bar on a notched phone and on the emulator alike; a flat number
          // would be right on one and wrong on the other.
          padding: `calc(env(safe-area-inset-top, 12px) + ${READING_INSET_TOP}px) ${readingGutter(
            t.contentWidth,
            8,
            28,
          )}px 44px`,
          position: "relative",
        }}
        className="no-scrollbar"
        // `no-scrollbar` only suppresses the NATIVE bar. The app also paints
        // its own floating thumb over every scroller that has not opted out,
        // and on a phone that is a second progress indicator drawn down the
        // edge of the page — redundant beside the chapter rail, and furniture
        // in a mode meant to have none. The desktop reader opts out too.
        data-no-overlay-scrollbar
      >
        {currentChapter > 0 ? (
          <ChapterStartLink
            theme={theme}
            tr={tr}
            compact
            prevNumber={currentChapter}
            prevTitle={book.chapters[currentChapter - 1]?.title ?? ""}
            onPrev={prevChapterAtStart}
          />
        ) : null}
        <BookBody
          bookId={book.id}
          chapter={chapter}
          theme={contentTheme}
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
          paragraphSpacing={t.paragraphSpacing}
          hyphenation={t.hyphenation}
          language={book.language}
          widthPercent={t.contentWidth}
          selectable={false}
          compact
        />
        {/* Tap only, by design. The phone reader has no edge-scroll turn and
            must not get one: touch momentum keeps delivering scroll events
            after the finger has left the glass, which is how a single flick
            used to cross three chapters. */}
        <ChapterEndCard
          theme={theme}
          tr={tr}
          compact
          nextTitle={book.chapters[currentChapter + 1]?.title ?? null}
          nextNumber={currentChapter + 2}
          total={chapterCount}
          availability={nextChapterAvailability}
          fontFamily={readingStack(t.fontFamily)}
          script={rtl ? "arabic" : "latin"}
          onNext={nextChapter}
          onOpenToc={() => setSheet("toc")}
          onTopOfChapter={toTopOfChapter}
        />
        {selAnchor && selGeom && (
          <SelectionLayer
            geometry={selGeom}
            dragging={selDragging}
            onHandleDown={onHandleDown}
          />
        )}
      </div>

      {/* The system's swipe-up edge. Reading is full screen, and Android
          hands an edge swipe in full screen to the APP as well as using it
          to bring the system bars back — so a swipe up to leave the app
          arrived here as a hard flick and threw the page a screen or more
          down the chapter. Nothing on the page scrolls from this strip:
          `touch-action: none` keeps the browser off it, and it is neither
          the scroller nor a pan zone, so the pan fallback ignores it too.
          A tap still counts as a tap on the page.

          Only in full screen on a touch screen. With the bars up the system
          bars are showing and take their own swipes, and the strip would
          sit over the bottom of the tab bar; with a mouse there is no edge
          swipe, and a wheel over the strip would not scroll the page. */}
      {chromeHidden && coarsePointer && (
        <div
          aria-hidden
          data-system-edge
          onPointerDown={onPagePointerDown}
          onClick={onPageClick}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: `max(env(safe-area-inset-bottom, 0px), ${SYSTEM_EDGE_PX}px)`,
            touchAction: "none",
            zIndex: Z.readerChrome + 1,
          }}
        />
      )}

      {/* Bottom chrome — same always-mounted pattern as the top bar.
          Slides down off-screen when hidden and gives up pointer events. */}
      <div
        className={glassBottom.className}
        aria-hidden={chromeHidden}
        // Right where a thumb starts an upward flick — see the top bar.
        data-pan-zone
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: Z.readerChrome,
          padding: "14px 20px calc(env(safe-area-inset-bottom, 0px) + 16px)",
          color: theme.chromeInk,
          ...glassBottom.style,
          transform: chromeHidden ? "translateY(100%)" : "translateY(0)",
          opacity: chromeHidden ? 0 : 1,
          transition: chromeTransition,
          pointerEvents: chromeHidden ? "none" : "auto",
        }}
      >
        {showProgress && (
          <ReaderProgressBar
            theme={theme}
            rtl={dir === "rtl"}
            fraction={barFraction}
            formatPct={(f) => `${formatNum(Math.round(f * 100), locale)}%`}
            formatLabel={(f) =>
              tr("reader.chapterDash", {
                n: formatNum(chapterAt(f) + 1, locale),
                title: book.chapters[chapterAt(f)]?.title ?? "",
              })
            }
            ticks={ticks}
            prevLabel={tr("reader.prevChapter")}
            nextLabel={tr("reader.nextChapter")}
            onPrev={prevChapter}
            onNext={nextChapter}
            prevDisabled={currentChapter === 0}
            nextDisabled={currentChapter >= chapterCount - 1}
            // No `onScrub`: the reader stays put while the finger moves, so a
            // sweep across the book doesn't load every chapter it crosses.
            // The handle and the chip preview the target; release commits.
            onSeek={(f) => {
              const next = chapterAt(f);
              if (next !== currentChapter) onChapterChange(next);
            }}
            ariaLabel={tr("reader.chapterProgress")}
            valueMin={1}
            valueMax={Math.max(1, chapterCount)}
            valueNow={currentChapter + 1}
            valueText={chapter.title}
            reducedMotion={reduced}
            labelWidth={0}
            padding="0 6px 6px"
          />
        )}
        <ReaderTabBar
          theme={theme}
          active={
            sheet === "toc" ||
            sheet === "highlights" ||
            sheet === "progress" ||
            sheet === "settings"
              ? sheet
              : null
          }
          onOpen={setSheet}
          showProgress={showProgress}
          onToggleProgress={() => setShowProgress((s) => !s)}
        />
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
            ? tr("reader.toc")
            : sheet === "settings"
              ? tr("reader.readingSettings")
              : sheet === "highlights"
                ? tr("reader.highlights")
                : sheet === "progress"
                  ? tr("reader.readingProgress")
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
              volumes={tocVolumes}
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
              docxMode={docxMode}
              onDocxModeChange={onDocxModeChange}
              theme={theme}
              themeKey={themeKey}
              t={t}
              setTweak={setTweak}
              onClose={() => setSheet(null)}
              width="100%"
              side={undefined}
              mobile
              onOpenFullSettings={
                onOpenFullSettings
                  ? () => {
                      setSheet(null);
                      onOpenFullSettings();
                    }
                  : undefined
              }
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
        <SelectionPopover
          theme={theme}
          anchor={{
            // No live branch here, unlike the desktop reader: this one
            // renders BookBody with `selectable={false}`, so its selection
            // lives in React state and never on `window.getSelection()`.
            // It also keeps this snapshot fresh itself, re-resolving the
            // anchor on every pointermove of the drag, so there is nothing
            // stale for a live read to correct.
            getAnchor: () => rectForSegments(selAnchor.segments),
            placement: "below",
            insets: MOBILE_READING_INSETS,
            // Clear of the handles' dots, which hang past the lines.
            gap: HANDLE_CLEARANCE,
            held: selDragging || pageMoving,
          }}
          onPick={(color) => createFromSelection(color)}
          onAddNote={(color, note) => createFromSelection(color, note)}
          onCopy={() => copySelection(selAnchor)}
          onDismiss={dismissSelection}
        />
      )}
      {activeHl && (
        <HighlightActionPopover
          theme={theme}
          themeKey={themeKey}
          highlight={activeHl.highlight}
          anchor={{
            getAnchor: () => rectForMark(activeHl.highlight.id),
            insets: MOBILE_READING_INSETS,
            held: pageMoving,
          }}
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
      {/* Focus mode's only furniture. Mounted just while the chrome is away,
          so the header's own rail is never doubled. */}
      {chromeHidden && (
        <FocusRail
          fillRef={focusFillRef}
          theme={theme}
          rtl={rtl}
          initialFraction={lastFractionRef.current}
        />
      )}
      {focusOn && (
        <FocusLock
          theme={theme}
          label={tr("reader.exitFocusMode")}
          onExit={leaveFocus}
        />
      )}
      {focusOn && pillUp && (
        <FocusPill
          theme={theme}
          title={tr("reader.focusMode")}
          hint={tr("reader.focusExitHint")}
          reduced={reduced}
        />
      )}
    </div>
  );
}
