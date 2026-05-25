# Simplify page-transition animations

**Date:** 2026-05-25
**Branch:** feat/ui-animations

## Problem

The current motion language stacks too many simultaneous effects on every
page-level transition:

- `leaflet-view-enter/exit` (Library ↔ Reader ↔ Stream, Library shelf swap):
  opacity + translateY + scale
- `leaflet-dialog-enter/exit` (ConfirmDialog, ImportChoiceModal,
  DownloadRangeDialog): opacity + scale
- `leaflet-fullscreen-enter/exit` (desktop SettingsSheet / DownloadQueueView):
  opacity + scale

The result feels busy. The user wants one simpler motion across these surfaces.
Mobile bottom-sheet and desktop side-panel slide motions stay — they read as
physical surfaces and the slide gives a strong "where it came from" cue.

## Decision

Collapse the three page-level keyframe pairs to **pure cross-fade**. Keep the
class names so consumers don't change. Switch the fade-in easing from the
spring (`cubic-bezier(0.32, 0.72, 0, 1)`) to plain `ease-out` — the spring was
designed for transforms; on pure opacity its perceptual effect is near-zero.
Exit easing keeps `cubic-bezier(0.4, 0, 1, 1)` (a sharp ease-in, idiomatic for
fade-out).

## Motion language

| Surface | Enter | Exit | Animation |
|---|---|---|---|
| Page transition (`AnimatedSwap`) | 240 ms `ease-out` | 180 ms ease-in | opacity 0→1 / 1→0 |
| Modal dialog scrim | 240 ms | 180 ms | `leaflet-backdrop-enter/exit` (unchanged) |
| Modal dialog card | 240 ms `ease-out` | 180 ms ease-in | opacity 0→1 / 1→0 |
| Mobile bottom-sheet | 240 ms | 180 ms | `leaflet-sheet-enter/exit` (unchanged — slide-up) |
| Desktop full-screen | 240 ms `ease-out` | 180 ms ease-in | opacity 0→1 / 1→0 |
| Desktop side panel | 240 ms | 180 ms | `leaflet-panel-enter-*/exit-*` (unchanged — slide) |

Durations align with the existing `MOTION.med` (240 ms) / `MOTION.fast` (180 ms)
tokens. No new tokens.

## Changes

### `src/styles/global.css`

Rewrite three keyframe pairs to pure opacity, and update the matching `.leaflet-*`
class declarations to use `ease-out` for enter:

```css
@keyframes leaflet-view-enter {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes leaflet-view-exit {
  from { opacity: 1; }
  to   { opacity: 0; }
}
.leaflet-view-enter { animation: leaflet-view-enter 240ms ease-out both; }
.leaflet-view-exit  { animation: leaflet-view-exit 180ms cubic-bezier(0.4, 0, 1, 1) both; pointer-events: none; }

@keyframes leaflet-dialog-enter {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes leaflet-dialog-exit {
  from { opacity: 1; }
  to   { opacity: 0; }
}
.leaflet-dialog-enter { animation: leaflet-dialog-enter 240ms ease-out both; }
.leaflet-dialog-exit  { animation: leaflet-dialog-exit 180ms cubic-bezier(0.4, 0, 1, 1) both; }

@keyframes leaflet-fullscreen-enter {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes leaflet-fullscreen-exit {
  from { opacity: 1; }
  to   { opacity: 0; }
}
.leaflet-fullscreen-enter { animation: leaflet-fullscreen-enter 240ms ease-out both; }
.leaflet-fullscreen-exit  { animation: leaflet-fullscreen-exit 180ms cubic-bezier(0.4, 0, 1, 1) both; }
```

What gets dropped from each:

- `view-enter/exit`: `translateY(16px → 0)` + `scale(0.96 → 1)` on enter,
  `translateY(0 → -8px)` + `scale(1 → 1.04)` on exit. Spring easing on enter
  becomes `ease-out`. Enter duration drops 280 ms → 240 ms; exit duration
  drops 200 ms → 180 ms. (Realigns this surface with the dialog/fullscreen
  pair which were already on 240 / 180.)
