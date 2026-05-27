# Draggable Mobile Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `MobileSheet` (used by TOC, Settings, Highlights, Progress on mobile) draggable with three snap points — full / default / dismissed — using hand-rolled `PointerEvent` gestures and no new dependencies.

**Architecture:** All gesture math is extracted to a small pure module (`src/components/sheetSnap.ts`); React/DOM concerns stay in `MobileSheet.tsx`. The sheet element is rendered at the full-snap height and positioned by `translateY` so expansion is a transform-only animation with no relayout. The existing CSS-class–based enter/exit keyframes are replaced by the same state-driven `transform` transitions used for snap settles, so an exit from the full snap slides directly off-screen instead of jumping back to default first.

**Tech Stack:** React 19, TypeScript 5.8, Vite 7, Tauri 2 (Android target). **No test framework is configured** (no vitest/jest/playwright in `package.json`). Verification is by `tsc --noEmit` and manual walkthrough in the Tauri Android dev build. The pure snap module is structured so a runner can add unit tests later in one file.

---

## File Structure

- **Create:** `src/components/sheetSnap.ts` — pure types, constants, and helpers (`decideSnap`, `baselineTranslateY`, `velocityFromSamples`, `clampOffset`). Zero React, zero DOM.
- **Modify:** `src/components/MobileSheet.tsx` — drop CSS-class animation hooks, add gesture handlers and snap state, render at full-snap height with translateY positioning. New optional `label` prop for ARIA.
- **Modify:** `src/styles/global.css:277-290` — delete the `leaflet-sheet-enter` / `leaflet-sheet-exit` keyframes and classes; they are no longer referenced.
- **Modify (optional polish, Task 7):** `src/components/MobileReader.tsx:695-768` — pass `label` to `<MobileSheet>` for each panel.

No other call sites change. The `MobileSheet` API stays additive-only (`label?` is new, all existing props keep their semantics).

---

## Task 1: Pure snap-math module

**Files:**
- Create: `src/components/sheetSnap.ts`

### - [ ] Step 1.1: Create the module

Use the Write tool to create `src/components/sheetSnap.ts` with this exact content:

```ts
// Pure math + types for the MobileSheet drag-to-snap gesture.
// No React, no DOM — keeps the moving parts testable in isolation
// and the consumer (`MobileSheet.tsx`) easier to read.

export type Snap = "full" | "default" | "dismissed";

export interface SnapDims {
  /** Pixel offset reserved above the sheet at the full snap (safe-area / notch). */
  fullInsetTop: number;
  /** Total viewport height in px (visualViewport / window.innerHeight). */
  viewportH: number;
  /** Height of the *default* snap in px (the rendered "82%"). */
  defaultH: number;
}

/** Sample of a pointermove for velocity estimation. */
export interface MoveSample {
  y: number;
  t: number; // performance.now() in ms
}

export const TAP_THRESHOLD = 6;  // px — below this, the gesture is a tap
export const V_THRESH = 500;     // px/sec — flick threshold
export const VELOCITY_WINDOW_MS = 120;

/** translateY (px) for a given snap relative to a sheet rendered at the
 *  full snap height with `bottom: 0` anchor.
 *
 *  - "full"      → 0 (sheet top edge sits at fullInsetTop)
 *  - "default"   → viewportH - fullInsetTop - defaultH (sheet shifted down so
 *                  only defaultH is visible above the viewport bottom)
 *  - "dismissed" → viewportH - fullInsetTop (sheet entirely below the viewport)
 */
export function baselineTranslateY(snap: Snap, dims: SnapDims): number {
  switch (snap) {
    case "full":
      return 0;
    case "default":
      return Math.max(0, dims.viewportH - dims.fullInsetTop - dims.defaultH);
    case "dismissed":
      return Math.max(0, dims.viewportH - dims.fullInsetTop);
  }
}

/** Clamp a raw translateY value so the sheet cannot be dragged above the
 *  full snap or past the dismissed snap. */
export function clampTranslateY(y: number, dims: SnapDims): number {
  const min = baselineTranslateY("full", dims);
  const max = baselineTranslateY("dismissed", dims);
  return Math.min(max, Math.max(min, y));
}

/** Estimate the user's vertical drag velocity (px/sec, signed +down/-up)
 *  from a recent ring of pointermove samples. Returns 0 when there's not
 *  enough data. */
export function velocityFromSamples(samples: MoveSample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  // Walk backward to find the oldest sample inside the velocity window.
  let oldest = samples[0];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t <= VELOCITY_WINDOW_MS) {
      oldest = samples[i];
    } else {
      break;
    }
  }
  const dt = (last.t - oldest.t) / 1000;
  if (dt <= 0) return 0;
  return (last.y - oldest.y) / dt;
}

export interface SnapInput {
  /** Where the gesture started ("dismissed" is unreachable as a start). */
  fromSnap: Exclude<Snap, "dismissed">;
  /** Signed pixel offset applied to the from-snap baseline (+down/-up). */
  offsetPx: number;
  /** Signed velocity at release (+down/-up). */
  velocityPxPerSec: number;
  dims: SnapDims;
}

/** Decide which snap the sheet should settle to when the pointer is
 *  released. The thresholds match the rules approved during brainstorming:
 *
 *  from "default":
 *    - drag up past 20 % of (full → default) gap or upward flick → "full"
 *    - drag down past 25 % of defaultH or downward flick → "dismissed"
 *    - otherwise → "default"
 *
 *  from "full":
 *    - drag down past gapFullToDefault + 25 % of defaultH or downward flick → "dismissed"
 *    - drag down past gapFullToDefault → "default"
 *    - otherwise → "full"
 */
export function decideSnap(input: SnapInput): Snap {
  const { fromSnap, offsetPx, velocityPxPerSec, dims } = input;
  const gapFullToDefault = Math.max(
    0,
    dims.viewportH - dims.fullInsetTop - dims.defaultH,
  );
  const dismissExtra = 0.25 * dims.defaultH;

  if (fromSnap === "default") {
    if (offsetPx < 0) {
      const distOk = Math.abs(offsetPx) >= 0.20 * gapFullToDefault;
      const flickOk = velocityPxPerSec <= -V_THRESH;
      if (distOk || flickOk) return "full";
      return "default";
    }
    if (offsetPx > 0) {
      const distOk = offsetPx >= 0.25 * dims.defaultH;
      const flickOk = velocityPxPerSec >= V_THRESH;
      if (distOk || flickOk) return "dismissed";
      return "default";
    }
    return "default";
  }

  // fromSnap === "full"
  if (offsetPx <= 0) return "full"; // dragging further up at full → stay
  if (
    offsetPx > gapFullToDefault + dismissExtra ||
    velocityPxPerSec >= V_THRESH
  ) {
    return "dismissed";
  }
  if (offsetPx >= gapFullToDefault) return "default";
  return "full";
}
```

### - [ ] Step 1.2: Type-check

Run: `pnpm exec tsc -b --noEmit`
Expected: clean exit (no errors). If `tsc -b` complains about incremental files, run `pnpm exec tsc --noEmit` instead.

### - [ ] Step 1.3: Commit

```bash
git add src/components/sheetSnap.ts
git commit -m "feat(sheet): pure snap-math helpers for draggable MobileSheet"
```

---

## Task 2: Convert MobileSheet to state-driven translateY positioning

This refactor changes how the sheet positions itself without yet introducing drag. After this task, opening / closing the sheet looks identical to before, but positioning is driven by inline `transform`/`transition` styles instead of CSS animation classes.

**Files:**
- Modify: `src/components/MobileSheet.tsx` (full rewrite of the component body)
- Modify: `src/styles/global.css:277-290` (delete unused keyframes / classes)

