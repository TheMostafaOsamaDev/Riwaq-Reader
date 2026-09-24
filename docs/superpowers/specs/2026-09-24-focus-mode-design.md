# Focus mode on the phone — design

**Date:** 2026-09-24
**Status:** draft, awaiting review

## Summary

Rebuild the phone reader's focus mode as a deliberate mode rather than a
side effect of tapping the page. Entry becomes an explicit control in the
reader's tab bar; exit becomes a double-tap; and the mode announces itself
twice over — a pill naming the mode and its exit as you enter, and a small
lock that stays, so a reader returning after a minute away can still tell
where they are.

## Goals

- Focus mode is something the reader chooses, and can tell they are in.
- Leaving it is deliberate. A stray tap while reading cannot drop you out.
- The way out is discoverable without having memorised a gesture.
- The mode survives closing and re-opening a book, as the desktop's does.

## Non-goals

- The desktop and fixed-page readers. Their focus mode is pointer-proximity
  driven (`useFocusChrome`), a different interaction with different
  constraints; this document does not touch it.
- A focus-mode settings surface. There is nothing here to configure.
- Changing what focus mode *hides*. The bars and the Android system bars
  still go, exactly as now.

## Background — what focus mode is today

Four facts shape the design, all confirmed in the current code:

**It is not a mode, it is a toggle.** `MobileReader` holds a local
`showChrome` boolean. The reading surface's `onClick` flips it. "Focus
mode" is just the false branch — there is no concept in the code that a
reader is *in* something.

**It does not persist.** `showChrome` is component state, so re-opening a
book always starts with the chrome up. The `focusMode` tweak exists and is
persisted, but only `DesktopReader` and `FixedPageReader` use it, through
`useFocusChrome`. The phone ignores it.

**There is no control for it.** `ReaderTabBar` carries five tabs —
contents, highlights, show-progress, progress, settings. None of them is
focus mode. The tap is the only way in or out.

**The only thing that says you are in it is a progress rail.** `FocusRail`
mounts when the chrome is away. It reads as a progress bar, because that
is what it is; nothing about it says "you are in a mode you can leave".
There is a first-run hint (`riwaq:m-focus-hint-seen`), shown once per
install and never again.

So a reader who enters focus mode on their second day has no signal at
all, and a reader who forgets the gesture has no way to look it up.

## Design

### Entry — a sixth tab

A `focus` tab joins `ReaderTabBar`, after settings. Tapping it enters
focus mode and closes any open sheet, the way the desktop's toggle already
closes its panels.

Six 44×44 targets across a 390px phone leaves ~17px between them, clear of
the 8px minimum. The `focus` glyph already exists in `Icon.tsx`.

This is a tool row rather than primary navigation, so the "five items"
bottom-nav convention does not bind — but six is the ceiling. A seventh
would need an overflow menu instead.

### Exit — double-tap

A double-tap anywhere on the reading surface leaves focus mode.

Detected from the surface's existing click handler: a second tap within
**300ms** and **24px** of the first counts. Written as a pure function so
the window and slop are testable without a browser.

Three interactions it must not break, all already in `MobileReader`:

- **The chapter controls.** `PAGE_CONTROL` (the previous-chapter capsule,
  the end-of-chapter card and its marginal links) is exempt from the page
  tap. It stays exempt: double-tapping the next-chapter button turns two
  chapters, it does not exit the mode.
- **Long-press selection.** The custom selection gesture is a ≥400ms hold.
  A double-tap is two short taps, so the two cannot be confused — but the
  discriminator must key off tap *count and timing*, never off hold.
- **Double-tap to zoom.** Suppressed already: `BookBody` sets
  `touch-action: pan-y`, which removes the browser's double-tap zoom on
  that element. Worth an on-device check rather than trust.

### Telling the reader — the pill, then the lock

Two signals, because they answer different questions at different moments.

