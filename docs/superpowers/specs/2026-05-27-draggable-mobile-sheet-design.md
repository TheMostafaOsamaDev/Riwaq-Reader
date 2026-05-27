# Draggable mobile sheet

**Date:** 2026-05-27
**Branch:** feat/ui-ux-improvements

## Problem

`src/components/MobileSheet.tsx` is the shared bottom-sheet chrome for all four mobile
reader menus — TOC, Settings/Reading, Highlights, and Progress — instantiated from
`src/components/MobileReader.tsx:695-768`. Today the sheet has a single fixed height
(`82%`, passed via the `height` prop) and the only way to dismiss it is to tap the
backdrop or the X icon inside the panel's header. There is no way to expand a sheet
to take the full viewport, and the dismiss interaction does not match what users
expect from a modern native bottom sheet.

## Goals

1. The user can drag any mobile sheet vertically.
2. Three resting positions ("snaps"):
   - **full** — sheet expanded to the top of the viewport (with a safe-area gap)
   - **default** — the current 82% height; this is also the entry snap
   - **dismissed** — sheet animates off the bottom and unmounts (current close)
3. From the **default** snap: dragging up snaps to **full**; dragging down dismisses;
   short drags snap back.
4. From the **full** snap: a short drag down snaps back to **full**; a longer drag
   down snaps to **default**; a much longer drag (or fast flick) dismisses.
5. Tap-on-X-close and tap-on-backdrop dismissal continue to work.
6. Inner scrollable content (settings list, TOC list, highlights list) continues to
   scroll without interfering with the drag gesture.

## Non-goals

- Rubber-banding / overscroll past the snap bounds.
- A keyboard-driven equivalent (Escape, arrow keys). This is a touch-first feature
  for `MobileReader`; the desktop `PanelShell` is untouched.
- An animation library. The project today uses CSS keyframes and direct DOM/state
  manipulation, and the gesture is small enough to keep that way.
- A test runner. The repository has none today (no `test` script in `package.json`).
  We extract a pure snap-decision function so a runner can be added later cheaply.

## Scope

All four sheets in `MobileReader.tsx` (TOC, Settings/Reading, Highlights, Progress)
inherit the new behavior because they share `MobileSheet`. The 4 call sites do not
change — they still pass `open` and `onClose` only. The `height` prop continues to
control the **default** snap height.

The desktop side panel (`AnimatedPanel`, `PanelShell`) is out of scope.

## UX decisions

| Decision | Choice |
|---|---|
| Snap point count | 3 (full / default / dismissed) |
| Drag zone | Handle pill + header strip (top ~52px). Body is not a drag surface. |
| Full-screen aesthetic | Keep the rounded top corners and handle. Leave a `env(safe-area-inset-top, 24px)` gap above the sheet so the notch/status bar shows through. |
| Tap vs drag threshold | 6px total movement |
| Velocity sample window | last ~80ms of `pointermove` samples |
| Distance threshold up (default → full) | 20% of the (full → default) gap |
| Distance threshold down (default → dismissed) | 25% of the default-height value |
| Velocity threshold (either direction) | 500 px/s |
| Rubber-banding | none — drag clamps strictly between full and dismissed |

## Architecture

All changes live inside `src/components/MobileSheet.tsx` and one new sibling module
for the pure snap-decision helper.

### New file: `src/components/sheetSnap.ts`

A non-React module containing the snap decision and small helpers. Pure functions,
no DOM, no React imports.

```ts
export type Snap = "full" | "default" | "dismissed";

export interface SnapDims {
  /** Sheet's full-screen top inset (px), e.g. env(safe-area-inset-top) resolved. */
  fullInsetTop: number;
  /** Viewport height in px. */
  viewportH: number;
  /** Default snap height in px (the rendered "82%"). */
  defaultH: number;
}

export interface SnapInput {
  fromSnap: Snap;          // "dismissed" never appears as input — sheet is unmounted
  offsetPx: number;        // signed: + = dragged down, − = dragged up
  velocityPxPerSec: number; // signed: + = moving down, − = moving up
  dims: SnapDims;
}

export function decideSnap(input: SnapInput): Snap;

/** translateY in px for a given snap, relative to a sheet rendered at the
 *  full-snap position. `default` and `dismissed` are positive (downward). */
export function baselineTranslateY(snap: Snap, dims: SnapDims): number;
```

### Changes to `src/components/MobileSheet.tsx`

The existing `phase` lifecycle (`enter` | `open` | `exit` | `null`) is preserved
verbatim — it owns first-mount slide-up and final-unmount slide-down. Drag is layered
on top and only operates while `phase === "open"`.

New state inside the component:

