import { useLayoutEffect, useRef, useState } from "react";
import {
  placePopover,
  type AnchorBox,
  type Placement,
  type PlacementInput,
  type Side,
} from "../lib/popoverPlacement";
import { useReducedMotion } from "../styles/motion";

/** Gap between the toolbar and both its anchor and the bounds. */
const MARGIN = 8;

interface Options {
  /** Re-measures the thing the popover is attached to. Returning null
   *  means it is gone (selection collapsed, `<mark>` unmounted) — the
   *  popover then reports `visible: false`.
   *
   *  Called on every scroll frame, so keep it cheap: one
   *  `getBoundingClientRect()` is the intended cost. */
  getAnchor: () => AnchorBox | null;
  placement: PlacementInput["placement"];
  /** How much chrome each end of the reading region is under. Each
   *  reader has its own bars — the desktop's are 66/65 tall, the
   *  phone's are 44 — and a toolbar clamped to the wrong ones parks
   *  inside the text or fades out over a selection still on screen.
   *
   *  Insets rather than absolute bounds so a resize cannot leave them
   *  stale: they are resolved against the live viewport on each
   *  reposition. */
  insets: { top: number; bottom: number };
}

/**
 * Keeps a fixed-position popover glued to a rect that moves.
 *
 * The reader deliberately does not re-render React on scroll — the
 * scroll listeners in DesktopReader/MobileReader write through refs for
 * exactly that reason. So the tracking lives HERE, inside the popover
 * component, where a scroll frame re-renders one small toolbar instead
 * of the whole reading column.
 *
 * Returns the popover's own ref (so it can measure itself, rather than
 * guessing its height as the two popovers used to) and a ready-to-spread
 * style.
 */
