# Library & dialog animation pass

**Date:** 2026-05-23
**Branch:** feat/ui-animations

## Problem

The first animation pass (`AnimatedSwap`, `AnimatedPanel`, `MobileSheet`, motion tokens) covered the
top-level Library ↔ Reader transition and the reader's own side panels / bottom sheets. Two
families of UI in the Library shell still hard-cut:

1. **Modal dialogs** — `ConfirmDialog`, `ImportChoiceModal`, `DownloadRangeDialog` pop in
   instantly. They look like the OS dropped a card on top.
2. **Full-screen surfaces from the bottom nav** — `SettingsSheet` and `DownloadQueueView` appear
   without entry, even though `SettingsSheet`'s shape on mobile is identical to the in-reader
   `MobileSheet`.
3. **Shelf swaps** — switching the active tab/filter, or opening a Store source's `NovelDetailView`
   inside the Library shell, replaces the content with no transition.

`EditBookModal` already has its own enter/exit machine that matches the motion language; leave it.

## Motion language

All timings/easings come from `src/styles/motion.ts` (`MOTION` + `EASE`) — no new tokens.

| Surface | Enter | Exit | Animation |
|---|---|---|---|
| Modal dialog scrim | 240 ms | 180 ms | `leaflet-backdrop-enter/exit` (already exists) |
| Modal dialog card | 240 ms | 180 ms | **new** `leaflet-dialog-enter/exit`: opacity 0→1 + scale 0.94→1 / opacity 1→0 + scale 1→0.96 |
| Mobile full-screen | 240 ms | 180 ms | `leaflet-sheet-enter/exit` (already exists) — translateY 100% → 0 |
| Desktop full-screen | 240 ms | 180 ms | **new** `leaflet-fullscreen-enter/exit`: opacity 0→1 + scale 0.96→1 / opacity 1→0 + scale 1→0.98 |
| Shelf swap | 280 ms | 200 ms | `leaflet-view-enter/exit` (already exists) — opacity + translateY + scale |

## New components

### `src/components/AnimatedDialog.tsx`

Wraps centered dialog cards with a scrim + scale-pop. Same lifecycle as `MobileSheet`/`AnimatedPanel`.

```ts
interface Props {
  open: boolean;
  onScrimClick?: () => void;
  children: ReactNode;       // the card content (no scrim, no centering)
  zIndex?: number;            // default 200
}
```

DOM shape:

```
<div style="position: fixed; inset: 0; z-index: ${zIndex}; display: flex; align-items: center; justify-content: center">
  <div class="leaflet-backdrop-enter|exit" style="position: absolute; inset: 0; background: rgba(0,0,0,0.42); cursor: pointer" onClick={onScrimClick}/>
  <div class="leaflet-dialog-enter|exit" style="position: relative">
    {children}
  </div>
</div>
```

Lifecycle states (`phase: "enter" | "open" | "exit" | null`):

- Initial: `phase = open ? "enter" : null`. `null` → return `null`.
- `open: false → true` → `setPhase("enter")` → after `MOTION.med` (240 ms) → `setPhase("open")` (drop the
  enter class so it's not stuck during the user's interaction).
- `open: true → false` → `setPhase("exit")` → after `MOTION.fast` (180 ms) → `setPhase(null)` (unmount).
- `lastChildrenRef` preserves the children seen during exit so the close animation doesn't show
  an empty frame.
- Honors `useReducedMotion()`: when reduced, no class is applied and timers collapse to 0.

### `src/components/AnimatedFullScreen.tsx`

Same shape and lifecycle as `AnimatedDialog`, but layout-aware:

```ts
interface Props {
  open: boolean;
  layout: "mobile" | "desktop";
  onScrimClick?: () => void;  // optional — full-screen views usually have their own back button
  children: ReactNode;
  zIndex?: number;            // default 150
}
```

- `layout === "mobile"`: full-viewport panel, slides up from the bottom (reuses
  `leaflet-sheet-enter/exit`). No scrim — the content is opaque, full-bleed.
- `layout === "desktop"`: centered modal with scrim, content uses `leaflet-fullscreen-enter/exit`.

The lifecycle and `lastChildrenRef` pattern are identical to `AnimatedDialog`.

## CSS additions (`src/styles/global.css`)

```css
@keyframes leaflet-dialog-enter {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes leaflet-dialog-exit {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.96); }
}
.leaflet-dialog-enter { animation: leaflet-dialog-enter 240ms cubic-bezier(0.32, 0.72, 0, 1) both; }
.leaflet-dialog-exit  { animation: leaflet-dialog-exit 180ms cubic-bezier(0.4, 0, 1, 1) both; }

@keyframes leaflet-fullscreen-enter {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes leaflet-fullscreen-exit {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.98); }
}
.leaflet-fullscreen-enter { animation: leaflet-fullscreen-enter 240ms cubic-bezier(0.32, 0.72, 0, 1) both; }
.leaflet-fullscreen-exit  { animation: leaflet-fullscreen-exit 180ms cubic-bezier(0.4, 0, 1, 1) both; }
```