### - [ ] Step 2.1: Rewrite `MobileSheet.tsx`

Use the Write tool to overwrite `src/components/MobileSheet.tsx` with this content. Existing imports and the file's header comment block expand to cover the new architecture.

```tsx
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
    defaultH: 0,
  });
  const sheetElRef = useRef<HTMLDivElement | null>(null);
  const lastChildrenRef = useRef<ReactNode>(children);
  if (open) lastChildrenRef.current = children;

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
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: 8,
            paddingBottom: 2,
            flexShrink: 0,
            touchAction: "none",
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
```

### - [ ] Step 2.2: Delete the unused CSS keyframes

Edit `src/styles/global.css`. Replace the exact block (lines 277–290 in the current file):

**old_string:**
```css
@keyframes leaflet-sheet-enter {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes leaflet-sheet-exit {
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
}
.leaflet-sheet-enter {
  animation: leaflet-sheet-enter 240ms cubic-bezier(0.32, 0.72, 0, 1) both;
}
.leaflet-sheet-exit {
  animation: leaflet-sheet-exit 180ms cubic-bezier(0.4, 0, 1, 1) both;
}
```

**new_string:** *(empty — delete the block entirely)*

Confirm with `grep -n "leaflet-sheet-" src/styles/global.css`. Expected: no matches.

### - [ ] Step 2.3: Type-check

Run: `pnpm exec tsc -b --noEmit`
Expected: clean exit.

### - [ ] Step 2.4: Manual smoke test

Start the dev server: `pnpm dev` (desktop) or `pnpm tauri android dev` (Android).

In the mobile reader (resize the browser to ~400px wide if running desktop):
- Tap the TOC tab → sheet slides up to default position ✓
- Tap the backdrop → sheet slides down and unmounts ✓
- Tap Settings tab → sheet slides up ✓
- Tap the X close button inside the panel header → sheet slides down ✓

Behavior should be visually identical to before this task.

### - [ ] Step 2.5: Commit

```bash
git add src/components/MobileSheet.tsx src/styles/global.css
git commit -m "refactor(sheet): drive MobileSheet enter/exit via inline translateY"
```

---

## Task 3: Add drag tracking (no snap commit yet)

Add gesture state and pointer handlers to the drag-zone (handle + header strip). During this task, releases return the sheet to its current snap — the user can drag and let go, but cannot change snaps yet. This isolates the gesture wiring from the snap-decision logic.

**Files:**
- Modify: `src/components/MobileSheet.tsx`

### - [ ] Step 3.1: Add gesture state and refs

Edit `src/components/MobileSheet.tsx`. Locate the state declarations near the top of the component (the `dimsRef` declaration is the anchor). Replace:

**old_string:**
```tsx
  const dimsRef = useRef<SnapDims>({
    fullInsetTop: FULL_INSET_TOP_FALLBACK,
    viewportH: typeof window === "undefined" ? 0 : window.innerHeight,
    defaultH: 0,
  });
  const sheetElRef = useRef<HTMLDivElement | null>(null);
  const lastChildrenRef = useRef<ReactNode>(children);
  if (open) lastChildrenRef.current = children;
```

**new_string:**
```tsx
  const dimsRef = useRef<SnapDims>({
    fullInsetTop: FULL_INSET_TOP_FALLBACK,
    viewportH: typeof window === "undefined" ? 0 : window.innerHeight,
    defaultH: 0,
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
```

### - [ ] Step 3.2: Add the pointer event handlers

In the same component, add these handler functions just above the `if (phase === null) return null;` line:

```tsx
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
    // Bound the buffer — only the last ~200ms matter.
    while (
      samplesRef.current.length > 2 &&
      now - samplesRef.current[0].t > 200
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
    const wasDragging = dragging;
    startRef.current = null;
    samplesRef.current = [];
    setDragging(false);
    if (!wasDragging) return; // tap — leave snap/offset alone

    // Task 3 only: snap back to current snap. Task 4 will replace
    // this with the real decideSnap() call.
    setDragOffset(0);
  };
```