**The pill, on entry.** A centred pill reading *"Focus mode · double-tap to
exit"*, fading after ~2.2s. Shown **every time** focus mode is entered, not
once per install — the point is teaching the exit gesture at the moment it
becomes relevant, and a reader who enters focus mode twice a year needs it
both times. Replaces the current first-run-only hint, so
`riwaq:m-focus-hint-seen` and its `useOnceHint` usage go.

Under reduced motion it appears and disappears without transition.

**The lock, while you stay.** A small lock glyph in the top trailing
corner, at low alpha, positioned with `insetInlineEnd` so it lands
correctly in both directions and inside `env(safe-area-inset-top)` — the
Android system bars are hidden in this mode, but a display cutout is not.

`Icon.tsx` has no lock; one is added.

**The lock is also the exit.** This is the point of pairing them. A
gesture-only exit fails the "always provide a visible control for a
critical action" rule — a reader who never saw the pill, or who cannot
perform a double-tap reliably, would be stuck in a mode with no visible way
out. Making the indicator tappable turns the marker into the accessible
escape route at no extra cost in furniture. It carries an `aria-label`
naming the action, so it is reachable to a screen reader as a real
control.

Rejected: an inset hairline round the page. Built and viewed, it is
invisible on the OLED theme at the alpha a hairline wants.

### Android back

Hardware back exits focus mode before it leaves the book. A mode you
entered is a state to unwind, and back is the platform's unwind.

### Persistence

The phone adopts the persisted `focusMode` tweak that the desktop already
uses, replacing the local `showChrome` state. Re-opening a book returns
you to focus mode if that is where you were.

This follows from entry becoming deliberate: a mode you chose should not
be silently discarded, whereas a mode you fell into by tapping should not
be remembered. The two changes have to land together.

## Decisions taken here, flagged for review

Three calls were not settled in conversation. They are recorded as
decisions so the spec is unambiguous; each is cheap to reverse.

1. **A single tap in focus mode re-shows the pill.** With entry on a
   button and exit on a double-tap, a single tap has no job left. Doing
   nothing at all reads as a frozen app; re-showing the pill turns a
   confused tap into the answer to the question that prompted it.
2. **Tap-to-hide-chrome is retired.** Today a single tap hides the chrome
   without that being focus mode — a second, overlapping route to a bare
   screen. One concept, one way in. This is the most visible behaviour
   change in the document for anyone used to the current reader.
3. **Focus mode persists** (above).

## Work breakdown

1. `focusGesture.ts` — the double-tap discriminator, pure and unit-tested.
2. `Icon.tsx` — add `lock`.
3. `ReaderTabBar` — the sixth tab and its `onFocus` prop; both readers pass it.
4. `MobileReader` — `showChrome` → the `focusMode` tweak; double-tap exit;
   retire tap-to-toggle; back handling.
5. `FocusPill` / `FocusLock` — the two indicators, in `reader/chrome/`,
   beside `FocusRail`.
6. i18n — the pill's copy and the lock's accessible name, in both catalogues.
7. Delete `useOnceHint`'s mobile usage and `MOBILE_FOCUS_HINT_KEY`.

Items 1–2 are independent of the rest and can land first.

## Testing

- **Unit, no DOM:** the double-tap discriminator across the window and slop
  boundaries, including the "two taps far apart" and "two taps slow" cases.
- **Markup:** the pill names the exit gesture; the lock is a real button
  with an accessible name; neither renders when focus mode is off.
- **Behavioural (happy-dom):** entering from the tab closes an open sheet;
  a double-tap on the page exits; a double-tap on a chapter control does
  **not** exit and does turn the chapter; a single tap does not exit.
- **On device:** that double-tap-to-zoom really is suppressed, and that the
  lock clears a display cutout. Neither is answerable without a device.

## Risks

- **Double-tap is slower than a single tap.** Exiting now costs ~300ms of
  waiting for the second tap. Acceptable for an exit; it would not be for
  a page turn.
- **The retired toggle is muscle memory.** Readers who tap to hide the
  chrome will find the tap does nothing and, on the first try, may not
  find the new tab. The pill mitigates the reverse direction only.
- **Six tabs is the ceiling.** The next reader control needs an overflow
  menu, not a seventh tab.
