# Bottom sheets that feel native (phone and tablet)

Status: behaviour approved in conversation; builder-check answers folded in;
awaiting the owner's approval of this document
Owner: Mostafa Osama
Scope: rebuild the gesture and motion engine of `MobileSheet`, the one bottom
sheet every phone/tablet surface uses, so it moves and responds like the
platform's own sheets, and so every sheet in the app behaves the same way.
Fix the font picker that scrolls the sheet behind it. Make Android Back close
an open sheet. No new dependencies.

Touches: `src/components/MobileSheet.tsx` (rewrite), `src/components/sheetSnap.ts`
(replaced by new pure modules), `src/store/navigation.ts` (a "layer" history
entry for Back), `src/panels/PanelShell.tsx`, `src/components/FontSelect.tsx`,
`src/components/ActionsMenu.tsx`, `src/components/ContextMenu.tsx` (touch
path), `src/components/DownloadRangeDialog.tsx`,
`src/components/update/UpdateSheet.tsx`,
`src/components/update/WhatsNewAfterUpdate.tsx`,
`src/components/MobileReader.tsx`, `src/reader/fixed/FixedPageReader.tsx`, and
their tests.

## Why

The owner reads on a phone (Galaxy A73) and a tablet (Redmi Pad SE, portrait
runs the phone UI). The sheets don't feel native. They aren't efficient or
smooth, and they don't answer gestures the way native sheets do. Two cases he
named:

- **Expanding to full screen.** Today the sheet expands only after you scroll
  its list all the way to the bottom and keep pulling. Native sheets work the
  other way around: the first upward swipe raises the sheet to full screen.
- **The font picker.** When you reach the end of the font list, the swipe
  carries on and scrolls the settings sheet behind it.

The bar is "as good as the native sheets": smooth, no weird bugs, no
inconsistency between sheets.

### What is wrong today (found in the code)

1. **Every finger movement re-renders the sheet and its contents.** Drag offset
   lives in React state (`setDragOffset` per `pointermove`), so a drag
   re-renders the whole Settings panel or a long Contents list on every frame.
   This is the main source of jank.
2. **Expansion is backwards** (see above): `onDragPointerMove` claims an upward
   gesture only `atBottom`.
3. **Font picker scroll chaining.** `FontSelect`'s `ScrollArea` has no
   `overscroll-behavior: contain`, so overscroll chains into the panel body.
   And a touch that lands on a group heading (a `div`, not a `button`) is
   treated as a sheet drag on the panel body, so pulling down there can drag
   the sheet closed instead of scrolling the fonts.
4. **Drags starting on buttons are ignored.** `onDragPointerDown` returns early
   for any `button`. Contents rows are buttons, so most of the Contents list
   can never move the sheet.
5. **Fixed, canned settle.** Release always runs the same 240 ms curve, whatever
   the flick speed. There is no rubber-banding past the top.
6. **Every sheet can go full screen.** That includes the three-row ⋮ menu,
   which becomes a mostly empty full-screen sheet.
7. **Android Back doesn't close a sheet.** Sheets aren't in history, so Back
   acts on the screen behind (it leaves the reader).
8. **Re-layout when the snap changes.** `--sheet-overhang` is a padding that
   changes on every snap, so the list re-flows when the sheet expands or
   collapses. Footers ride it and jump when the snap settles.
9. **Smaller issues.**
   - The reader wraps its panel in a second `overflow: auto` box, so there are
     two nested scrollers.
   - The What's-new sheet has no scroller at all: long notes are clipped even
     at full.
   - `DownloadRangeDialog` tags its nested picker list as
     `data-sheet-scrollable`, so the sheet hands off to the wrong scroller.

## Goals

The behaviour the owner approved, made precise:

1. **Opening.** The sheet slides up to its default height: 82% in the readers,
   other sizes elsewhere (see the call-site table).