- `dialog-enter/exit`: `scale(0.94 → 1)` on enter, `scale(1 → 0.96)` on exit.
  Spring easing on enter becomes `ease-out`. Durations unchanged (240 / 180).
- `fullscreen-enter/exit`: `scale(0.96 → 1)` on enter, `scale(1 → 0.98)` on
  exit. Spring easing on enter becomes `ease-out`. Durations unchanged
  (240 / 180).

### `src/components/AnimatedSwap.tsx`

One line change inside the effect that promotes `enter → idle` and drops the
exit slot:

```ts
const t = setTimeout(
  () => { /* unchanged body */ },
  reduced ? 0 : MOTION.med,  // was MOTION.slow
);
```

Reason: the previous `leaflet-view-enter` keyframe ran 280 ms, so the timer
matched. The new keyframe runs 240 ms, so holding 280 ms leaves the class on
the element 40 ms past the animation completing — harmless visually, but
inconsistent. `MOTION.med` (240 ms) realigns timer and keyframe.

## Stays unchanged

- `leaflet-backdrop-enter/exit` — already pure opacity.
- `leaflet-sheet-enter/exit` — mobile sheet keeps its slide-up (translateY 100%).
- `leaflet-panel-enter-right/left` + exits — desktop side panel keeps its slide.
- `leaflet-chapter-enter`, `leaflet-chapter-toast`, `leaflet-skeleton` —
  micro-interactions inside the reader, not page-level transitions.
- `src/styles/motion.ts` — `MOTION` and `EASE` tokens untouched. The new
  keyframes write timing/easing inline because the old keyframes did too;
  refactoring them onto tokens is out of scope.
- `src/components/AnimatedDialog.tsx`, `AnimatedFullScreen.tsx`,
  `AnimatedPanel.tsx`, `MobileSheet.tsx` — no changes. They apply the same
  class names; the keyframes underneath change.
- All dialog / sheet / panel call-sites in `App.tsx`, `Library.tsx`, reader
  components — no changes.

## Reduce-motion

No change. The keyframes still respect `prefers-reduced-motion: reduce` via
the existing global override in `global.css`
(`animation-duration: 0.01ms !important`), and wrapper components still gate
via `useReducedMotion()`.

## Non-goals

- Refactoring inline `240ms`/`180ms` strings inside keyframe declarations onto
  `MOTION` tokens. Possible follow-up; orthogonal to the motion simplification.
- Touching `leaflet-chapter-enter` (chapter content reveal, ~8px lift). It's a
  micro-interaction inside the reader, not a page transition.
- Touching `leaflet-chapter-toast` (centered chapter-title pill). Discrete UI
  element with its own intentional pop.
- Collapsing the three keyframe pairs into one shared `leaflet-fade-*` pair
  (would require changing class names in `AnimatedSwap`, `AnimatedDialog`,
  `AnimatedFullScreen`). Considered and rejected — the keyframe pairs may
  diverge later (e.g., dialog gaining a subtle scale back), and the
  duplication cost is three near-identical four-line blocks.

## Test plan

1. **Page transition** — open a book (Library → Reader), close it (Reader →
   Library), open a Store novel and Read it (Library → Stream), close the
   stream (Stream → Library). Confirm clean cross-fade with no rise and no
   scale.
2. **Library shelf swap** — switch between All / Reading / Finished / Wishlist
   / Store tabs. Confirm content cross-fades with no transform.
3. **Modal dialogs** — open and close ConfirmDialog (delete a book),
   ImportChoiceModal, DownloadRangeDialog. Confirm scrim fades and card fades
   in/out without scale-pop.
4. **Desktop full-screen** — at desktop width, open SettingsSheet and
   DownloadQueueView from the bottom nav. Confirm both fade in/out without
   scale-pop.
5. **Mobile bottom-sheet (unchanged)** — at phone width, open SettingsSheet
   and DownloadQueueView. Confirm both still slide up from the bottom.
6. **Desktop side-panel (unchanged)** — open the reader's TOC / highlights /
   settings panels. Confirm they still slide in from their anchor edge.
7. **Reduce-motion** — toggle `prefers-reduced-motion: reduce`, repeat 1–6.
   Confirm everything is instant; no stuck classes.