Existing keyframes (`leaflet-backdrop-*`, `leaflet-sheet-*`, `leaflet-view-*`) are unchanged.

## Refactors to existing dialogs/sheets

Each of these components currently renders its own scrim + centering. Strip that outer wrapper out
so the wrapper component owns it. Each component's internal card markup stays unchanged.

- `src/components/ConfirmDialog.tsx`
- `src/components/ImportChoiceModal.tsx`
- `src/components/DownloadRangeDialog.tsx`
- `src/components/SettingsSheet.tsx` — already branches mobile vs desktop internally; the new
  wrapper subsumes that branching. The bottom-bar / settings rows stay.
- `src/components/DownloadQueueView.tsx`

Each will lose its `position: fixed; inset: 0; background: rgba(0,0,0,0.42); zIndex: ...` outer wrapper
and just export the card content. Keyboard handlers (Escape, focus trap) stay on the inner
component — they don't depend on the scrim.

`SaveAsOfflineBookDialog` is in scope only if it's a modal-style dialog inside Library. (It's not
currently wired into Library's modal stack — leave it for a follow-up.)

## Library wiring (`src/components/Library.tsx`)

### Dialogs
Replace:
```tsx
{pendingDelete && <ConfirmDialog ... />}
```
with:
```tsx
<AnimatedDialog open={pendingDelete !== null} onScrimClick={cancelDelete}>
  {pendingDelete && <ConfirmDialog ... />}
</AnimatedDialog>
```

Same shape for `docxChoiceOpen` (`ImportChoiceModal`) and `sourceDetailRangeDialog`
(`DownloadRangeDialog`).

### Full-screen views
Replace:
```tsx
{queueOpen && <DownloadQueueView ... />}
{settingsOpen && <SettingsSheet ... />}
```
with:
```tsx
<AnimatedFullScreen open={queueOpen} layout={layout} onScrimClick={() => setQueueOpen(false)}>
  {queueOpen && <DownloadQueueView ... />}
</AnimatedFullScreen>
<AnimatedFullScreen open={settingsOpen} layout={layout} onScrimClick={() => setSettingsOpen(false)}>
  {settingsOpen && <SettingsSheet ... />}
</AnimatedFullScreen>
```

### Shelf cross-fade
Wrap the shelf / Store / NovelDetail content area with `AnimatedSwap`:

```tsx
<AnimatedSwap
  viewKey={
    sourceDetailView
      ? `novel:${sourceDetailView.libraryEntryId ?? sourceDetailView.novelUrl}`
      : `tab:${tab}`
  }
>
  {sourceDetailView
    ? <NovelDetailView ... />
    : tab === "store"
      ? <Store ... />
      : <Shelf books={visible} ... />}
</AnimatedSwap>
```

Where the shelf area was previously inline. The exact placement of the wrap depends on how
Library currently composes the body — the wrap goes around the body area, not the persistent
header/footer (so the title bar and bottom nav don't fade with the content).

## Non-goals (deferred)

- `DocxManageView` cross-fade — full-screen view inside Library, but it's an editing surface, not
  a navigation surface. Skip.
- `EditBookModal` — already animated, keep it.
- Animating the filter chip selection itself (the small highlight under the active chip) — out of
  scope; this is about page transitions, not micro-interactions.
- `SaveAsOfflineBookDialog` — not currently triggered from Library's modal stack; leave for a
  follow-up if and when it lands.

## Reduce-motion

Both wrappers gate on `useReducedMotion()`:

- When reduced, the wrapper sets `phase` to `"open"` (skipping enter) on open and `null` on close
  (skipping exit), and never applies the animation class.
- `global.css` already has a `prefers-reduced-motion: reduce` override forcing
  `animation-duration: 0.01ms !important`. That stays — belt-and-suspenders so users with reduce-
  motion enabled at the OS level never see motion regardless of which wrapper is in play.

## Test plan

1. **Modal dialog enter/exit** — open and close each of ConfirmDialog / ImportChoiceModal /
   DownloadRangeDialog. Confirm scrim fades and card scales 0.94→1.
2. **Mobile full-screen** — at phone width, open SettingsSheet from bottom nav, then
   DownloadQueueView. Confirm both slide up from the bottom.
3. **Desktop full-screen** — at desktop width, same two surfaces. Confirm both fade-pop centered.
4. **Shelf swap** — switch between All / Reading / Finished / Wishlist / Store tabs. Confirm the
   content cross-fades each time without the header/nav blinking.
5. **Store → NovelDetail** — click into a Store source. Confirm the Library shell stays still
   while the body cross-fades into the detail view, and the back-out cross-fades the shelf back.
6. **Reduce-motion** — toggle Playwright `emulateMedia({reducedMotion: 'reduce'})`, repeat 1–5.
   Confirm everything is instant; no flashes of off-screen content; no stuck classes.
7. **Stacking** — confirm the streaming-overlay wrapper from the earlier fix still takes z-index
   priority over Library dialogs that share the App shell.
