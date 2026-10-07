// "8 min left" for the Status line reader bar, the only style that shows it,
// on the phone and on desktop alike.
//
// Recomputed as the chapter scrolls, but it only re-renders when the whole
// number of minutes changes — a few times a chapter, not per frame. The words
// are counted only while the style is on: a whole chapter's text per chapter
// change. Without a scroller (a paginated desktop mode) there is no honest
// position inside the chapter, so it says nothing.

import { type RefObject, useEffect, useMemo, useState } from "react";
import { chapterScrollFraction } from "../components/readerProgress";
import { type EpubChapter, isImageItem } from "../epub/types";
import { minutesLeft, wordCount } from "../reader/chrome/barStyles";

export function useMinutesLeft({
  scrollRef,
  chapter,
  enabled,
  layoutKey,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  chapter: EpubChapter;
  enabled: boolean;
  /** Anything that swaps the scroller out from under the ref (the desktop's
   *  reading mode), so the listener follows it. */
  layoutKey?: unknown;
}): number | null {
  const words = useMemo(
    () =>
      enabled
        ? wordCount(
            chapter.paragraphs.flatMap((p) => (isImageItem(p) ? [] : [p.text])),
          )
        : 0,
    [chapter, enabled],
  );
  const [left, setLeft] = useState<number | null>(null);
  // `layoutKey` re-runs this when the scroller behind the ref is swapped.
  useEffect(() => {
    const el = scrollRef.current;
    if (!enabled || !el) {
      setLeft(null);
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const f = chapterScrollFraction(
        el.scrollTop,
        el.scrollHeight,
        el.clientHeight,
      );
      const m = minutesLeft(words, f);
      setLeft((prev) => (prev === m ? prev : m));
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };
    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [enabled, words, scrollRef, layoutKey]);
  return left;
}
