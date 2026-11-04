import { type RefObject, useCallback, useRef, useState } from "react";
import type { OnParagraphChange } from "../types/reader";
import { MAX_TICKS } from "./chrome/ReaderProgressBar";
import {
  bookProgress,
  chapterAtBookFraction,
  chapterStartTicks,
  wholePercent,
} from "./bookProgress";
import { usePositionReporter } from "./scroll/usePositionReporter";

interface Options {
  scrollRef: RefObject<HTMLElement | null>;
  /** Whether the scroller is what is being read. Desktop passes
   *  `mode === "scroll"`: the paginated modes report through PaginatedView
   *  and feed `reportChapterRead` themselves. */
  scrolling: boolean;
  currentChapter: number;
  chapterCount: number;
  onParagraphChange: OnParagraphChange;
}

/**
 * Where a reflow reader is, for both the host and the reader's own bars.
 *
 * Reports the position to the host as the reader scrolls and once more on
 * the way out (usePositionReporter), carrying the fraction of the chapter
 * read and the book progress it makes. And holds that book progress for the
 * reader's bar, status line and Progress panel, with the bar's chapter
 * landmarks and seeks — all on the scale of reader/bookProgress.ts.
 *
 * Held as a whole percent, so the reader re-renders only when the number on
 * screen changes: in a 1400-chapter web novel a whole percent is fourteen
 * chapters (the same rule as useMinutesLeft).
 */
export function useReadingProgress({
  scrollRef,
  scrolling,
  currentChapter,
  chapterCount,
  onParagraphChange,
}: Options) {
  const [read, setRead] = useState<{ chapter: number; percent: number } | null>(
    null,
  );
  const chapterRef = useRef(currentChapter);
  chapterRef.current = currentChapter;
  // Until the reader reports from this chapter, it is at the chapter's start.
  const percent =
    read && read.chapter === currentChapter
      ? read.percent
      : wholePercent(bookProgress(currentChapter, 0, chapterCount));

  /** Feed a measured fraction of the current chapter read. Stable. */
  const reportChapterRead = useCallback(
    (chapterFraction: number) => {
      const chapter = chapterRef.current;
      const next = wholePercent(
        bookProgress(chapter, chapterFraction, chapterCount),
      );
      setRead((prev) =>
        prev && prev.chapter === chapter && prev.percent === next
          ? prev
          : { chapter, percent: next },
      );
    },
    [chapterCount],
  );

  usePositionReporter({
    scrollRef,
    enabled: scrolling,
    onReport: (at, final) => {
      reportChapterRead(at.chapterFraction);
      onParagraphChange(at.idx, at.off, {
        final,
        chapterFraction: at.chapterFraction,
        bookFraction: bookProgress(
          currentChapter,
          at.chapterFraction,
          chapterCount,
        ),
      });
    },
  });

  return {
    percent,
    fraction: percent / 100,
    chapterAt: (f: number) => chapterAtBookFraction(f, chapterCount),
    ticks: chapterStartTicks(chapterCount, MAX_TICKS),
    reportChapterRead,
  };
}