2. **Swiping up anywhere on an expandable sheet that is below full moves the
   sheet first.** That includes swipes on its list or on a button. The sheet
   rises with the finger to full screen. Once it reaches full, the same
   continuous swipe carries on scrolling the list, without lifting the finger,
   and a fling at that point keeps scrolling with momentum.
3. **At full screen the list scrolls natively.** When the list is at its top and
   you pull down, the sheet follows the finger. A short pull drops it to the
   default height. A long pull or a quick flick closes it. Reversing direction
   in the same pull lifts the sheet back to full and then scrolls the list
   again, all in one gesture.
4. **Inner lists scroll on their own.** The font picker, and the chapter picker
   in the download-range sheet, scroll by themselves and stop at their ends.
   They never move the sheet, and they never scroll the panel behind them.
5. **Letting go keeps the flick.** The sheet settles to a snap with a spring
   that starts at the finger's release velocity. A fast flick goes to the next
   snap in its direction even after a short drag. Pulling past the top, or
   pulling up on a sheet that can't expand, gives elastic resistance and
   springs back.
6. **Catching it mid-flight.** Touching a sheet while it is still animating
   stops it under the finger and continues as a drag from there. There is no
   jump.
7. **Small sheets don't expand.** The ⋮ action menus size to their content.
   Swiping up only gives the elastic resistance.
8. **Android Back closes the topmost open sheet** before it does anything else.
   Mouse back buttons and Alt+← behave the same on a narrow desktop window.
   Esc also closes a sheet.
9. **One component, one behaviour.** Every sheet gets all of the above from
   `MobileSheet`. No call site re-implements a gesture.
10. **Smooth under load.** No React render per drag frame. Open, close and
    settle animations run on the compositor, so a busy main thread doesn't
    stutter them.

## Non-goals

- These aren't bottom sheets and are out of scope:
  - the desktop `SideSheet` and centred `AnimatedDialog`s;
  - `ContextMenu`'s desktop popover;
  - `EditBookModal`, a full-screen form;
  - the selection and highlight popovers.

  That includes Back closing dialogs, which can come later on the same layer
  mechanism.
- Width or placement changes on tablets and landscape phones. Sheets stay full
  width.
- New sheet content, or visual restyling of what's inside the sheets.
- A third-party drawer library.

## Anti-goals (a failure even if it technically works)

- Any sheet that behaves differently from the others for the same gesture.
- A list that stops scrolling smoothly, or loses native momentum, in the common
  case: an already-full sheet, scrolling down through Contents.
- Back that sometimes needs two presses, leaves the reader while a sheet is
  open, or eats a navigation.
- A tap on a Contents row that fires after the user was really dragging.
- Regressing what earlier fixes protected:
  - the sheet floats over the reader and never shoves it (`.riwaq-clip-window`);
  - the last control clears the gesture bar;
  - the primary button of the download-range and update sheets is reachable
    at the default height;
  - a closed sheet adds no scroll-blocking listener (`MobileSheet.test.tsx`);
  - Contents reveals the current chapter without scrolling ancestors
    (`tocReveal.ts`).

## Behaviour spec

### Snaps and sizes

Each sheet has up to three resting positions:

- **full**: the top edge sits at the safe-area top inset. Only for expandable
  sheets.
- **default**: the visible height given by the `height` prop.
- **dismissed**: entirely below the screen.

New props on `MobileSheet`:

- `expandable?: boolean` (default `true`). When false there is no full snap.
- `height` keeps today's grammar (`"82%"`, `"min(80%, 500px)"`, any CSS
  length). It also accepts `"auto"`: the sheet is as tall as its content,
  capped at 90% of the viewport (the builder may tune the cap). `"auto"`
  implies `expandable={false}`.

The sheet box is laid out once and moved only with `transform: translateY`:

- An expandable sheet's box is full-height, so dragging up never reveals a gap
  below it. That is today's approach.
- A non-expandable sheet's box is exactly its default height.
- In both cases the box extends a fixed **overdraw** (about 120 px, in the sheet
  background colour) below the screen edge. Rubber-banding and spring
  overshoot past the top then never lift the sheet's bottom off the screen.

