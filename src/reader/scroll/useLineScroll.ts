import { useEffect, useRef } from "react";
import {
  createLineBank,
  glideFrame,
  measureLineBox,
  wheelDeltaToPixels,
} from "./lineScroll";

/**
 * `wheel`   desktop: the reader owns wheel scrolling, gliding to a target that
 *           always rests on a whole line.
 * `off`     paginated modes, which do not scroll — and mobile, which is left
 *           entirely to the platform.
 */
export type LineScrollMode = "off" | "wheel";

/** Stop the frame loop after this many still frames. */
const IDLE_FRAMES = 12;
/**
 * A scroll position this far from where we last put it came from somewhere
 * else — a chapter turn, the scrubber, a keypress — and the glide must adopt
 * it rather than dragging the reader back.
 */
const EXTERNAL_JUMP_PX = 2;

interface Options {
  scrollRef: React.RefObject<HTMLElement | null>;
  mode: LineScrollMode;
  /** When true, moves land immediately instead of gliding. */
  reducedMotion: boolean;
}

/**
 * Line-aware scrolling for the reading surface. See lineScroll.ts for what
 * this is fixing and the numbers behind it; this file is only the wiring.
 *
 * Desktop only. Mobile used to glide onto the nearest line once a fling had
 * finished, and that is deliberately gone: the whole point of resting on a
 * line is that the reader does not have to notice it happening, and a move
 * that starts AFTER the reader has stopped scrolling is the one move they
 * always notice. Touch scrolling is now the platform's from beginning to end.
 *
 * The line alignment it was buying was mostly illusory anyway — it aimed at a
 * grid computed from scrollTop 0, while paragraph margins (1.1em against a
 * 1.6em line box) push the real lines off that grid from the second paragraph
 * on, so it routinely moved the page to a position no less ragged than the one
 * it started from.
 */
export function useLineScroll({
  scrollRef,
  mode,
  reducedMotion,
}: Options): void {
  const lineBox = useRef(0);
  const target = useRef(0);
  const applied = useRef(0);
  const raf = useRef(0);
  const idle = useRef(0);
  const bank = useRef(createLineBank());
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  useEffect(() => {
    if (mode === "off") return;
    const el = scrollRef.current;
    lineBox.current = measureLineBox(el);
    bank.current.reset();
    if (el) {
      target.current = el.scrollTop;
      applied.current = el.scrollTop;
    }
  }, [mode, scrollRef]);

  const pump = useRef<() => void>(() => {});
  pump.current = () => {
    const el = scrollRef.current;
    if (!el) {
      raf.current = 0;
      return;
    }
    // Adopt any position change that did not come from this loop, so a chapter
    // turn or a TOC jump is never fought.
    if (Math.abs(el.scrollTop - applied.current) > EXTERNAL_JUMP_PX) {
      target.current = el.scrollTop;
      applied.current = el.scrollTop;
      bank.current.reset();
    }
    if (el.scrollTop !== target.current) {
      // glideFrame writes through this setter and reads the position back, so
      // it can tell when a step was too small for the scroller's pixel grain
      // and land instead of stalling short. It returns the target to keep —
      // its own landing position once it has arrived, which is what makes the
      // equality test above go true so `idle` can count up and this loop can
      // stand down. See lineScroll.ts.
      const state = glideFrame(
        el.scrollTop,
        target.current,
        (value) => {
          el.scrollTop = value;
          return el.scrollTop;
        },
        reducedRef.current,
      );
      target.current = state.target;
      applied.current = state.position;
      idle.current = 0;
    } else {
      idle.current += 1;
    }
    if (idle.current > IDLE_FRAMES) {
      raf.current = 0;
      return;
    }
    raf.current = requestAnimationFrame(() => pump.current());
  };

  const wake = useRef<() => void>(() => {});
  wake.current = () => {
    idle.current = 0;
    if (!raf.current) {
      // Re-measure at the start of each gesture rather than keying off the
      // reader's settings. The rendered line height also moves with the
      // global font scale, which this component never sees, so anything
      // derived from props would go stale without anyone noticing. One
      // getComputedStyle per gesture is nothing.
      lineBox.current = measureLineBox(scrollRef.current);
      raf.current = requestAnimationFrame(() => pump.current());
    }
  };

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  // ── desktop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "wheel") return;
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Measure here if the mount pass had nothing to measure — a streamed
      // chapter mounts empty and its text arrives over the network, and
      // without this the feature would silently never engage for the rest of
      // the session (the early return skips the re-measure in wake()).
      let line = lineBox.current;
      if (!(line > 0)) {
        line = measureLineBox(el);
        lineBox.current = line;
      }
      // Still nothing rendered: leave the surface to the browser rather than
      // guess a line box and move the reader oddly.
      if (!(line > 0)) return;
      e.preventDefault();
      const px = wheelDeltaToPixels(e.deltaY, e.deltaMode);
      const step = bank.current.spend(px, line);
      if (step === 0) return;
      const max = el.scrollHeight - el.clientHeight;
      // Build on the target, not the current position, so a burst of events
      // becomes one glide instead of a series of jumps.
      const base = raf.current ? target.current : el.scrollTop;
      const next = Math.max(0, Math.min(max, base + step));
      // Clipped at either end: drop the bank so unspent travel cannot pile up
      // and lurch when the reader turns round.
      if (next === base) bank.current.reset();
      target.current = next;
      wake.current();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mode, scrollRef]);
}
