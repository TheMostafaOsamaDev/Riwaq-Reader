// Whether the chapter's own display title is currently on screen.
//
// Focus mode's running head and the chapter's opening title are the same
// string, so on the page a chapter opens on the name was on screen twice — the
// tracked running head at the top, then the full display title an inch below
// it. A printed book does not repeat a chapter's name on the page it opens on,
// and neither should this: the running head holds back until the display title
// has gone, and the space above the title then reads as a chapter drop rather
// than as the blank band it replaced.
//
// Asked of the DOM with an IntersectionObserver rather than worked out from
// scroll position or page index, because the answer has to be the same in
// three layouts that measure nothing alike: a scroller where the title scrolls
// away, and the two paginated modes where it is translated sideways out of a
// clipped box. "Is this element visible" is one question, and the observer
// answers it for all three — clipping by an ancestor's `overflow` is part of
// what it computes, which is exactly what a paged column relies on.
//
// The head ELEMENT, though, is replaced out from under it: on a chapter change
// (the content is keyed by chapter id) and on a reading-mode switch (the
// scroller and the paged view are different branches). An observer left
// watching the old one gets no further callbacks, because a detached element
// never intersects anything — so the running head silently froze at whatever
// it last was. Rather than ask the caller to list every remount trigger in a
// dependency array, which is what broke, a MutationObserver on the column
// re-attaches whenever the head is swapped. Mutations there are rare (a
// chapter turn, a highlight rendering) and the handler is one querySelector.

import { useEffect, useState, type RefObject } from "react";

export function useChapterHeadShown(
  /** The reading column. Its subtree holds the head in every reading mode. */
  columnRef: RefObject<HTMLElement | null>,
): boolean {
  // Starts true, i.e. "assume the title is up". A chapter is opened at its own
  // head far more often than it is resumed mid-way, and the observer's first
  // callback is a frame away either way: guessing this direction means the
  // common case is right from the first paint, and the other resolves into a
  // 240ms fade-in rather than out of one.
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const root = columnRef.current;
    if (!root) return;
    let io: IntersectionObserver | null = null;
    let watched: Element | null = null;

    const attach = () => {
      const head = root.querySelector("[data-chapter-head]");
      if (head === watched) return;
      io?.disconnect();
      io = null;
      watched = head;
      // No head in the tree — nothing to defer to, so the running head is
      // free to show.
      if (!head) {
        setShown(false);
        return;
      }
      // A head that has just mounted is, near enough always, a chapter that
      // has just been opened at its start. Assume it is up and let the
      // observer correct it, for the same reason the initial state does.
      setShown(true);
      io = new IntersectionObserver(
        ([entry]) => setShown(entry.isIntersecting),
        // Any sliver counts. A title half into the fade is still the title,
        // and a running head arriving over the tail of it is the duplication
        // this exists to avoid.
        { threshold: 0 },
      );
      io.observe(head);
    };

    attach();
    const mo = new MutationObserver(attach);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io?.disconnect();
    };
  }, [columnRef]);

  return shown;
}
