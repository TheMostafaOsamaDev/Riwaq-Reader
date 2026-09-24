# Phone focus mode — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the phone reader's focus mode a deliberate mode: entered from a
header button, left by a double-tap or by tapping its own indicator, announced
on entry, and remembered between sessions.

**Architecture:** The local `showChrome` boolean is replaced by the persisted
`focusMode` tweak the desktop already uses, inverted (`chrome hidden === focusMode`).
The double-tap test is a pure function so its window and slop are testable with no
DOM. The two indicators are presentational components beside `FocusRail`.

**Tech Stack:** React 19, TypeScript, Vitest (+ happy-dom), Tauri 2 / Android.

**Spec:** `docs/superpowers/specs/2026-09-24-focus-mode-design.md`

## Global Constraints

- Touch targets ≥ 44×44, even where the ink is 36×36 (pad out, margin back).
- Anything positioned at a screen edge uses logical properties
  (`insetInlineEnd`), never `right`/`left` — the reader mirrors with the UI language.
- Anything at the top edge clears `env(safe-area-inset-top)`: the Android system
  bars are hidden in focus mode, a display cutout is not.
- Motion respects the `reduceMotion` tweak via `isReducedMotion()`; under it the
  pill appears and disappears with no transition.
- Every user-visible string goes in both `src/i18n/en.ts` and `src/i18n/ar.ts`.
  `ar.ts` is typed `Messages`, so a missing key is a compile error.
- `PAGE_CONTROL` stays exempt from page taps — chapter controls must never
  enter or exit the mode.

## Review Focus

Five conditions the spec implies that no obvious task would otherwise test:

1. **Two taps far apart in space** (opposite ends of the page) inside the time
   window — a reader tapping two different words, not double-tapping. Must NOT exit.
2. **Two taps slower than the window** — a reader tapping twice while thinking.
   Must NOT exit.
3. **Three rapid taps** — must exit once, not exit-then-re-enter.
4. **A double-tap on a chapter control** — must turn the chapter and leave the
   mode alone, in both directions.
5. **Entering focus mode with a sheet open** — the sheet must close, or it is
   left floating over a chrome-less page with no way back to its own controls.

Each is pinned to the task owning its code, below.

---

### Task 1: The double-tap discriminator

**Files:**
- Create: `src/reader/chrome/focusGesture.ts`
- Test: `src/reader/chrome/focusGesture.test.ts`

**Interfaces:**
- Produces: `DOUBLE_TAP_MS = 300`, `DOUBLE_TAP_SLOP = 24`,
  `isDoubleTap(prev: Tap | null, next: Tap): boolean`, `type Tap = { t: number; x: number; y: number }`.

- [ ] **Step 1: Write the failing tests** — covering Review Focus 1, 2 and 3.

```ts
import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MS, DOUBLE_TAP_SLOP, isDoubleTap } from "./focusGesture";

const at = (t: number, x = 100, y = 100) => ({ t, x, y });

describe("isDoubleTap", () => {
  it("is false without a previous tap", () => {
    expect(isDoubleTap(null, at(0))).toBe(false);
  });

  it("is true for a second tap soon after, in the same place", () => {
    expect(isDoubleTap(at(0), at(DOUBLE_TAP_MS - 1))).toBe(true);
  });

  it("is false once the window has passed", () => {
    // A reader tapping twice while thinking is not double-tapping.
    expect(isDoubleTap(at(0), at(DOUBLE_TAP_MS + 1))).toBe(false);
  });

  it("is false for two taps far apart, however fast", () => {
    // Two different words, not one gesture.
    expect(isDoubleTap(at(0, 40, 40), at(50, 40 + DOUBLE_TAP_SLOP + 1, 40))).toBe(false);
    expect(isDoubleTap(at(0, 40, 40), at(50, 40, 40 + DOUBLE_TAP_SLOP + 1))).toBe(false);
  });

  it("measures distance diagonally, not per axis", () => {
    const d = DOUBLE_TAP_SLOP;
    expect(isDoubleTap(at(0, 0, 0), at(50, d, d))).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail.** `pnpm vitest run src/reader/chrome/focusGesture.test.ts` — expect "Failed to resolve import".

- [ ] **Step 3: Implement.**

```ts
/** A tap, as the surface's click handler sees it. */
export interface Tap { t: number; x: number; y: number }