```ts
const [snap, setSnap] = useState<Snap>("default");
const [dragOffset, setDragOffset] = useState<number>(0);
const [dragging, setDragging] = useState<boolean>(false);
const dimsRef   = useRef<SnapDims>(/* … measured on mount + window resize */);
const startRef  = useRef<{ y: number; t: number; snap: Snap } | null>(null);
const samplesRef = useRef<Array<{ y: number; t: number }>>([]); // ring of recent pointermove samples
```

DOM shape (only what changes shown):

```
<div style="position: absolute; inset: 0; z-index: 20">
  <div onClick={onClose}
       className={backdropClass}
       style="…opacity = backdropOpacity(snap, dragOffset, dims)…"/>

  <div className={sheetClass}
       onPointerDown={onHeaderPointerDown}
       onPointerMove={onHeaderPointerMove}
       onPointerUp={onHeaderPointerUp}
       onPointerCancel={onHeaderPointerUp}
       style="
         position: absolute;
         left: 0; right: 0; bottom: 0;
         height: calc(100dvh - env(safe-area-inset-top, 24px));
         transform: translateY(${baselineTranslateY(snap, dims) + dragOffset}px);
         transition: ${dragging ? 'none' : 'transform 240ms cubic-bezier(0.32, 0.72, 0, 1)'};
         …existing chrome…
       ">
    <DragZone>     <!-- handle + header strip; pointer listeners attached here -->
      …
    </DragZone>
    <ScrollArea>   <!-- existing body; no pointer listeners -->
      …
    </ScrollArea>
  </div>
</div>
```

The sheet element is now sized to the **full** snap height (`calc(100dvh - safe-area-inset-top)`).
`translateY` brings it down to the default or out of view for dismissed. Expanding to
full is therefore a transform-only animation — no height change, no body relayout.

### Pointer event semantics

```
onPointerDown(e):
  if (e.button !== 0 && e.pointerType === "mouse") return
  if (phase !== "open") return
  if (e.target is inside DragZone) {
    e.currentTarget.setPointerCapture(e.pointerId)
    startRef.current = { y: e.clientY, t: performance.now(), snap }
    samplesRef.current = [{ y: e.clientY, t: performance.now() }]
    // do NOT set dragging=true yet — wait for movement threshold
  }

onPointerMove(e):
  const s = startRef.current
  if (!s) return
  const dy = e.clientY - s.y
  if (!dragging) {
    if (Math.abs(dy) >= 6) setDragging(true)
    else return
  }
  pushSample(samplesRef, { y: e.clientY, t: performance.now() }, maxAgeMs = 120)
  const clamped = clampToSnapRange(baselineTranslateY(s.snap, dims) + dy, dims)
  setDragOffset(clamped - baselineTranslateY(s.snap, dims))

onPointerUp(e):
  const s = startRef.current
  if (!s) { return }
  startRef.current = null
  if (!dragging) { samplesRef.current = []; return }   // tap — no snap change
  const velocity = velocityFromSamples(samplesRef.current)
  const target = decideSnap({ fromSnap: s.snap, offsetPx: dragOffset, velocityPxPerSec: velocity, dims })
  setDragging(false)
  setDragOffset(0)
  if (target === "dismissed") onClose()
  else setSnap(target)
```

`pointercancel` is wired to `onPointerUp` so an interrupted gesture still settles.

### Snap decision rules

(Identical to the rules approved during brainstorming.)

`gapFullToDefault = viewportH - defaultH - fullInsetTop` — the px the sheet must
translate down to move from the full snap to the default snap.

```
from "default":
  if offsetPx < 0 and (|offsetPx| >= 0.20 * gapFullToDefault or velocity < -V_THRESH)
    → "full"
  if offsetPx > 0 and (offsetPx >= 0.25 * defaultH or velocity > V_THRESH)
    → "dismissed"
  else → "default"

from "full":
  if offsetPx > gapFullToDefault + 0.25 * defaultH or velocity > V_THRESH
    → "dismissed"
  if offsetPx >= gapFullToDefault
    → "default"
  else → "full"
```

Constants:

```ts
export const V_THRESH = 500;       // px/sec — flick threshold
export const TAP_THRESHOLD = 6;    // px — below this, treat as tap
```

### Backdrop opacity

```
const visibleH = dims.viewportH - (baselineTranslateY(snap, dims) + dragOffset)
                                - dims.fullInsetTop;
// visibleH between [0, viewportH - fullInsetTop]
const pinThreshold = dims.defaultH;
const opacity = visibleH >= pinThreshold ? 1 : Math.max(0, visibleH / pinThreshold);
```

Above the default position the scrim is pinned to 1.0 (its current behavior). Dragging
toward dismissed fades the scrim out in lockstep with the sheet.