export function useTrackedAnchor({ getAnchor, placement, insets }: Options) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** A placement plus whether getting there should be eased.
   *
   *  Scroll tracking must never ease — the toolbar has to sit on the
   *  text frame for frame, and a transition would leave it lagging
   *  behind the words it belongs to. But a DISCRETE change of anchor is
   *  the opposite case: double-click a word, double-click again for the
   *  line, and the toolbar teleports. Same pixels, different meaning,
   *  so the two are told apart by what triggered them rather than by
   *  how far the toolbar moved. */
  const [place, setPlace] = useState<(Placement & { ease: boolean }) | null>(
    null,
  );
  const reducedMotion = useReducedMotion();

  // The side is decided once, on the first placement, and then held.
  // See `lockedSide` in popoverPlacement for why.
  const sideRef = useRef<Side | undefined>(undefined);

  // Kept in refs so the scroll listener below can stay mounted for the
  // popover's whole life. Re-subscribing whenever the toolbar changes
  // size — which it does on mount, and again whenever the note editor
  // opens — would drop frames mid-scroll.
  const getAnchorRef = useRef(getAnchor);
  getAnchorRef.current = getAnchor;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const insetsRef = useRef(insets);
  insetsRef.current = insets;

  /** Commit a placement, skipping the re-render when nothing moved.
   *
   *  Both effects below end this way, and the equality check has to
   *  stay identical between them: a scroll frame that re-places to the
   *  same pixel must not re-render the toolbar.
   *
   *  Safe to rebuild each render — it closes over nothing but the
   *  stable `setPlace` and `sideRef`, so it never reaches the listener
   *  effect's dependency array and cannot cause a re-subscribe. */
  const commit = (next: Placement, ease: boolean) => {
    sideRef.current = next.side;
    setPlace((prev) =>
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.visible === next.visible
        ? prev
        : { ...next, ease },
    );
  };

  const boundsNow = (): PlacementInput["bounds"] => ({
    top: insetsRef.current.top,
    bottom: window.innerHeight - insetsRef.current.bottom,
    left: 0,
    right: window.innerWidth,
  });

  // Measure ourselves. The popover changes shape as the user opens the
  // note editor, so this follows those changes rather than measuring
  // once — `estimatedHeight` guesses are what made the old flip-above
  // decision wrong for the taller note layout.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) =>
        prev.width === r.width && prev.height === r.height
          ? prev
          : { width: r.width, height: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Layout effect, not effect: the first placement has to land before
  // the browser paints, or the toolbar flashes at its unpositioned spot
  // for one frame.
  useLayoutEffect(() => {
    let frame = 0;
    // Set by whichever listener scheduled the pending frame. A plain
    // local, like `frame`: it is read and written only inside this
    // effect's lifetime.
    let easeNext = false;

    const reposition = () => {
      frame = 0;
      // Nothing is placeable until the toolbar knows its own width.
      // Placing at width 0 puts an RTL toolbar's start edge where its
      // END belongs — it paints against the selection's right edge and
      // then jumps a full toolbar-width left the moment ResizeObserver
      // reports. Staying unplaced for that one frame is invisible;
      // moving afterwards is not.
      if (sizeRef.current.width === 0 || sizeRef.current.height === 0) return;
      const anchor = getAnchorRef.current();
      if (!anchor) {
        setPlace((prev) =>
          prev && prev.visible ? { ...prev, visible: false } : prev,
        );
        return;
      }
      const next = placePopover({
        anchor,
        size: sizeRef.current,
        bounds: boundsNow(),
        placement,
        margin: MARGIN,
        lockedSide: sideRef.current,
      });
      const ease = easeNext;
      easeNext = false;
      commit(next, ease);
    };

    const scheduleTracking = () => {
      if (frame) return;
      frame = requestAnimationFrame(reposition);
    };
    const scheduleAnchorChange = () => {
      // A frame already pending stays eased: a scroll landing in the
      // same frame is part of the same move, not a separate one.
      easeNext = true;
      if (frame) return;
      frame = requestAnimationFrame(reposition);
    };

    reposition();
    // Capture phase: the scroll that matters happens on the reading
    // column, an inner element whose scroll events do not bubble to
    // window at all.
    //
    // Scroll and resize are the whole set. The paginated modes move
    // text by transform rather than scroll, so they fire neither — but
    // every control that turns a page there is a click, and a click
    // outside the toolbar dismisses it before the text moves. Listening
    // for wheel/keydown/transitionend to catch a turn that cannot
    // happen only bought false wakeups: one per keystroke typed into
    // the note editor, and one per swatch transition ending.
    window.addEventListener("scroll", scheduleTracking, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", scheduleTracking);
    // The selection growing under a drag moves the anchor without
    // moving the page, so neither scroll nor resize fires for it.
    //
    // This is what made the toolbar open in the wrong place. It mounts
    // while the drag is still running, when the selection is the single
    // word the drag began on, and placed itself against that: measured
    // on a real chapter, an anchor 61px wide at 954..1015, toolbar at
    // 747. The drag then grew the selection to the full column,
    // 44..1256 — where the toolbar belongs at 988 — and nothing
    // re-measured. It sat wrong until the reader happened to scroll,
    // 900ms later, which is exactly what the report described.
    //
    // `selectionchange` is document-level and fires per drag frame; the
    // rAF gate below collapses those to one placement per frame, and an
    // unchanged position short-circuits before any re-render.
    document.addEventListener("selectionchange", scheduleAnchorChange);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleTracking, {
        capture: true,
      });
      window.removeEventListener("resize", scheduleTracking);
      document.removeEventListener("selectionchange", scheduleAnchorChange);
    };
  }, [placement]);

  // Re-place when our own size changes, without re-subscribing above.
  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    const anchor = getAnchorRef.current();
    if (!anchor) return;
    const next = placePopover({
      anchor,
      size,
      bounds: boundsNow(),
      placement,
      margin: MARGIN,
      lockedSide: sideRef.current,
    });
    // The toolbar growing (the note editor opening) re-places it, but
    // that is the surface changing shape around a fixed anchor, not the
    // anchor moving — easing it would make the panel appear to drift.
    commit(next, false);
  }, [size, placement]);

  // Until the first placement lands, the toolbar has no honest position
  // to be drawn at — it has not been measured, so it does not yet know
  // its own size, and drawing it anywhere for that frame is the "it
  // appears somewhere strange and then moves" flicker. So it renders,
  // to be measured, but stays invisible until the number is real.
  const shown = place !== null && place.visible;

  return {
    ref,
    visible: shown,
    style: {
      position: "fixed" as const,
      top: place?.top ?? 0,
      left: place?.left ?? 0,
      // Fade rather than unmount, so scrolling the selection back into
      // view brings the same toolbar back instead of a new one.
      opacity: shown ? 1 : 0,
      pointerEvents: shown ? ("auto" as const) : ("none" as const),
      // No transition on the very first paint, or the toolbar fades in
      // from the top-left corner of the window.
      // Position eases only on a discrete anchor change — see the
      // `ease` note on the state above. 180ms sits inside the 150-300ms
      // micro-interaction band, and ease-out lets it arrive rather than
      // coast. Reduced motion drops it to the instant move.
      transition:
        place === null || reducedMotion
          ? undefined
          : place.ease
            ? "top 180ms ease-out, left 180ms ease-out, opacity 140ms ease-out"
            : "opacity 140ms ease-out",
      // Never let a mid-scroll re-place animate: the position must track
      // the text exactly, frame for frame.
      willChange: "top, left, opacity",
    },
  };
}
