# Mobile reader: draggable progress scrubber with chapter-title preview

Status: design approved (text-level)
Owner: Mostafa Osama
Scope: `src/components/MobileReader.tsx` only

## Problem

The mobile reader's progress bar today (`MobileReader.tsx:417-508`) is a
read-only visual indicator — chapter navigation has to go through the
small prev/next buttons flanking it, or through the TOC sheet. Users
asked for a way to scrub through a novel by dragging the bar directly,
with a chapter-title preview that shows the target chapter while the
drag is active and disappears when the drag ends.

## Current state

- **Desktop** (`DesktopReader.tsx:539-574`) is already draggable. It
  commits the chapter change LIVE on every pointer move that crosses a
  chapter boundary. Chapter title is exposed via `aria-valuetext` but
  there's no visible preview chip during the drag.
- **Mobile** (`MobileReader.tsx:417-508`) is inert — `pct` drives the
  fill width, ticks, and thumb position, but no pointer events are
  bound to the track.
- **Granularity**: position is chapter-based — `pct = (currentChapter+1)/chapterCount`.
  No paragraph or character offsets at the book-wide level. Each
  chapter exposes `.title`.

## Approach

Stay in `MobileReader.tsx`. Add the same `chapterFromClientX`
pointer-capture pattern as desktop, but switch to **commit-on-release**
semantics because (a) chapter loads aren't free and (b) live chapter
swaps under a finger are visually disruptive on a small screen.

Add a floating chip above the thumb that shows
`Chapter N — <title>` while dragging, fading in on drag-start and out
on drag-end.

### File touched

Only `src/components/MobileReader.tsx`.

### State (local to MobileReader)

```ts
const [draggingTarget, setDraggingTarget] = useState<number | null>(null);
const trackRef = useRef<HTMLDivElement>(null);
const draggingRef = useRef(false);
```

`draggingTarget` is the chapter index the thumb is hovering over
during a drag; `null` when not dragging. Drives the thumb position,
fill width, and chip visibility/content.

### Helper

Same shape as desktop's — copy it into MobileReader:

```ts
function chapterFromClientX(clientX: number): number | null {
  const el = trackRef.current;
  if (!el || chapterCount === 0) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0) return null;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.min(chapterCount - 1, Math.floor(ratio * chapterCount));
}
```

### Pointer event handlers

```ts
onPointerDown:
  - if chapterCount <= 1, return (bar inert)
  - currentTarget.setPointerCapture(pointerId)
  - draggingRef.current = true
  - setDraggingTarget(chapterFromClientX(clientX) ?? currentChapter)

onPointerMove:
  - if !draggingRef.current, return
  - const next = chapterFromClientX(clientX)
  - if next !== null && next !== draggingTarget, setDraggingTarget(next)

onPointerUp / onPointerCancel:
  - if !draggingRef.current, return
  - draggingRef.current = false
  - if hasPointerCapture, releasePointerCapture(pointerId)
  - if draggingTarget !== null && draggingTarget !== currentChapter:
      onChapterChange(draggingTarget)
  - setDraggingTarget(null)
```

This pattern preserves tap-to-jump: a quick down-then-up at the same
spot fires `onChapterChange(target)` on release, matching the desktop
tap behaviour without needing a separate handler.

### Touch hit target

The visible bar stays 3px tall for the existing look. Wrap it in a
padding container so the touch target is ~27px:

```jsx
<div
  ref={trackRef}
  onPointerDown={...} ...
  style={{
    flex: 1,
    position: "relative",
    paddingBlock: 12,         // 12px above + 12px below the visible bar
    margin: "-12px 0",        // compensate so layout doesn't shift
    touchAction: "none",      // prevent vertical drag from scrolling the page
    cursor: "pointer",
  }}
>
  <div style={{ position: "relative", height: 3 }}>
    {/* existing track / fill / ticks / thumb */}
  </div>
  {/* preview chip — see below */}
</div>
```

`touchAction: "none"` is the key bit — without it, a vertical-ish
finger drag would let the browser steal the gesture for scrolling.

### Visual: thumb + fill while dragging

`pct` becomes derived:

```ts
const displayChapter = draggingTarget ?? currentChapter;
const pct = chapterCount > 0
  ? Math.round(((displayChapter + 1) / chapterCount) * 100)
  : 0;
```

So both the fill width and the thumb's `left: ${pct}%` track the
finger during drag, not the (still-frozen) chapter the reader is
showing.

### Preview chip

```jsx
{draggingTarget !== null && (
  <div
    style={{
      position: "absolute",
      left: `${pct}%`,
      bottom: "calc(100% + 8px)",
      transform: "translateX(-50%)",
      background: theme.chrome,
      color: theme.ink,
      border: `0.5px solid ${theme.rule}`,
      borderRadius: 8,
      padding: "6px 10px",
      fontSize: 11,
      fontWeight: 500,
      whiteSpace: "nowrap",
      maxWidth: 240,
      overflow: "hidden",
      textOverflow: "ellipsis",
      pointerEvents: "none",
      boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
      // tiny downward arrow at the bottom of the chip pointing at the thumb
      // (rendered as a rotated square via :after-style pseudo, or an inline span)
    }}
  >
    Chapter {draggingTarget + 1} — {chapters[draggingTarget].title}
  </div>
)}
```

The chip's `left` is bound to the same `pct` as the thumb, so they
move together. `pointerEvents: "none"` keeps the chip from
intercepting subsequent pointer events. Long titles are ellipsised
at ~240px width.

A small downward triangle at the chip's bottom centre points at the
thumb — implemented as an absolutely-positioned 8×8 square rotated
45° at `bottom: -4px; left: 50%; transform: translateX(-50%) rotate(45deg)`,
same background as the chip with a half-border so it visually merges.

### Fade in/out

Opacity transition: chip starts at `opacity: 0` and animates to
`opacity: 1` over 200ms when `draggingTarget` becomes non-null;
transitions back to `opacity: 0` over 150ms when it returns to null.
Render the chip while `draggingTarget` is non-null OR while a
fade-out is in flight — the simplest implementation is to keep the
chip mounted continuously and toggle opacity via state, but a
mount/unmount with the `opacity` transition on the OUT direction
only is good enough.

Pragmatic choice: keep it simple — render conditionally on
`draggingTarget !== null`. The "fade-out" is then an instant hide.
If that feels too snappy in testing, upgrade to a delayed unmount.

## Out of scope

- Sub-chapter (paragraph-level) granularity — would require a
  different position model.
- Desktop visible preview chip — desktop is intentionally unchanged
  per the scope decision.
- Haptic / vibration feedback on boundary crossings.
- Chapter excerpt or thumbnail in the preview chip — title only.

## Verification plan

- HMR via the running `pnpm tauri android dev` — each save reloads
  on the phone.
- Golden path: open a multi-chapter book → drag the bar slowly across
  several chapters → chip follows the thumb, content stays put →
  release → reader jumps to the target → chip disappears.
- Edges:
  - Tap-without-drag at a different spot → should still jump.
  - Drag past the left/right ends → thumb clamps; release at the
    clamped position commits the boundary chapter.
  - Drag, then lift finger over a different element → pointer capture
    keeps the up event coming back to us (or `pointercancel` fires);
    `draggingTarget` always clears.
  - Single-chapter book → bar inert; no chip; no navigation.
  - Two-chapter book → only two valid targets; chip shows whichever.
