// The phone's own text selection on fixed-layout pages, as a hook of
// FixedPageViewer: long-press a word, drag to extend, let go; two handles then
// move either end. Moved out of the viewer whole — the viewer passes in what it
// owns (its scroller, its page hosts, its turn state) and gets back what it
// draws and what its tap handling needs to know.

import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  caretNear,
  comesBefore,
  orderedRange,
  selectionFromRange,
  type FixedSelection,
} from "./fixedSelection";
import {
  snapEndpoint,
  wordAround,
  type TextEndpoint,
} from "../selection/textCaret";
import {
  contentOrigin,
  measureSelection,
  sameGeometry,
  type SelectionGeometry,
} from "../selection/selectionGeometry";
import { LONG_PRESS_MOVE_TOLERANCE, LONG_PRESS_MS } from "../chrome/pageTap";

/** How far from any text a long-press may land and still select the nearest
 *  word. A hold on a margin or a picture is not a request to select. */
const LONG_PRESS_REACH = 28;
/** The click a custom-selection gesture ends with arrives within this. A
 *  deadline, not a flag: a long press often ends with no click at all, and a
 *  flag left armed swallowed the reader's next real tap (see MobileReader). */
const CLICK_AFTER_UP_MS = 350;
/** Handle drag near the top/bottom of the reading area scrolls the page. */
const EDGE_SCROLL_ZONE = 56;
const EDGE_SCROLL_MAX = 14;

export interface TouchSelectionInputs {
  /** Off on the desktop, which selects natively. */
  enabled: boolean;
  kind: "pdf" | "docx";
  scrollRef: RefObject<HTMLDivElement | null>;
  /** The page hosts on screen, by page index. */
  hostRefs: RefObject<Map<number, HTMLDivElement>>;
  /** What the reader's bars cover, for the handle's edge scroll. */
  insetsRef: RefObject<{ top: number; bottom: number }>;
  /** A page turn is under way — a long-press that lands during one is not
   *  a selection. */
  isTurning: () => boolean;
  /** The viewer's "ignore the click until" deadline, shared with its tap
   *  handling so the click a selection gesture ends with is swallowed. */
  suppressClickUntil: RefObject<number>;
  onSelect: (sel: FixedSelection | null) => void;
  /** Changes whenever the pages re-lay out, to re-measure the selection. */
  layout: unknown;
}

