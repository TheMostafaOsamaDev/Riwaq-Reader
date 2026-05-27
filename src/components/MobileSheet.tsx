// Bottom sheet for the mobile reader's menus (TOC, settings, etc.).
//
// The sheet element is rendered at the full-snap height (viewport
// minus the safe-area top inset) and shifted down with `translateY`
// to land on the active snap point. Expanding to full is therefore
// a transform-only animation with no relayout. The enter and exit
// transitions are driven by the same React-state machinery used by
// snap settles, so closing from the full snap slides straight off
// the bottom instead of jumping back to default first.
//
// Drag, snap, and velocity math live in `./sheetSnap` — this file
// owns React/DOM concerns only.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { EASE, MOTION, useReducedMotion } from "../styles/motion";
import type { Theme } from "../styles/tokens";
import {
  baselineTranslateY,
  clampTranslateY,
  decideSnap,
  TAP_THRESHOLD,
  velocityFromSamples,
  VELOCITY_WINDOW_MS,
  type MoveSample,
  type Snap,
  type SnapDims,
} from "./sheetSnap";

interface Props {
  theme: Theme;
  /** Controls visibility. Flip to false to dismiss with animation. */
  open: boolean;
  /** Called when the user taps the backdrop, taps an in-sheet close
   *  button, or drags the sheet past the dismiss threshold. */
  onClose: () => void;
  children: ReactNode;
  /** CSS height for the *default* snap. Default "82%". */
  height?: string;
  /** Optional aria-label for the dialog role. */
  label?: string;
}

type Phase = "enter" | "open" | "exit";

const FULL_INSET_TOP_FALLBACK = 24;

/** Read `env(safe-area-inset-top, FALLBACK)` once, with a sane fallback
 *  for environments that don't define it. We measure off a temporary
 *  element rather than parsing the variable directly so the resolved
 *  value matches what the browser actually applies. */
function readSafeAreaInsetTop(): number {
  if (typeof document === "undefined") return FULL_INSET_TOP_FALLBACK;
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.style.height = `env(safe-area-inset-top, ${FULL_INSET_TOP_FALLBACK}px)`;
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  document.body.removeChild(probe);
  return px > 0 ? px : FULL_INSET_TOP_FALLBACK;
}

function parseHeightPx(heightProp: string, viewportH: number): number {
  const trimmed = heightProp.trim();
  if (trimmed.endsWith("%")) {
    const pct = parseFloat(trimmed.slice(0, -1));
    if (Number.isFinite(pct)) return (pct / 100) * viewportH;
  }
  if (trimmed.endsWith("px")) {
    const px = parseFloat(trimmed.slice(0, -2));
    if (Number.isFinite(px)) return px;
  }
  // Unknown unit — fall back to 82 % so the sheet still works.
  return 0.82 * viewportH;
}

