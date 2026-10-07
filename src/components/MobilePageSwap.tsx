// Page transitions for the phone's home shell (Library, Store, Downloads,
// Settings and the pages under them).
//
// Two motions, chosen by what kind of move it was:
//
//   - Between tabs, the new page dissolves in over the old one while
//     settling from a hair smaller. Tabs are siblings; sliding between them
//     would claim an order they do not have.
//   - Within a tab, going deeper slides the new page in from the reading
//     direction's end, over the old one, which drifts a little the other way
//     and dims — and going back reverses it exactly. Which way is read from
//     the navigation history (NavState.move), so the system back gesture, the
//     on-screen back button and a forward gesture all move the right way.
//
// Built on CSS TRANSITIONS flipped a frame after mount, never on a keyframe
// that starts with the node: a webview can skip or indefinitely hold a mount
// keyframe, and a page held at its first frame would sit off-screen (see the
// WebKit mount-animation note). The flip has a timer behind it as well, and
// a final timer lands both slots at rest regardless, so no page can be
// stranded part-way.

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { NavMove } from "../store/navigation";
import { Z_LOCAL } from "../styles/tokens";
import { EASE, useReducedMotion } from "../styles/motion";

type Mode = "forward" | "back" | "fade";

interface Slot {
  key: string;
  node: ReactNode;
}

interface Swap {
  id: number;
  from: Slot;
  mode: Mode;
  /** False for the first frame (start positions, no transition), true once
   *  the transition is running towards rest. */
  running: boolean;
}

const SLIDE_MS = 320;
const SLIDE_CURVE = EASE.enter;
const FADE_IN_MS = 200;
/** How far the page underneath drifts, as a share of the width. */
const UNDER_SHIFT = 0.28;

export function MobilePageSwap({
  viewKey,
  group,
  move,
  seq,
  rtl,
  background,
  children,
}: {
  /** Identity of the page on screen. A change animates; the same key just
   *  re-renders in place. */
  viewKey: string;
  /** Which tab the page belongs to. A change of group fades. */
  group: string;
  move: NavMove;
  rtl: boolean;
  /** NavState.seq. A key change with no navigation since the last swap
   *  (the library's filter pills) has no direction, so it fades. */
  seq: number;
  /** The page colour. Every slot is painted with it: a page that brings no
   *  background of its own (the Shelves page, the Store's pages) would
   *  otherwise be see-through while it slides in, and the page it is
   *  covering showed through it — two pages' text on top of each other. */
  background: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  // What was on screen as of the last commit — the page a swap animates
  // away. Read during the render that changes the key, before it updates.
  const lastNode = useRef<ReactNode>(children);
  const [state, setState] = useState<{
    key: string;
    group: string;
    seq: number;
    nextId: number;
    swap: Swap | null;
  }>({ key: viewKey, group, seq, nextId: 1, swap: null });

  // A new key starts a swap. Derived from state alone, so a repeated render
  // (React's development double-invoke) computes the same thing.
  if (viewKey !== state.key) {
    const mode: Mode =
      group !== state.group || seq === state.seq
        ? "fade"
        : move === "pop"
          ? "back"
          : move === "push"
            ? "forward"
            : "fade";
    setState({
      key: viewKey,
      group,
      seq,
      nextId: state.nextId + 1,
      swap: reduced
        ? null
        : {
            id: state.nextId,
            from: { key: state.key, node: lastNode.current },
            mode,
            running: false,
          },
    });
  }
  useLayoutEffect(() => {
    lastNode.current = children;
  });
  const swap = state.swap;

  // Start the transition one frame after the start positions have painted,
  // with a timer behind the frame in case frames are not running; then land
  // everything at rest once it has had time to finish.
  const pendingId = swap && !swap.running ? swap.id : null;
  const activeId = swap ? swap.id : null;
  useEffect(() => {
    if (pendingId === null) return;
    const run = () =>
      setState((st) =>
        st.swap && st.swap.id === pendingId && !st.swap.running
          ? { ...st, swap: { ...st.swap, running: true } }
          : st,
      );
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(run);
    });
    const kick = window.setTimeout(run, 60);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(kick);
    };
  }, [pendingId]);
  useEffect(() => {
    if (activeId === null) return;
    const done = window.setTimeout(
      () =>
        setState((st) =>
          st.swap && st.swap.id === activeId ? { ...st, swap: null } : st,
        ),
      SLIDE_MS + 160,
    );
    return () => window.clearTimeout(done);
  }, [activeId]);

  const sign = rtl ? -1 : 1;
  // While the swap is being set up the incoming page has not yet received
  // its start position; the render that sets state above shows the new key
  // with no swap for a moment, which React discards before painting.
  const styles = swap ? slotStyles(swap.mode, swap.running, sign) : null;

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {swap && styles && (
        <div
          // Keyed by the page's own key, as it was while current: React keeps
          // that instance for the exit instead of mounting a second copy —
          // which re-ran a leaving page's fetches (a novel's scrape) and
          // dropped its scroll position.
          key={swap.from.key}
          aria-hidden
          style={{ ...slotBase, background, ...styles.from }}
        >
          {swap.from.node}
        </div>
      )}
      <div
        key={state.key}
        style={{ ...slotBase, background, ...(styles?.to ?? null) }}
      >
        {children}
      </div>
    </div>
  );
}

