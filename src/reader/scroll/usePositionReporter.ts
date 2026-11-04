import { useLayoutEffect, useRef, type RefObject } from "react";
import { paragraphScrollOffset } from "../../components/readerProgress";
import { textReadFraction } from "../bookProgress";

/** Scroll events arrive every frame; the position is read at most this often. */
const THROTTLE_MS = 250;

/** Where the reader is: the paragraph at the top of the scroller, how far
 *  into it the top sits, and how much of the chapter's text has been read. */
export interface ReadPosition {
  idx: number;
  off: number;
  chapterFraction: number;
}

/**
 * Where the reader is now. Null while the chapter has no paragraphs (a
 * streamed chapter mounts empty).
 *
 * This is the measurement the resume effects invert (`restoreScrollTop` over
 * the same offsetTop/offsetHeight), so the two must stay exact opposites —
 * see mobileReaderResume.test.tsx.
 */
function measurePosition(el: HTMLElement): ReadPosition | null {
  const ps = el.querySelectorAll<HTMLElement>("[data-p-index]");
  if (ps.length === 0) return null;
  const containerTop = el.getBoundingClientRect().top;
  let best = 0;
  let bestEl: HTMLElement | null = null;
  for (const p of ps) {
    const offset = p.getBoundingClientRect().top - containerTop;
    if (offset > 8) break;
    best = Number(p.dataset.pIndex);
    bestEl = p;
  }
  return {
    idx: best,
    off: bestEl
      ? paragraphScrollOffset(
          el.scrollTop,
          bestEl.offsetTop,
          bestEl.offsetHeight,
        )
      : 0,
    chapterFraction: chapterReadFraction(el),
  };
}

/**
 * 0..1 of the chapter's text read (reader/bookProgress.ts), measured on the
 * page. The book body's last child is its last paragraph, so this is O(1):
 * the header rail asks on every animation frame of a scroll.
 */
export function chapterReadFraction(el: HTMLElement): number {
  const last = el.querySelector("[data-book-body]")?.lastElementChild;
  const end =
    last instanceof HTMLElement && last.dataset.pIndex !== undefined
      ? last.offsetTop + last.offsetHeight
      : null;
  return textReadFraction(el.scrollTop, el.clientHeight, end);
}

interface Options {
  scrollRef: RefObject<HTMLElement | null>;
  /** Desktop passes `mode === "scroll"`; the paginated modes report their own. */
  enabled: boolean;
  /** `final` means the reader is going away — unmounted, switched off, or
   *  the app backgrounded — and the position must be written now. */
  onReport: (at: ReadPosition, final: boolean) => void;
}

/**
 * Reports where the reader is as they scroll, and once more on the way out.
 *
 * The final report exists because the throttled one alone lost positions:
 * back out of the book, or have Android background the app, inside the
 * throttle-plus-debounce window and nothing ever wrote where the reader had
 * scrolled to. See mobileReaderLeave.test.tsx.
 */
export function usePositionReporter({
  scrollRef,
  enabled,
  onReport,
}: Options): void {
  const onReportRef = useRef(onReport);
  onReportRef.current = onReport;

  // Layout effect so the cleanup runs while the page is still laid out: a
  // passive cleanup runs after React has detached the tree, where every rect
  // is zero.
  useLayoutEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const report = (final: boolean) => {
      // Only while this is still the scroller. On a full unmount the cleanup
      // runs before React touches the DOM, so the ref is intact. But when the
      // scroller alone is swapped out (desktop → paginated), React has already
      // detached the ref by now: the node is either gone from the document
      // (every rect zero, so the LAST paragraph wins) or reused, holding the
      // paginated view's columns. Either would be saved as the position.
      if (scrollRef.current !== el || !el.isConnected) return;
      const at = measurePosition(el);
      if (at) onReportRef.current(at, final);
    };
    const onScroll = () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        report(false);
      }, THROTTLE_MS);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") report(true);
    };
    // Closing the desktop window can skip visibilitychange entirely.
    const onPageHide = () => report(true);

    el.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      el.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      if (timer !== null) clearTimeout(timer);
      report(true);
    };
  }, [enabled, scrollRef]);
}