export function MobileSheet({
  theme,
  open,
  onClose,
  children,
  height = "82%",
  label,
}: Props) {
  const reduced = useReducedMotion();

  // Lifecycle: null = unmounted; enter = first paint at offscreen
  // position; open = settled; exit = animating out before unmount.
  const [phase, setPhase] = useState<Phase | null>(open ? "enter" : null);
  const [snap, setSnap] = useState<Snap>("default");
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const dimsRef = useRef<SnapDims>({
    fullInsetTop: FULL_INSET_TOP_FALLBACK,
    viewportH: typeof window === "undefined" ? 0 : window.innerHeight,
    defaultH:
      typeof window === "undefined"
        ? 0
        : parseHeightPx(height, window.innerHeight),
  });
  const sheetElRef = useRef<HTMLDivElement | null>(null);
  const lastChildrenRef = useRef<ReactNode>(children);
  if (open) lastChildrenRef.current = children;

  // Gesture state. `startRef` is non-null once a pointer is captured;
  // `dragging` only flips true after movement exceeds TAP_THRESHOLD so
  // a quick tap on the header (e.g., an X close button later) still
  // fires its click handler.
  const startRef = useRef<{
    y: number;
    t: number;
    snap: Snap;
    pointerId: number;
  } | null>(null);
  const samplesRef = useRef<MoveSample[]>([]);

  // Measure dims once on mount and on every resize/orientation change.
  // The default-snap height is derived from the `height` prop string.
  useLayoutEffect(() => {
    function measure() {
      const viewportH =
        window.visualViewport?.height ?? window.innerHeight ?? 0;
      const fullInsetTop = readSafeAreaInsetTop();
      const defaultH = parseHeightPx(height, viewportH);
      dimsRef.current = { viewportH, fullInsetTop, defaultH };
    }
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [height]);

  // Phase transitions driven by the `open` prop.
  useEffect(() => {
    if (open) {
      if (phase === null) {
        setPhase("enter");
        setSnap("default");
        setDragOffset(0);
        setDragging(false);
      } else if (phase === "exit") {
        // Re-opening while exit animation is still running — bounce
        // back to "open" without going through enter again.
        setPhase("open");
      }
    } else if (phase !== null && phase !== "exit") {
      setPhase("exit");
      setDragging(false);
      setDragOffset(0);
    }
  }, [open, phase]);

  // After paint with phase="enter", promote to "open" on the next frame
  // so the inline transition has a non-zero from-value to animate from.
  useEffect(() => {
    if (phase !== "enter") return;
    const raf = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Unmount once the exit transition has finished.
  useEffect(() => {
    if (phase !== "exit") return;
    const t = setTimeout(
      () => setPhase(null),
      reduced ? 0 : MOTION.fast,
    );
    return () => clearTimeout(t);
  }, [phase, reduced]);

  const onDragPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "open") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (startRef.current !== null) return; // second pointer — ignore
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = {
      y: e.clientY,
      t: performance.now(),
      snap,
      pointerId: e.pointerId,
    };
    samplesRef.current = [{ y: e.clientY, t: performance.now() }];
    // Don't flip `dragging` yet — wait for TAP_THRESHOLD movement.
  };

  const onDragPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dy = e.clientY - s.y;
    if (!dragging && Math.abs(dy) < TAP_THRESHOLD) return;
    if (!dragging) setDragging(true);

    const now = performance.now();
    samplesRef.current.push({ y: e.clientY, t: now });
    // Bound the buffer — keep enough headroom past VELOCITY_WINDOW_MS
    // so a refactor that raises the window doesn't silently lose data.
    const evictAfter = VELOCITY_WINDOW_MS + 80;
    while (
      samplesRef.current.length > 2 &&
      now - samplesRef.current[0].t > evictAfter
    ) {
      samplesRef.current.shift();
    }

    const targetY = baselineTranslateY(s.snap, dimsRef.current) + dy;
    const clamped = clampTranslateY(targetY, dimsRef.current);
    const offset = clamped - baselineTranslateY(s.snap, dimsRef.current);
    setDragOffset(offset);
  };

  const onDragPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
    // Read drag commit synchronously from samplesRef — `dragging` state
    // is closure-captured and may be stale if pointerup arrives in the
    // same frame as the threshold crossing. The move handler only pushes
    // samples *after* the TAP_THRESHOLD check, so `length > 1` is true
    // iff a real drag occurred. Velocity must be computed BEFORE the
    // samples ring is cleared.
    const wasDragging = samplesRef.current.length > 1;
    const velocity = velocityFromSamples(samplesRef.current);
    startRef.current = null;
    samplesRef.current = [];
    setDragging(false);
    if (!wasDragging) return; // tap — leave snap/offset alone

    const target = decideSnap({
      // s.snap is always "full" | "default" when the sheet is open and
      // draggable; "dismissed" is only a synthetic end-state, never stored
      // in startRef. The assertion is safe by construction.
      fromSnap: s.snap as Exclude<Snap, "dismissed">,
      offsetPx: dragOffset,
      velocityPxPerSec: velocity,
      dims: dimsRef.current,
    });
    if (target === "dismissed") {
      // Let the parent flip `open=false`, which triggers the exit
      // phase. Don't pre-set snap — phase="exit" already drives
      // translateY to the dismissed baseline.
      setDragOffset(0);
      onClose();
      return;
    }
    setDragOffset(0);
    setSnap(target);
  };

  if (phase === null) return null;

  // Compute the active translateY. While dragging or at any phase
  // other than "open", we render at the relevant baseline.
  let translateY: number;
  const dims = dimsRef.current;
  if (phase === "enter") {
    translateY = baselineTranslateY("dismissed", dims);
  } else if (phase === "exit") {
    translateY = baselineTranslateY("dismissed", dims);
  } else {
    translateY = baselineTranslateY(snap, dims) + dragOffset;
  }

  // Settle / enter / exit all use the same `transform 240ms enter`
  // transition. Drag itself is direct manipulation, no transition.
  const transition = dragging
    ? "none"
    : reduced
      ? "none"
      : phase === "exit"
        ? `transform ${MOTION.fast}ms ${EASE.exit}`
        : `transform ${MOTION.med}ms ${EASE.enter}`;

  // Backdrop opacity is implemented in a later task. For now keep
  // the original behavior of full opacity once mounted.
  const backdropOpacity = phase === "enter" || phase === "exit" ? 0 : 1;
  const backdropTransition = reduced
    ? "none"
    : `opacity ${phase === "exit" ? MOTION.fast : MOTION.med}ms ${
        phase === "exit" ? EASE.exit : EASE.enter
      }`;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 20 }}>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          opacity: backdropOpacity,
          transition: backdropTransition,
        }}
      />
      <div
        ref={sheetElRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: `calc(100dvh - ${dims.fullInsetTop}px)`,
          background: theme.bg,
          color: theme.ink,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.25)",
          overflow: "hidden",
          transform: `translateY(${translateY}px)`,
          transition,
          willChange: "transform",
          overscrollBehavior: "contain",
        }}
      >
        <div
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: 8,
            paddingBottom: 8,
            flexShrink: 0,
            touchAction: "none",
            cursor: "grab",
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: theme.rule,
            }}
          />
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {open ? children : lastChildrenRef.current}
        </div>
      </div>
    </div>
  );
}