`--sheet-overhang` is removed. Nothing re-lays out when the snap changes.

### Gesture ownership

The sheet decides who owns a touch on its **first move** past a small slop
(about 6 px). It owns the gesture by calling `preventDefault` on `touchmove`,
from a non-passive listener on the sheet element. That listener is registered
only while the sheet is mounted, never on `document`.

- If the move is mostly horizontal, the sheet stays out of it for the whole
  touch. Horizontal scrollers inside a sheet (the highlight colour rail) keep
  working.
- **Controls are content.** A vertical swipe that starts on a button, a
  Contents row, an unfocused text field or a slider behaves exactly like one
  that starts on blank list space. *(Builder-check answer, the designer's
  call.)* The exceptions:
  - Sliders (`input[type=range]`, `[role=slider]`) are claimed only when the
    first move is clearly vertical (`|dy| > 2·|dx|`), so a slightly diagonal
    slider drag still moves the slider.
  - A **focused** `input`/`textarea`, `[contenteditable]` and `[data-no-drag]`
    are never claimed, so text selection and caret drags work.
- If the touch started inside a **nested scroller**, the gesture is native and
  the sheet stays out. A nested scroller is any element between the target and
  the sheet's body whose computed `overflow-y` is `auto` or `scroll` and that
  has range to scroll. Nested scrollers get `overscroll-behavior: contain` so
  they stop at their ends.

The sheet's **body** is its main list: the first `[data-sheet-scrollable]` in
the sheet, which is the outermost one. If there is none, the body is the
sheet's own content container, which becomes `overflow-y: auto` so a sheet
like What's-new scrolls. Everything outside the body (grabber, headers, tab
switcher, footer) is **chrome**.

| Where | Sheet state | First move | Owner | What it does |
|---|---|---|---|---|
| chrome | any | up / down | sheet | drags the sheet; up at the top snap rubber-bands |
| body | expandable, below full | up | sheet | sheet rises to full, then the remainder scrolls the body (JS) |
| body | any | down, body at top | sheet | sheet moves down; reversing lifts it back to where it started, then (at full) scrolls the body (JS) |
| body | any | down, body not at top | native | ordinary scroll with native momentum (see Spike 1) |
| body | full | up | native | ordinary scroll |
| body | not expandable, scrollable | down at top | sheet | drag toward dismiss |
| body | not expandable, scrollable | otherwise | native | ordinary scroll |
| body | not expandable, not scrollable | up / down | sheet | down drags, up rubber-bands |

While the sheet owns a gesture, one function hands the finger's motion out
between the sheet and the body:

- **Upward motion** goes to the sheet first, until it reaches full. The rest
  scrolls the body, down to the body's end.
- **Downward motion** goes to the body first, until it reaches its top. The
  rest moves the sheet.

This is how native nested scrolling distributes a drag. It is a pure function
and is unit-tested.