### Reduced motion

`useReducedMotion()` is already in the file. When `true`:

- Drag tracking is unchanged (direct manipulation, not animation).
- The post-release settle transition is removed — set `transition: none` and let
  `snap`/`dragOffset` jump to the final position.
- Existing `leaflet-sheet-enter` / `leaflet-sheet-exit` keyframes remain skipped under
  reduced motion (current behavior).

### Resetting state on close/reopen

When `open` flips false (regardless of how — onClose tap, drag-to-dismiss, backdrop
tap), the existing `phase` machine transitions to `exit` and unmounts. When the sheet
next opens, internal state initialises to `snap: "default", dragOffset: 0, dragging: false`.

If the sheet is **fully expanded** and the user taps the backdrop or X, the exit
animation should begin from the **full** position, not jump back to default first.
This means the existing `leaflet-sheet-exit` keyframe (which animates `translateY(0 → 100%)`)
is wrong when the user is at full or in the middle of a drag. Replacement: drop the
class-based exit keyframe entirely and instead drive the exit via the same React-state
transition machinery used for snap settles (set `dragOffset = 0`, `snap = "dismissed"`
position, and let the 240ms transform-transition play). The `leaflet-sheet-enter`
keyframe stays for the initial mount.

### Accessibility additions

Small free wins while we're touching the component:

- `role="dialog"` and `aria-modal="true"` on the sheet element.
- `aria-label` derived from a new optional `Props.label` (e.g., `"Reading settings"`,
  `"Table of contents"`) passed by each call site in `MobileReader.tsx`. Falls back
  to undefined if not passed.

Out of scope: focus trapping, Escape-to-close keyboard handling.

## Edge cases

- **Tap inside drag zone (e.g., X close button at the top right of `SettingsPanel`):**
  movement stays under `TAP_THRESHOLD`, so `dragging` never flips true. `pointerup`
  takes the tap-path. The button's `onClick` fires normally on touch/click.
- **Multi-touch:** secondary pointers are ignored. `startRef.current !== null` gates
  all move/up handlers, and `setPointerCapture` keeps the first pointer authoritative.
- **`pointercancel`:** wired to `onPointerUp` so the sheet still settles using the
  last sample.
- **Window resize / orientation change:** `dimsRef` is recomputed via a
  `ResizeObserver` on the sheet's outer container (or a `window` resize listener if
  that's enough). If the sheet is at `full` during a resize, it stays at `full`.
- **`open` flips false while user is mid-drag:** the gesture is abandoned —
  `startRef.current` is cleared on the next render's effect, and the exit transition
  proceeds from the current visual position.
- **Browser pull-to-refresh:** Tauri's Android WebView disables PTR by default. Add
  `overscroll-behavior: contain` on the sheet's outer container as a defensive
  fallback.

## Files changed

- `src/components/MobileSheet.tsx` — gesture handlers, snap state, dragOffset,
  exit-animation rewrite, optional `label` prop, ARIA attributes.
- `src/components/sheetSnap.ts` — **new** — pure `decideSnap`, `baselineTranslateY`,
  `clampToSnapRange`, `velocityFromSamples`, constants.
- `src/components/MobileReader.tsx` — pass `label` to `<MobileSheet>` (optional, low
  priority — can land in a follow-up).
- `src/styles/global.css` — remove `.leaflet-sheet-exit` usage (the exit transition
  now lives in the inline `transition` on the sheet element). `leaflet-sheet-enter`
  stays for first-mount. `leaflet-backdrop-enter/exit` stay as-is.

## Testing

No test runner exists in the repo today. Verification is manual:

- **Pure-function isolation** — `sheetSnap.ts` is trivial to inspect; if a runner is
  added later, unit-testing `decideSnap` is a one-pager.
- **Manual matrix on Android (Tauri target):**
  - Each of the 4 sheets opens at `default`, dismisses by backdrop tap, dismisses by
    X tap.
  - Drag handle/header up — short drag snaps back, long drag goes to `full`.
  - Drag handle/header down — short drag snaps back, long drag dismisses.
  - From `full`, drag down — short snaps back to `full`, medium snaps to `default`,
    long dismisses.
  - Flick up with tiny distance — still snaps to `full` (velocity threshold).
  - Flick down with tiny distance — still dismisses (velocity threshold).
  - Tap X close button on the panel header — closes without triggering drag.
  - Scroll the settings list, TOC list, highlights list — content scrolls, sheet
    does not move.
  - Tap backdrop — closes.
  - OS reduced-motion enabled — drag still works, settle is instant.
- **Desktop dev sanity check** — narrow the viewport, use a mouse: `PointerEvent`
  fires the same; drag should work the same.

## Open questions

None.