export function useTouchSelection({
  enabled: touchSelect,
  kind,
  scrollRef,
  hostRefs,
  insetsRef,
  isTurning,
  suppressClickUntil,
  onSelect,
  layout,
}: TouchSelectionInputs) {
  // ---- The phone's own selection ---------------------------------------------
  //
  // Long-press a word, drag to extend, let go; two handles then move either
  // end. The selection lives here, as two text endpoints, and is drawn by
  // SelectionLayer inside the scroller — never on `window.getSelection()`, so
  // the system's copy/share toolbar has nothing to anchor to (it used to sit
  // over the page, and over the panels sheet once that opened, because the
  // native selection outlived the gesture). The same model as the EPUB phone
  // reader, with a caret finder for pages instead of paragraphs (caretNear).
  const touchRangeRef = useRef<{ a: TextEndpoint; b: TextEndpoint } | null>(
    null,
  );
  const [touchRange, setTouchRange] = useState<{
    a: TextEndpoint;
    b: TextEndpoint;
  } | null>(null);
  const [selGeom, setSelGeom] = useState<SelectionGeometry | null>(null);
  const [selDragging, setSelDragging] = useState(false);
  /** A long-press drag owns the pointer. */
  const selectingRef = useRef(false);
  /** The handle being dragged: the edge that stays put, and the offset from
   *  the finger to the caret it moves. */
  const handleDragRef = useRef<{
    pointerId: number;
    fixed: TextEndpoint;
    dx: number;
    dy: number;
  } | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const setTouchSelection = useCallback(
    (a: TextEndpoint, b: TextEndpoint) => {
      const range = orderedRange(a, b);
      if (range.collapsed) return;
      const prev = touchRangeRef.current;
      if (
        prev &&
        prev.a.node === a.node &&
        prev.a.offset === a.offset &&
        prev.b.node === b.node &&
        prev.b.offset === b.offset
      ) {
        return;
      }
      touchRangeRef.current = { a, b };
      setTouchRange({ a, b });
      const scroller = scrollRef.current;
      onSelectRef.current(
        scroller ? selectionFromRange(range, scroller, kind) : null,
      );
    },
    [kind],
  );

  const clearTouchSelection = useCallback(() => {
    if (!touchRangeRef.current && !handleDragRef.current) return;
    touchRangeRef.current = null;
    handleDragRef.current = null;
    selectingRef.current = false;
    setTouchRange(null);
    setSelDragging(false);
    onSelectRef.current(null);
  }, []);

  /** The page hosts on screen — where a finger can be in the text. */
  const liveHosts = useCallback(
    () => Array.from(hostRefs.current.values()),
    [],
  );

  // Long-press + drag.
  useEffect(() => {
    if (!touchSelect) return;
    const el = scrollRef.current;
    if (!el) return;
    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let timer: number | null = null;
    // The long-pressed word: a minimum the drag extends from, whole words at
    // a time, in whichever direction the finger goes.
    let wordStart: TextEndpoint | null = null;
    let wordEnd: TextEndpoint | null = null;
    const cancelTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (pointerId !== null) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-selection-handle]")) return;
      if (!target?.closest("[data-fixed-host]")) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      selectingRef.current = false;
      cancelTimer();
      timer = window.setTimeout(() => {
        timer = null;
        // A page turn took the gesture meanwhile.
        if (pointerId === null || isTurning()) return;
        const ep = caretNear(
          liveHosts(),
          kind,
          startX,
          startY,
          LONG_PRESS_REACH,
        );
        if (!ep) return;
        const [ws, we] = wordAround(ep.node.data, ep.offset);
        if (ws === we) return;
        try {
          el.setPointerCapture(pointerId);
        } catch {
          return;
        }
        wordStart = { node: ep.node, offset: ws };
        wordEnd = { node: ep.node, offset: we };
        selectingRef.current = true;
        setSelDragging(true);
        setTouchSelection(wordStart, wordEnd);
      }, LONG_PRESS_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!selectingRef.current) {
        // Moved before the hold landed: a scroll or a turn, not a selection.
        const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (moved > LONG_PRESS_MOVE_TOLERANCE) {
          cancelTimer();
          pointerId = null;
        }
        return;
      }
      if (!wordStart || !wordEnd) return;
      const hit = caretNear(liveHosts(), kind, e.clientX, e.clientY);
      if (!hit) return;
      let from = wordStart;
      let to = wordEnd;
      if (comesBefore(hit, wordStart)) from = snapEndpoint(hit, "start");
      else if (comesBefore(wordEnd, hit)) to = snapEndpoint(hit, "end");
      setTouchSelection(from, to);
      e.preventDefault();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      cancelTimer();
      if (selectingRef.current) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          // already released
        }
        if (e.type === "pointerup")
          suppressClickUntil.current = e.timeStamp + CLICK_AFTER_UP_MS;
        setSelDragging(false);
      }
      pointerId = null;
      selectingRef.current = false;
      wordStart = null;
      wordEnd = null;
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      cancelTimer();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [touchSelect, kind, liveHosts, setTouchSelection]);

  // Handle drags. Mounted while handles are up, not keyed to where they are —
  // re-registering document listeners every drag frame dropped moves.
  const handlesUp = touchRange !== null && selGeom !== null;
  useEffect(() => {
    if (!handlesUp) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    let last: { x: number; y: number } | null = null;
    let raf = 0;
    const extendTo = (x: number, y: number) => {
      const drag = handleDragRef.current;
      if (!drag) return;
      // Asked at the CARET, not the finger: the grip hangs off the line.
      const hit = caretNear(liveHosts(), kind, x + drag.dx, y + drag.dy);
      if (!hit) return;
      const forward = !comesBefore(hit, drag.fixed);
      setTouchSelection(
        drag.fixed,
        snapEndpoint(hit, forward ? "end" : "start"),
      );
    };
    // Held near the top or bottom of the reading area, a handle scrolls the
    // page towards it — the only way to select past the bottom of the glass.
    const edgeScroll = () => {
      raf = 0;
      if (!handleDragRef.current || !last) return;
      const r = scroller.getBoundingClientRect();
      const { top: it, bottom: ib } = insetsRef.current;
      const top = r.top + it + EDGE_SCROLL_ZONE;
      const bottom = r.bottom - ib - EDGE_SCROLL_ZONE;
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
      if (scroller.scrollTop === before) return;
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
      if (e.type === "pointerup")
        suppressClickUntil.current = e.timeStamp + CLICK_AFTER_UP_MS;
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
  }, [handlesUp, kind, liveHosts, setTouchSelection]);

  const onHandleDown = (
    which: "start" | "end",
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const r = touchRangeRef.current;
    if (!r) return;
    const [start, end] = comesBefore(r.b, r.a) ? [r.b, r.a] : [r.a, r.b];
    const bar = (
      e.currentTarget.parentElement ?? e.currentTarget
    ).getBoundingClientRect();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the document listeners still see the drag
    }
    handleDragRef.current = {
      pointerId: e.pointerId,
      fixed: which === "start" ? end : start,
      dx: bar.left + bar.width / 2 - e.clientX,
      dy: bar.top + bar.height / 2 - e.clientY,
    };
    setSelDragging(true);
  };

  // What the selection looks like, measured when it changes or the pages
  // re-lay out. Never on scroll: it is drawn in the scroller's own
  // coordinates and moves with the page by itself.
  useLayoutEffect(() => {
    if (!touchRange) {
      setSelGeom(null);
      return;
    }
    const scroller = scrollRef.current;
    if (!scroller) return;
    // The text under it was rebuilt (a DOCX page re-rendered, a PDF page
    // re-rasterized at a new scale): the endpoints point at nothing.
    if (!touchRange.a.node.isConnected || !touchRange.b.node.isConnected) {
      clearTouchSelection();
      return;
    }
    const next = measureSelection(
      orderedRange(touchRange.a, touchRange.b),
      contentOrigin(scroller),
    );
    if (next) setSelGeom((prev) => (sameGeometry(prev, next) ? prev : next));
  }, [touchRange, layout, clearTouchSelection]);

  return {
    touchRange,
    selGeom,
    selDragging,
    touchRangeRef,
    selectingRef,
    handleDragRef,
    clearTouchSelection,
    onHandleDown,
  };
}
