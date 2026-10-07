import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import { clamp01 } from "../../components/readerProgress";
import { gestureAxis } from "../gestureAxis";

/**
 * Dragging along a track to pick a position — the reader's progress slider
 * and the status bar's seek line.
 *
 * The finger previews (`preview`) and the release commits (`onSeek`); an
 * optional `onScrub` follows the finger for callers for whom moving is
 * cheap. Positions are 0..1 in reading order, mirrored for RTL.
 *
 * Both tracks sit where a thumb starts an upward flick, so a TOUCH that goes
 * vertical before it goes sideways was never a scrub: it lets go without
 * seeking and leaves the gesture to the page. Seeking on its release used to
 * jump a long serial several chapters per pixel. A mouse scrubs in any
 * direction.
 */
export function useScrubGesture({
  trackRef,
  rtl,
  onSeek,
  onScrub,
  commitOnCancel,
}: {
  trackRef: RefObject<HTMLElement | null>;
  rtl: boolean;
  onSeek: (fraction: number) => void;
  onScrub?: (fraction: number) => void;
  /** What a cancelled pointer (the system took the touch) does: commit the
   *  position under the finger, or drop the preview. */
  commitOnCancel: boolean;
}) {
  const active = useRef(false);
  /** Where a TOUCH gesture started, until it has picked an axis. */
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  // Where the finger is, while the caller's position may still be behind —
  // callers without `onScrub` deliberately don't move until release.
  const [preview, setPreview] = useState<number | null>(null);

  const ratioFrom = useCallback(
    (clientX: number): number | null => {
      const el = trackRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return null;
      const raw = (clientX - r.left) / r.width;
      return clamp01(rtl ? 1 - raw : raw); // 0 = start of the book either way
    },
    [rtl, trackRef],
  );

  /** End the drag and hand the pointer back. */
  const letGo = (e: ReactPointerEvent<HTMLElement>) => {
    active.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };
  const commit = (e: ReactPointerEvent<HTMLElement>) => {
    if (!active.current) return;
    letGo(e);
    setPreview((f) => {
      if (f !== null) onSeek(f);
      return null;
    });
  };

  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      active.current = true;
      touchStart.current =
        e.pointerType === "touch" ? { x: e.clientX, y: e.clientY } : null;
      const f = ratioFrom(e.clientX);
      if (f === null) return;
      setPreview(f);
      onScrub?.(f);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!active.current) return;
      const start = touchStart.current;
      if (start) {
        const axis = gestureAxis(e.clientX - start.x, e.clientY - start.y);
        if (axis === "y") {
          letGo(e);
          setPreview(null);
          return;
        }
        if (axis === "x") touchStart.current = null; // a scrub from here on
      }
      const f = ratioFrom(e.clientX);
      if (f === null) return;
      setPreview(f);
      onScrub?.(f);
    },
    onPointerUp: commit,
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => {
      if (commitOnCancel) {
        commit(e);
        return;
      }
      letGo(e);
      setPreview(null);
    },
  };

  return { preview, handlers };
}
