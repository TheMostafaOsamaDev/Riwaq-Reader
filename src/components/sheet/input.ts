// The DOM side of a bottom sheet's input: turns touch, mouse, wheel and click
// events on the sheet box into SheetController calls. Kept apart from the
// engine so the engine reads as gesture rules and motion only, and can be
// driven directly by tests.

/** A finger (or the mouse) landing on the sheet. */
export interface TouchPoint {
  id: number;
  x: number;
  y: number;
  /** performance.now() time base, ms. */
  t: number;
  target: Element;
  /** A mouse drag: accepted on the sheet's chrome only. */
  mouse?: boolean;
}

/** A move of a tracked finger. */
export interface MovePoint {
  id: number;
  x: number;
  y: number;
  t: number;
  /** Whether this move can still be cancelled; once the browser has started
   *  a native scroll it cannot. */
  cancelable: boolean;
}

/** What the input layer needs from the engine. */
export interface SheetInput {
  touchStart(p: TouchPoint): void;
  /** True when the caller must preventDefault the move. */
  touchMove(p: MovePoint): boolean;
  touchEnd(p: { id: number; t: number }): void;
  /** Forget a gesture whose end never arrived. */
  abandonGesture(): void;
  /** True when the caller must preventDefault the wheel event. */
  wheel(deltaY: number, target: Element): boolean;
  /** One-shot: true for the first click inside the window after a drag. */
  suppressesClick(t: number): boolean;
}

const MOUSE_ID = -1;

/** Listen on `box` (never on document or window, except window during a
 *  mouse drag) and feed `sheet`. Returns the cleanup. */
export function bindSheetInput(
  box: HTMLElement,
  sheet: SheetInput,
): () => void {
  const listeners = new AbortController();
  const signal = listeners.signal;
  let mouseDrag: AbortController | null = null;

  /** The changed touch that belongs to the gesture in progress, if any.
   *  Synthetic touch events (tests, other code poking the reader) can come
   *  without touch lists; they are not gestures. */
  const changedTouch = (e: TouchEvent): Touch | null =>
    e.changedTouches?.[0] ?? null;

  box.addEventListener(
    "touchstart",
    (e) => {
      const t = changedTouch(e);
      if (!t) return;
      // The only finger down: any gesture still open lost its touchend (a
      // virtual list recycled the row it was sent to) and must not lock out
      // this one.
      if (e.touches?.length === 1) sheet.abandonGesture();
      sheet.touchStart({
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        t: performance.now(),
        target: e.target as Element,
      });
    },
    { passive: true, signal },
  );
  // The one blocking listener: it must be able to preventDefault the first
  // move of a gesture the sheet owns. On the sheet, never on document, and
  // only while the sheet is mounted.
  box.addEventListener(
    "touchmove",
    (e) => {
      for (const t of Array.from(e.changedTouches ?? [])) {
        const claimed = sheet.touchMove({
          id: t.identifier,
          x: t.clientX,
          y: t.clientY,
          t: performance.now(),
          cancelable: e.cancelable,
        });
        if (claimed && e.cancelable) e.preventDefault();
      }
    },
    { passive: false, signal },
  );
  const end = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches ?? [])) {
      sheet.touchEnd({ id: t.identifier, t: performance.now() });
    }
  };
  box.addEventListener("touchend", end, { passive: true, signal });
  box.addEventListener("touchcancel", end, { passive: true, signal });

  box.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      sheet.touchStart({
        id: MOUSE_ID,
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        target: e.target as Element,
        mouse: true,
      });
      // Follow the drag outside the sheet too, until the button comes up.
      mouseDrag?.abort();
      const drag = new AbortController();
      mouseDrag = drag;
      const move = (ev: PointerEvent) => {
        const claimed = sheet.touchMove({
          id: MOUSE_ID,
          x: ev.clientX,
          y: ev.clientY,
          t: performance.now(),
          cancelable: true,
        });
        if (claimed) ev.preventDefault();
      };
      const up = () => {
        sheet.touchEnd({ id: MOUSE_ID, t: performance.now() });
        drag.abort();
      };
      window.addEventListener("pointermove", move, { signal: drag.signal });
      window.addEventListener("pointerup", up, { signal: drag.signal });
      window.addEventListener("pointercancel", up, { signal: drag.signal });
    },
    { passive: true, signal },
  );
  box.addEventListener(
    "wheel",
    (e) => {
      if (sheet.wheel(e.deltaY, e.target as Element)) e.preventDefault();
    },
    { passive: false, signal },
  );
  box.addEventListener(
    "click",
    (e) => {
      if (sheet.suppressesClick(performance.now())) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true, signal },
  );

  return () => {
    listeners.abort();
    mouseDrag?.abort();
  };
}