### - [ ] Step 3.3: Wire the handlers to the drag zone

The drag zone is the handle pill + header strip. The handle pill already exists; the header strip (the `Reading / Appearance & typography / X` row) lives inside each `*Panel` component and is not directly addressable from `MobileSheet`. For now, attach the handlers to the existing handle-row container so we have a verifiable drag target.

In the same file, locate the handle-row wrapper:

**old_string:**
```tsx
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: 8,
            paddingBottom: 2,
            flexShrink: 0,
            touchAction: "none",
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
```

**new_string:**
```tsx
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
```

(We bumped `paddingBottom` from 2 → 8 to make the drag-zone touch target a bit taller; the visual handle pill position is unchanged thanks to flex centering.)

### - [ ] Step 3.4: Type-check

Run: `pnpm exec tsc -b --noEmit`
Expected: clean exit.

### - [ ] Step 3.5: Manual smoke test

Run `pnpm dev` (or `pnpm tauri android dev`). Open any of the four sheets. From the default position:
- Click-and-drag the handle pill up — sheet follows the pointer upward, clamped at the full snap. On release, sheet animates back to default ✓
- Click-and-drag down — sheet follows downward, clamped just past the dismissed snap. On release, animates back to default ✓
- Single tap on the handle (under 6px movement) — nothing happens, no twitch ✓
- Body content (e.g., the scrollable settings list) still scrolls normally ✓

### - [ ] Step 3.6: Commit

```bash
git add src/components/MobileSheet.tsx
git commit -m "feat(sheet): drag tracking on MobileSheet handle (no snap commit yet)"
```

---

## Task 4: Wire up the snap decision

Replace the placeholder release behavior from Task 3 with the real `decideSnap` call, transitioning the sheet to the chosen snap (or invoking `onClose` for dismissed).

**Files:**
- Modify: `src/components/MobileSheet.tsx`

### - [ ] Step 4.1: Replace the pointer-up release body

Edit `src/components/MobileSheet.tsx`. Locate the `onDragPointerUp` handler added in Task 3 and replace the post-`releasePointerCapture` body so velocity is computed *before* the sample ring is cleared, and the snap decision drives the release.

**old_string:**
```tsx
    const wasDragging = dragging;
    startRef.current = null;
    samplesRef.current = [];
    setDragging(false);
    if (!wasDragging) return; // tap — leave snap/offset alone

    // Task 3 only: snap back to current snap. Task 4 will replace
    // this with the real decideSnap() call.
    setDragOffset(0);
  };
```

**new_string:**
```tsx
    const wasDragging = dragging;
    const velocity = velocityFromSamples(samplesRef.current);
    startRef.current = null;
    samplesRef.current = [];
    setDragging(false);
    if (!wasDragging) return; // tap — leave snap/offset alone

    const target = decideSnap({
      fromSnap: s.snap,
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
```

### - [ ] Step 4.2: Type-check

Run: `pnpm exec tsc -b --noEmit`
Expected: clean exit.

### - [ ] Step 4.3: Manual smoke test

Open any sheet. From default:
- Slow drag up by ~30% of the gap → settles to **full** ✓
- Slow drag up by ~10% of the gap → settles back to **default** ✓
- Slow drag down by ~30% of default height → sheet dismisses (`onClose`) ✓
- Quick flick up by a few px → settles to **full** (velocity) ✓
- Quick flick down by a few px → dismisses (velocity) ✓

From full:
- Slow drag down by ~110% of `(viewport − insetTop − defaultH)` gap → settles to **default** ✓
- Slow drag down well past default + 25% of default height → dismisses ✓
- Flick down → dismisses ✓
- Try dragging up at full → stays at full (clamped) ✓

### - [ ] Step 4.4: Commit