/** How long a second tap may arrive after the first and still be one gesture. */
export const DOUBLE_TAP_MS = 300;
/** How far it may land from the first, in CSS px. */
export const DOUBLE_TAP_SLOP = 24;

export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev) return false;
  if (next.t - prev.t > DOUBLE_TAP_MS) return false;
  return Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_SLOP;
}
```

- [ ] **Step 4: Run and watch it pass.**
- [ ] **Step 5: Commit** — `feat(reader): add the phone's double-tap discriminator`.

---

### Task 2: A lock glyph

**Files:**
- Modify: `src/components/Icon.tsx`
- Test: `src/components/icon.test.tsx` if one exists, else assert via Task 4's markup test.

**Interfaces:**
- Produces: `<Icon name="lock" />`.

- [ ] **Step 1:** Add a `lock` entry beside the others, matching the set's 1.8
  stroke, round caps and 24-unit box:

```tsx
lock: (
  <>
    <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </>
),
```

- [ ] **Step 2:** `pnpm tsc --noEmit` — the icon name union picks it up.
- [ ] **Step 3: Commit** — `feat(icons): add a lock`.

---

### Task 3: Copy

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Produces: `reader.focusExitHint`, `reader.exitFocusMode`. Removes `reader.mobileFocusHintBody`.

- [ ] **Step 1:** Add to `en.ts`:

```ts
"reader.focusExitHint": "Double-tap to exit",
"reader.exitFocusMode": "Exit focus mode",
```

and to `ar.ts`:

```ts
"reader.focusExitHint": "انقر مرتين للخروج",
"reader.exitFocusMode": "الخروج من وضع التركيز",
```

Delete `reader.mobileFocusHintBody` from both. `reader.focusMode` stays — it
names the mode in the pill and on the header button.

- [ ] **Step 2:** `pnpm tsc --noEmit`. A key in one catalogue and not the other
  is a compile error, which is the check.
- [ ] **Step 3: Commit** — `feat(i18n): copy for the phone's focus mode`.

---

### Task 4: The two indicators

**Files:**
- Create: `src/reader/chrome/FocusSigns.tsx`
- Test: `src/reader/chrome/focusSigns.test.tsx`

**Interfaces:**
- Consumes: `Icon` (Task 2), the keys from Task 3.
- Produces: `<FocusPill theme title hint reduced />` and
  `<FocusLock theme label onExit />`.

- [ ] **Step 1: Write the failing markup test.**

```tsx
// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES } from "../../styles/tokens";
import { FocusLock, FocusPill } from "./FocusSigns";

describe("the focus-mode signs", () => {
  it("names the mode and the way out", () => {
    const html = renderToStaticMarkup(
      <FocusPill theme={THEMES.sepia} title="وضع التركيز" hint="انقر مرتين للخروج" reduced={false} />,
    );
    expect(html).toContain("وضع التركيز");
    expect(html).toContain("انقر مرتين للخروج");
  });

  it("gives the lock an accessible name and makes it a real control", () => {
    // Gesture-only exit fails "a critical action needs a visible control";
    // the lock IS that control, so it has to be a button a reader can reach.
    const html = renderToStaticMarkup(
      <FocusLock theme={THEMES.sepia} label="Exit focus mode" onExit={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]+aria-label="Exit focus mode"/);
  });

  it("clears the safe area and mirrors, rather than pinning to one side", () => {
    const html = renderToStaticMarkup(
      <FocusLock theme={THEMES.sepia} label="x" onExit={() => {}} />,
    );
    expect(html).toContain("env(safe-area-inset-top");
    expect(html).toContain("inset-inline-end");
  });

  it("drops the transition under reduced motion", () => {
    const on = renderToStaticMarkup(
      <FocusPill theme={THEMES.sepia} title="t" hint="h" reduced={true} />,
    );
    expect(on).toContain("transition:none");
  });
});
```