**Scrolling a list back up is always native.** Pulling down on a list that
isn't at its top is an ordinary native scroll at every snap, default or full.
*(Builder-check answer, the designer's call.)* This matters most for Contents:
it opens at 82% already scrolled to the current chapter, and scrolling back to
earlier chapters is how it gets used. Native momentum is kept, and a fast
downward flick through the list never closes the sheet. Only a swipe up below
full is the sheet's, because that is the "expand first" rule.

**Who took the last motion decides the release.**

- If the sheet is away from the snap it started at when the finger lifts, the
  snap choice below runs and the body does not coast.
- If the sheet is resting on a snap and the body took the motion (the
  "expand, then keep scrolling" tail), the snap is unchanged. The body keeps
  scrolling, decaying in JS on `requestAnimationFrame` until it stops or hits
  an end.

That JS momentum is the only JS-driven momentum. Every gesture that starts as
a list scroll is native.

**Taps vs drags.** Once a gesture has become a sheet drag, the click that the
browser may still deliver on release is suppressed with a capture-phase
listener, active for one click or about 400 ms.

**Mouse.** On a narrow desktop window the mouse drags only from chrome, using
pointer events.

**Wheel.** The wheel mirrors touch. *(Builder-check answer, the designer's
call.)* On an expandable sheet below full, a downward wheel (`deltaY > 0`) is
consumed, from a non-passive `wheel` listener on the sheet, and expands the
sheet to full with the programmatic ease. From then on the wheel scrolls the
body natively. Without this, removing `--sheet-overhang` would leave the end
of the list unreachable by wheel at the default snap.

**Multi-touch.** Only the first touch is tracked. Later fingers are ignored
until it ends.

### Release, snap choice, and motion

**Choosing the snap.** On release, the sheet projects where it would coast to:
`projected = y + v × k`, where `k` is about 0.15 s. It picks the snap nearest to
the projection. If `|v|` is over about 700 px/s, the result is forced to be at
least the next snap in the direction of the flick. The builder tunes the
constants on the device.

**Settling.** The settle is a spring that starts at the release velocity. It is
near-critically damped, so it overshoots little or not at all, with a response
of about 0.35 to 0.45 s, tuned on the device. The spring is sampled into
keyframes in JS and played with the Web Animations API (`element.animate`,
linear easing between samples). The sheet's transform, the scrim's opacity
and the footer's transform each get keyframes from the same samples, so they
stay in lockstep on the compositor.

**Programmatic open and close.** When there is no finger velocity (open, a scrim
tap, Back, Esc, a close button), the sheet uses the app's motion tokens:
`EASE.enter` over `MOTION.med` to open, and `EASE.exit` over `MOTION.fast` to
close. Played with WAAPI too.

**Rubber band.** Past the allowed range, the offset becomes
`d × (1 − 1 / (x × 0.55 / d + 1))`, where `d` is the viewport height. That is
the iOS formula.

**Interrupting.** A `touchstart` during an animation reads the sheet's current
computed transform. It cancels all three animations, pins the transform inline,
and starts the drag from there.

**Dismissing.** When a gesture decides to dismiss, the exit spring starts
immediately with the release velocity, then `onClose()` is called. When the
parent sets `open` to false a moment later, the sheet is already exiting and
nothing restarts. The sheet unmounts when the exit animation finishes.

**Reopening.** Opening the sheet during its exit animates it from where it is
back to default.

**Reduced motion.** With reduced motion on (OS or app), every animation jumps
to its end state. Gestures still track the finger.

**Size changes.** The sheet re-measures on resize, `visualViewport` resize
(keyboard), and a `ResizeObserver` on its container. It then re-applies the
current snap position without animation. When the `height` prop changes while
the sheet is at default (the update sheet changing view), it animates to the
new default.

### Footer slot

Some sheets have a primary button pinned to the visible bottom: the
download-range "Queue" button and the update sheet's `Foot`. They put it in a
`<SheetFooter>` component. Inside a `MobileSheet`, `SheetFooter` portals its
children into the sheet's footer slot. Outside a sheet it renders inline, so
shared content still works in desktop dialogs.

- The footer slot is the last flex child of the sheet's column, with an opaque
  sheet background.
- On every frame it gets `translateY(−min(y, G))`. Here `y` is the sheet's
  offset from full, and `G` is the default snap's offset from full.
- So between full and default the footer stays pinned to the screen bottom.
  Below default (dismissing) it leaves with the sheet. At full it sits in its
  normal place.
- The body ends above the footer by layout, so no padding variable is needed.

### Back button

`navigation.ts` gains **layer entries**: history entries that carry the same
destination snapshot, plus a layer id.

- `pushLayer(onBack): release`. Pushes a layer entry and returns `release`.
  This is not a navigation: no `commit()`, and `seq` and `move` are unchanged.
- **Back or popstate landing below a layer.** Each layer above the landing
  index is dropped, top first, and its `onBack` is called. Destination state is
  unchanged, so there is no commit and no page transition. The `entries`
  mirror is truncated so `forward()` never re-enters a layer.
- **`release()` while the layer is the current entry.** Calls `history.back()`
  and marks the resulting popstate as self-inflicted, so it is swallowed. If a
  navigation already replaced or truncated the layer, `release()` is a no-op.
- **`navigate()` (push) while the current entry is a layer.** The layer entry is
  reused for the new destination (`replaceState`), not stacked on top. The
  layer record is dropped without calling `onBack`, because the sheet is
  already closing by itself. This covers "Open full settings" from the reader's
  settings sheet: `setSheet(null)` and `goSettings()` run in the same handler.
- **`navigate()` while a self-inflicted pop is still in flight.** The
  navigation waits until that popstate arrives, so the queued `history.back()`
  can't pop the new entry. This is rare: a sheet closed and a navigation
  started within one task.
- **Several layers stack.** Back pops the top one.

`MobileSheet` calls `pushLayer` when it opens and `release` when it closes or
unmounts. Its `onBack` calls the sheet's `onClose`, so it closes with the
normal programmatic exit.

### Font picker

- Its scroller gets `overscroll-behavior: contain`. It is a nested scroller by
  the rule above, so the sheet never claims touches inside it, group headings
  included.
- When it opens inside a sheet, it asks the sheet to reveal it. The sheet
  context exposes `reveal(el)`. If the popover's bottom falls below the
  visible part of the sheet, the sheet expands to full if it can. Then it
  scrolls its body, by computed `scrollTop` and never with `scrollIntoView`
  (see `tocReveal.ts` for why), so the popover is fully on screen.

## Call sites

| Sheet | `height` | `expandable` | Other changes |
|---|---|---|---|
| Reader panels, `MobileReader` | `82%` | yes | inner wrapper `overflow: auto` → `hidden` (one scroller) |
| PDF/DOCX panels, `FixedPageReader` | `82%` | yes | same |
| `ActionsMenu` (⋮ menus, volume menu) | `auto` | no | — |
| `ContextMenu` touch path (library long-press book menu) | `auto` | no | Rebuilt on `MobileSheet`: the owner chose this over keeping the floating cards. The rows keep their content. The status panel slide stays inside the sheet. The sheet follows its content-height change (bottom-anchored, so no transform change). The two-card layout, its own enter/exit and the separate Cancel card go; drag, the scrim and Back cover dismissal. The desktop popover path is untouched. |
| `DownloadRangeDialog` (mobile) | `min(80%, 500px)` | yes | button → `SheetFooter`; drop `--sheet-overhang` padding; untag the nested picker list (it becomes a nested scroller, `overscroll-behavior: contain`) |
| `UpdateSheet` notes view | `86%` | yes | `Foot` → `SheetFooter`; drop `--sheet-overhang` padding |
| `UpdateSheet` other views | `52%` | no | same |
| `WhatsNewAfterUpdate` (mobile) | `70%` | yes | its content now scrolls through the default body |
| `PanelShell` | — | — | padding drops the `--sheet-overhang` term, keeps the gesture-bar clearance |

## Architecture (decided)

- **Position is imperative.** `MobileSheet` keeps React state only for
  lifecycle: mounted, open or exiting, and the frozen children for the exit.
  Snap, drag offset and velocity live in refs. One `apply(y)` writes the sheet
  transform, the scrim opacity and the footer transform straight to the DOM.
  Re-renders of the sheet must not touch those properties: they are not in
  React's `style` objects.
- **Pure modules, unit-tested** (names are the builder's call):
  - physics: rubber band; spring sampling; snap projection and choice;
    velocity from samples (moved from `sheetSnap.ts`); the up/down motion
    distribution.
  - gesture decision: the ownership table above, as a pure function of the
    sheet state, the direction, and what is under the finger.
  - the navigation layer API, tested in the style of `navigation.test.ts`
    (happy-dom's `history` fires `popstate` synchronously).
- **WAAPI fallback.** Where `element.animate` is missing (happy-dom), the sheet
  applies the final state immediately. Tests don't depend on animation timing.
- **Touch input** uses Touch Events, so ownership can be decided with a
  cancelable first `touchmove`. Mouse input uses Pointer Events, on chrome
  only. If the first `touchmove` isn't cancelable (the browser already started
  scrolling), the gesture is native.

## Spike 1: hand-off from a native scroll (try it, keep it only if it works)

There's one case, at either snap: the user scrolls the list up natively,
reaches the top, and keeps pulling. Native Android hands that pull to the
sheet.

In a WebView, a native scroll can't be cancelled once it has started. Pointer
events get `pointercancel`. Touch events may arrive throttled during scroll in
Chromium. So the fallback is that the list stops at its top and the user pulls
again to move the sheet. Many good web sheets (vaul, Ionic) do exactly that.

The builder tries this on the A73:

1. Listen to `touchmove` (and `scroll`) during a native scroll.
2. If `touchmove`s keep arriving at frame rate after `scrollTop` hits 0, follow
   the finger with the sheet.
3. While the sheet is displaced, set the body to `overflow-y: hidden` so a
   reversal can't scroll it under the moving sheet. Restore it when the sheet
   returns to full or the touch ends.

Keep this only if it is smooth on the device. Otherwise keep the fallback and
note it in the PR.

## Constraints

- **Platforms.**
  - Android System WebView (Chromium) on the A73 and the Redmi Pad SE (portrait
    is the phone UI).
  - WebKitGTK on Linux desktop. `MobileSheet` shows there only in a narrow
    window, mouse-driven.
  - Use only features both engines have: Touch Events, Pointer Events, WAAPI,
    `overscroll-behavior`.
- **No new dependencies.**
- **RTL** needs nothing special for vertical gestures. The horizontal-first
  check uses absolute values.
- **Safe areas.** Keep today's top inset probe (`readSafeAreaInsetTop`). Keep the
  bottom clearance on `--safe-bottom`, because `env(safe-area-inset-bottom)`
  reads 0 on this WebView.
- **Stacking.** Keep `Z.panel` and the `.riwaq-clip-window` wrapper.
- **Tests and checks.** Local tests need
  `NODE_OPTIONS=--no-experimental-webstorage`. `pnpm check` (format, lint,
  build, test) must pass.
- **On-device testing uses the side-by-side debug build only.** Use a separate
  `applicationIdSuffix` and launcher label. Never install over, drive, or clear
  the personal `com.riwaq.reader`.

## Verification

- **Unit tests.**
  - The physics and decision modules.
  - The navigation layers: push, Back closes, release, navigate reusing a
    layer, navigate during a pending self-pop, stacked layers.
  - The `MobileSheet` component:
    - no React render of children per drag move;
    - a closed sheet adds no blocking listener anywhere;
    - Back calls `onClose`;
    - nested scroller touches are never claimed;
    - click suppression after a drag;
    - footer slot portalling.
- **On the A73, driven over CDP** (`Input.dispatchTouchEvent`), plus a
  screen recording:
  - reader Settings: swipe up from default expands, then scrolls in one
    gesture;
  - the font list scrolls to its end without moving anything else;
  - Contents at full: pull down at the top collapses, flick closes;
  - a drag starting on a Contents row moves the sheet and doesn't open the
    chapter;
  - a ⋮ menu rubber-bands and doesn't expand;
  - the download-range "Queue" button is visible at default;
  - Back closes the sheet and stays in the reader;
  - a frame-time trace while dragging the Settings sheet shows no React
    commits per move.
- **On the tablet, portrait.** A pass of the same flows. The owner installs the
  APK from Files, because MIUI blocks `adb install`.

## Left to the builder

- File and module names, and the exact constants: slop, flick threshold,
  projection factor, spring stiffness and damping, overdraw, and the `auto`
  height cap. Tune them on the device.
- The JS momentum curve for the expand-then-scroll tail.
- Whether `sheetSnap.ts` is deleted or reduced to a re-export during the
  change.
- How `reveal()` reaches `FontSelect` (context is the suggestion).
