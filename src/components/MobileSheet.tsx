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
  const lastChildrenRef = useRef<ReactNode>(children);
  if (open) lastChildrenRef.current = children;

  // Gesture state. `startRef` is non-null once a pointer is captured;
  // `dragging` only flips true after movement exceeds TAP_THRESHOLD so
  // a quick tap on the header (e.g., an X close button later) still
  // fires its click handler.
  //
  // `scrollable` is set when the gesture started inside an inner
  // `[data-sheet-scrollable]` region that can actually scroll. In that
  // case `claimed` starts false: native scroll handles the gesture until
  // the user pulls past a boundary, at which point we hand off to sheet
  // drag (claimed flips to true). For non-scrollable starts (drag handle,
  // header) `claimed` is true from pointerdown.
  const startRef = useRef<{
    y: number;
    t: number;
    snap: Snap;
    pointerId: number;
    scrollable: HTMLElement | null;
    baseScrollTop: number;
    claimed: boolean;
  } | null>(null);
  const samplesRef = useRef<MoveSample[]>([]);

  // While a sheet drag has *claimed* an in-flight gesture from a native
  // scroll region we need to actually stop the browser from continuing
  // to scroll. preventDefault on touchmove does that, but only if the
  // listener is attached with passive:false — which React's synthetic
  // onTouchMove doesn't expose. Hence the explicit document listener.
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (startRef.current?.claimed) e.preventDefault();
    };
    document.addEventListener("touchmove", handler, { passive: false });
    return () => document.removeEventListener("touchmove", handler);
  }, []);

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
        // back to "open" without going through enter again. Reset the
        // gesture state so the bounce lands at the default snap, not
        // whatever snap was active when the close gesture started.
        setPhase("open");
        setSnap("default");
        setDragOffset(0);
        setDragging(false);
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

    // Allow taps on interactive controls (X close, theme cards, etc.)
    // to behave normally — don't intercept their pointer events.
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'button, input, select, textarea, a[href], [role="button"], [data-no-drag]',
      )
    ) {
      return;
    }

    // The scrollable inner body (tagged on PanelShell) starts in native
    // scroll mode — the sheet only takes over the gesture if the user
    // pulls past a boundary (see onDragPointerMove). If the inner content
    // fits inside the visible box (nothing to scroll) the pointer-down
    // is treated as a normal sheet-drag start.
    const scrollable = target?.closest(
      "[data-sheet-scrollable]",
    ) as HTMLElement | null;
    const isScrollable =
      !!scrollable && scrollable.scrollHeight - scrollable.clientHeight > 1;

    if (!isScrollable) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    startRef.current = {
      y: e.clientY,
      t: performance.now(),
      snap,
      pointerId: e.pointerId,
      scrollable: isScrollable ? scrollable : null,
      baseScrollTop: isScrollable ? scrollable!.scrollTop : 0,
      claimed: !isScrollable,
    };
    // For non-scrollable starts seed samples now so we can distinguish a
    // tap (samples.length === 1 at release) from a drag (length > 1). For
    // scrollable starts we seed at claim time instead so the release
    // velocity reflects only the post-claim portion of the gesture.
    samplesRef.current = isScrollable
      ? []
      : [{ y: e.clientY, t: performance.now() }];
    // Don't flip `dragging` yet — wait for TAP_THRESHOLD movement (or for
    // a scrollable claim, whichever comes first).
  };

  const onDragPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = startRef.current;
    if (!s || e.pointerId !== s.pointerId) return;

    const dy = e.clientY - s.y;
    // For scrollable-area starts: while the user is still inside the
    // inner scroll's range, dy is exactly cancelled by the matching
    // scrollTop change, so sheetOffset stays ~0 and we never claim. Once
    // the inner scroll hits a boundary, further finger motion isn't
    // absorbed by scrollDelta and sheetOffset starts to grow — that's
    // the overscroll signal we hand off to sheet drag.
    const scrollDelta = s.scrollable
      ? s.scrollable.scrollTop - s.baseScrollTop
      : 0;
    const sheetOffset = dy + scrollDelta;
    const now = performance.now();

    if (!s.claimed) {
      const el = s.scrollable!;
      const atTop = el.scrollTop <= 0;
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      let shouldClaim = false;
      if (sheetOffset < -TAP_THRESHOLD) {
        // Pulling up past the inner content's bottom expands the sheet.
        // Only meaningful at "default" — at "full" there's nowhere left
        // to go, so we let the native scroll bounce/no-op on iOS.
        if (atBottom && s.snap === "default") shouldClaim = true;
      } else if (sheetOffset > TAP_THRESHOLD) {
        // Pulling down past the inner content's top contracts the sheet
        // — works from "default" (toward dismiss) and from "full"
        // (toward default).
        if (atTop) shouldClaim = true;
      }
      if (!shouldClaim) return;

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // pointer released or capture refused — sheet drag still works
        // via event bubbling for the rest of the gesture.
      }
      s.claimed = true;
      // Rebase the drag origin to the claim moment so further moves
      // drive the sheet from zero — no perceptible jump at handoff.
      s.y = e.clientY;
      s.baseScrollTop = el.scrollTop;
      setDragging(true);
      // Seed velocity samples from the claim moment so a release flick
      // measures sheet drag motion, not the prior native scroll.
      samplesRef.current = [{ y: e.clientY, t: now }];
      setDragOffset(0);
      return;
    }

    if (!dragging) {
      // For non-scrollable starts the TAP_THRESHOLD filter still
      // distinguishes a tap from a drag. Scrollable claims already
      // crossed the threshold by definition, so skip the check there.
      if (!s.scrollable && Math.abs(dy) < TAP_THRESHOLD) return;
      setDragging(true);
    }

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

    const targetY = baselineTranslateY(s.snap, dimsRef.current) + sheetOffset;
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
    if (!wasDragging) {
      // tap — restore baseline. dragOffset was 0 in the old code's tap
      // path, but a scrollable claim followed by an immediate release can
      // leave a small non-zero offset; reset so the sheet settles cleanly.
      setDragOffset(0);
      return;
    }

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

  // How far the sheet's own box sits BELOW the visible viewport at this snap.
  // The sheet is rendered at full height and pushed down to reach a partial
  // snap, so that many pixels of it — including the tail of any scroll region
  // inside — are off-screen. Content scrolled to the very end lands down
  // there, out of reach, which is why the last control looked unreachable.
  // Published as a CSS variable so the scrollable region (see PanelShell) can
  // pad past it without either component needing to know about the other's
  // layout. Deliberately the SNAP baseline, not the live `translateY`: using
  // the dragging value would change the padding — and reflow the list — on
  // every frame of a drag.
  const snapOverhang = Math.max(0, Math.round(baselineTranslateY(snap, dims)));

  // Settle / enter / exit all use the same `transform 240ms enter`
  // transition. Drag itself is direct manipulation, no transition.
  const transition = dragging
    ? "none"
    : reduced
      ? "none"
      : phase === "exit"
        ? `transform ${MOTION.fast}ms ${EASE.exit}`
        : `transform ${MOTION.med}ms ${EASE.enter}`;

  // Backdrop opacity tracks the sheet's visible height. Above the
  // default snap (or while dragging upward from it) we pin to 1 so
  // expansion doesn't darken further. Below default — i.e., the user
  // is dragging toward dismiss — opacity fades linearly to 0 in
  // lockstep with the sheet leaving the screen.
  const visibleH = Math.max(
    0,
    dims.viewportH - (translateY + dims.fullInsetTop),
  );
  const pinAt = dims.defaultH;
  let backdropOpacity =
    pinAt > 0 ? Math.min(1, visibleH / pinAt) : visibleH > 0 ? 1 : 0;
  if (phase === "enter") backdropOpacity = 0;

  // Drag = follow the finger 1:1 (no opacity transition). When phase
  // is exit/enter the same transform timing also drives the scrim.
  const backdropTransition = dragging
    ? "none"
    : reduced
      ? "none"
      : phase === "exit"
        ? `opacity ${MOTION.fast}ms ${EASE.exit}`
        : `opacity ${MOTION.med}ms ${EASE.enter}`;

  return (
    // `overflow: hidden` is load-bearing, not cosmetic. The sheet below is
    // absolutely positioned at bottom:0 and then TRANSLATED down to reach a
    // partial snap, and a transformed box still contributes to its ancestor's
    // scrollable overflow. Without this the reader root — which is itself
    // overflow:hidden, and so still scrollable programmatically — grew a
    // scroll area exactly as tall as the sheet's off-screen tail (measured:
    // scrollHeight 1028 against a 915 viewport) and got scrolled to it,
    // dragging the header and the page up by 113px as the sheet opened. The
    // sheet is meant to float over the reader, not shove it.
    <div style={{ position: "absolute", inset: 0, zIndex: 20, overflow: "hidden" }}>
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
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerUp}
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
          ["--sheet-overhang" as string]: `${snapOverhang}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: 8,
            paddingBottom: 8,
            flexShrink: 0,
            touchAction: "none",
            cursor: dragging ? "grabbing" : "grab",
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