const slotBase: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

function slotStyles(
  mode: Mode,
  running: boolean,
  sign: number,
): { from: CSSProperties; to: CSSProperties } {
  const slide = (ms: number) =>
    `transform ${ms}ms ${SLIDE_CURVE}, opacity ${ms}ms ${SLIDE_CURVE}`;
  if (mode === "fade") {
    // A cross-dissolve, not a fade-through: the old page stays exactly as
    // it is underneath while the new one fades in over it. Both are opaque
    // (see `background`), so at every frame there is a whole page on
    // screen. Fading the old one out first left a frame or two of bare
    // background between the tabs — read as the page "appearing blank
    // first".
    return {
      from: {
        zIndex: Z_LOCAL.base,
        pointerEvents: "none",
      },
      to: {
        zIndex: Z_LOCAL.raised,
        opacity: running ? 1 : 0,
        transform: running ? "none" : "scale(0.99)",
        transition: running
          ? `opacity ${FADE_IN_MS}ms ease-out, transform ${FADE_IN_MS}ms ease-out`
          : "none",
      },
    };
  }
  const shadow = "0 0 24px rgba(0,0,0,0.18)";
  if (mode === "forward") {
    // The new page comes in over the old one from the end side.
    return {
      from: {
        zIndex: Z_LOCAL.base,
        pointerEvents: "none",
        transform: running
          ? `translateX(${-sign * UNDER_SHIFT * 100}%)`
          : "none",
        opacity: running ? 0.6 : 1,
        transition: running ? slide(SLIDE_MS) : "none",
      },
      to: {
        zIndex: Z_LOCAL.raised,
        boxShadow: shadow,
        transform: running ? "none" : `translateX(${sign * 100}%)`,
        transition: running ? slide(SLIDE_MS) : "none",
      },
    };
  }
  // Back: the old page leaves the way it came, uncovering the one below.
  return {
    from: {
      zIndex: Z_LOCAL.raised,
      pointerEvents: "none",
      boxShadow: shadow,
      transform: running ? `translateX(${sign * 100}%)` : "none",
      transition: running ? slide(SLIDE_MS) : "none",
    },
    to: {
      zIndex: Z_LOCAL.base,
      transform: running ? "none" : `translateX(${-sign * UNDER_SHIFT * 100}%)`,
      opacity: running ? 1 : 0.6,
      transition: running ? slide(SLIDE_MS) : "none",
    },
  };
}