- [ ] **Step 2: Run and watch it fail.**
- [ ] **Step 3: Implement `FocusSigns.tsx`** — `FocusPill` a centred, absolutely
  positioned pill on `theme.chrome` with a `0.5px solid theme.rule` hairline and
  `pointerEvents: none`; `FocusLock` a 44×44 button whose ink is a 15px
  `Icon name="lock"` at `inkAlpha(theme, 0.3)`, positioned
  `top: calc(env(safe-area-inset-top, 0px) + 6px)`, `insetInlineEnd: 6px`,
  `zIndex: Z.hint`.
- [ ] **Step 4: Run and watch it pass.**
- [ ] **Step 5: Commit** — `feat(reader): the focus-mode pill and lock`.

---

### Task 5: Wire it into the phone reader

**Files:**
- Modify: `src/components/MobileReader.tsx`
- Modify: `src/components/mobileReaderFocus.test.tsx`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing behavioural tests** — Review Focus 4 and 5.

```tsx
it("enters focus mode from the header button, and closes an open sheet", () => { /* … */ });
it("leaves on a double-tap of the page", () => { /* … */ });
it("stays on a single tap", () => { /* … */ });
it("does not leave when a chapter control is double-tapped", () => { /* … */ });
it("leaves when the lock is tapped", () => { /* … */ });
```

- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** In order:
  - `const focus = t.focusMode; const setFocus = (v: boolean) => setTweak("focusMode", v);`
    replacing `showChrome` (`chromeHidden === focus`).
  - The header's trailing 36×36 `aria-hidden` spacer becomes the focus button:
    same 36px ink, 44px hit area, `aria-label={tr("reader.focusMode")}`,
    `<Icon name="focus" size={16} />`, `onClick` enters focus mode and calls
    `setSheet(null)`.
  - The surface's `onClick` keeps its `PAGE_CONTROL` guard, then: if not in
    focus mode, do nothing (tap-to-toggle is retired); if in focus mode, run
    `isDoubleTap` against the stored previous tap — exit on true, re-show the
    pill on false.
  - `FocusPill` shows on every entry, on a 2200ms timer.
  - `FocusLock` renders whenever focus mode is on; `onExit` leaves.
  - Delete `useOnceHint`, `MOBILE_FOCUS_HINT_KEY`, `FocusHint`'s import.
- [ ] **Step 4: Run and watch them pass.** Then `pnpm check`.
- [ ] **Step 5: Commit** — `feat(reader): make the phone's focus mode a mode`.

---

### Task 6: Android back leaves the mode first

**Files:**
- Modify: `src/components/MobileReader.tsx`
- Modify: `src/components/mobileReaderFocus.test.tsx`

- [ ] **Step 1:** Failing test — with focus mode on, a `popstate` leaves the
  mode and does not leave the book.
- [ ] **Step 2:** Run, watch it fail.
- [ ] **Step 3:** Implement: while focus mode is on, push a history entry on
  entry and pop it on exit, so hardware back unwinds the mode first (see
  `[[tauri-v2-android-back-button]]` — back routes into webview history).
- [ ] **Step 4:** Run, watch it pass.
- [ ] **Step 5: Commit** — `feat(reader): hardware back leaves focus mode first`.

---

### Task 7: Verify on device

- [ ] Boot the `leaflet` AVD, `adb reverse tcp:1420 tcp:1420`, launch.
- [ ] Confirm double-tap-to-zoom does not fire on the page (the spec's one
  unanswerable-without-a-device question).
- [ ] Confirm the lock clears the cutout and sits opposite the home button in
  both UI languages.
- [ ] Screenshot entry, the pill, and the resting state.