```bash
git add src/components/MobileSheet.tsx
git commit -m "feat(sheet): commit snap decision on drag release"
```

---

## Task 5: Dynamic backdrop opacity

Currently the backdrop is pinned to opacity 1 whenever the sheet is open. Make it track the sheet's position so dragging toward dismissed fades the scrim out in lockstep.

**Files:**
- Modify: `src/components/MobileSheet.tsx`

### - [ ] Step 5.1: Compute opacity from translateY

Edit `src/components/MobileSheet.tsx`. Locate the backdrop-opacity computation added in Task 2. Replace:

**old_string:**
```tsx
  // Backdrop opacity is implemented in a later task. For now keep
  // the original behavior of full opacity once mounted.
  const backdropOpacity = phase === "enter" || phase === "exit" ? 0 : 1;
  const backdropTransition = reduced
    ? "none"
    : `opacity ${phase === "exit" ? MOTION.fast : MOTION.med}ms ${
        phase === "exit" ? EASE.exit : EASE.enter
      }`;
```

**new_string:**
```tsx
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
```

### - [ ] Step 5.2: Type-check

Run: `pnpm exec tsc -b --noEmit`
Expected: clean exit.

### - [ ] Step 5.3: Manual smoke test

- Open sheet → scrim fades in alongside slide-up ✓
- Drag up to full → scrim stays at full opacity (no darkening) ✓
- Drag down toward dismiss → scrim fades out in real time with the sheet ✓
- Drag down a little then release back to default → scrim fades back to full opacity in 240ms ✓
- Tap backdrop → scrim fades out as sheet slides off ✓

### - [ ] Step 5.4: Commit

```bash
git add src/components/MobileSheet.tsx
git commit -m "feat(sheet): backdrop opacity tracks sheet drag position"
```

---

## Task 6: Reduced-motion settle path

The current transition string already returns `"none"` when `reduced` is true (Tasks 2 and 5 both honor it), but verify it end-to-end and confirm no path leaks an animation.

**Files:**
- No code changes expected.

### - [ ] Step 6.1: Verify the reduced-motion paths

Open `src/components/MobileSheet.tsx` and confirm every place that builds a `transition` string short-circuits to `"none"` when either `dragging` or `reduced` is true. The two callers are the sheet `transition` and the backdrop `backdropTransition`. Both should look like:

```tsx
const X = dragging ? "none" : reduced ? "none" : "<actual transition>";
```

If either is missing the `reduced ? "none" :` branch, add it.

### - [ ] Step 6.2: Manual smoke test with reduced motion

In Chrome / Edge dev tools: open `Rendering` panel → "Emulate CSS media feature `prefers-reduced-motion`" → `reduce`.

- Open sheet → snaps into default position instantly ✓
- Drag up → snaps to full instantly on release ✓
- Drag down → snaps to dismissed instantly (sheet unmounts immediately) ✓
- Tap backdrop → instant close ✓

On Android: enable `Developer options → Animator duration scale → off` (effectively reduce motion on many devices) or toggle the OS-level reduce-motion setting. Repeat the smoke test.

### - [ ] Step 6.3: Commit (only if Step 6.1 found gaps)

```bash
git add src/components/MobileSheet.tsx
git commit -m "fix(sheet): honor reduced-motion on every settle transition"
```

If Step 6.1 found no gaps, skip the commit — Task 6 is verification-only.

---

## Task 7: Optional ARIA labels from each call site

`MobileSheet` already gained `role="dialog"`, `aria-modal="true"`, and an optional `aria-label` prop in Task 2. This task wires the labels from each of the four call sites in `MobileReader.tsx`. Low priority — safe to skip if you want to ship without it.

**Files:**
- Modify: `src/components/MobileReader.tsx:695-768`

### - [ ] Step 7.1: Pass labels

Edit `src/components/MobileReader.tsx`. Locate the single `<MobileSheet>` element. Replace:

**old_string:**
```tsx
      <MobileSheet
        theme={theme}
        open={sheet !== null}
        onClose={() => setSheet(null)}
        height="82%"
      >
```

**new_string:**
```tsx
      <MobileSheet
        theme={theme}
        open={sheet !== null}
        onClose={() => setSheet(null)}
        height="82%"
        label={
          sheet === "toc"
            ? "Table of contents"
            : sheet === "settings"
              ? "Reading settings"
              : sheet === "highlights"
                ? "Highlights"
                : sheet === "progress"
                  ? "Reading progress"
                  : undefined
        }
      >
```

### - [ ] Step 7.2: Type-check

Run: `pnpm exec tsc -b --noEmit`
Expected: clean exit.

### - [ ] Step 7.3: Verify in devtools

Open one of the sheets. In Chrome devtools → Elements → select the sheet div → check the Accessibility pane shows `role: dialog`, `aria-modal: true`, and a meaningful `aria-label`.

### - [ ] Step 7.4: Commit

```bash
git add src/components/MobileReader.tsx
git commit -m "feat(sheet): aria-label each mobile sheet by panel kind"
```

---

## Task 8: Manual verification matrix on Android

Final QA pass on the real target. No code changes — this is the acceptance gate before merge.

**Files:** none.

### - [ ] Step 8.1: Build and run on Android

```bash
pnpm tauri android dev
```

(Desktop dev is fine for quick checks during development, but this final pass must be on Android because the gesture timing and touch semantics differ from mouse.)

### - [ ] Step 8.2: Walk the matrix

For **each** of the four sheets — TOC, Settings/Reading, Highlights, Progress:

- [ ] Sheet opens at default snap with slide-up + scrim fade
- [ ] Tap backdrop → closes; the close animation slides from the *current* snap (not jumps to default first)
- [ ] Tap the X close button inside the panel header → closes
- [ ] Short drag up (<20% of full→default gap) → snaps back to default
- [ ] Long drag up → snaps to full
- [ ] Short drag down (<25% of default height) → snaps back to default
- [ ] Long drag down → dismisses
- [ ] From full: short drag down → snaps back to full
- [ ] From full: medium drag down (past default boundary) → snaps to default
- [ ] From full: long drag down → dismisses (one-gesture flick)
- [ ] Fast flick up from default with tiny distance → still goes to full (velocity threshold)
- [ ] Fast flick down from default with tiny distance → still dismisses
- [ ] Scrollable body (settings list / TOC list / highlights list) scrolls without moving the sheet
- [ ] Backdrop opacity fades visibly while dragging toward dismiss
- [ ] OS reduce-motion on → drag works, settle is instant

### - [ ] Step 8.3: Push the branch

Once every box is ticked:

```bash
git push -u origin feat/ui-ux-improvements
```

Open a PR against `main` with a one-line summary plus a checklist mirroring Step 8.2.

---

## Self-review notes (resolved)

- Spec section "UX decisions" → Task 4 implements the snap thresholds; Task 5 implements the backdrop fade; Task 7 covers the optional safe-area / ARIA polish; Task 6 covers reduced-motion.
- Spec section "Edge cases" → tap-vs-drag arbitration is in Task 3 (TAP_THRESHOLD branch); multi-touch is in Task 3 (`startRef.current !== null` gate); `pointercancel` is in Task 3 (`onPointerCancel={onDragPointerUp}`); `open` flipping false mid-drag is handled because Task 2's phase effect clears `dragging`/`dragOffset` on the transition into "exit"; safe-area inset is read in Task 2 (`readSafeAreaInsetTop`).
- All function and type names used in later tasks (`baselineTranslateY`, `clampTranslateY`, `decideSnap`, `velocityFromSamples`, `TAP_THRESHOLD`, `Snap`, `SnapDims`, `MoveSample`) are defined in Task 1 exactly as referenced.
- No placeholders — every code step contains the literal code to land.
