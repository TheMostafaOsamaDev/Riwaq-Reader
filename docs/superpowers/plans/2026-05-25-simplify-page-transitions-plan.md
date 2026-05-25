# Simplify Page-Transition Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse three page-level animation keyframe pairs (`leaflet-view`, `leaflet-dialog`, `leaflet-fullscreen`) to pure cross-fade, and realign one timer in `AnimatedSwap` to match the new 240 ms enter duration.

**Architecture:** Two source files change. `global.css` keyframe pair bodies become opacity-only; the matching `.leaflet-*-enter` class declarations switch from the spring easing (`cubic-bezier(0.32, 0.72, 0, 1)`) to plain `ease-out`, and one duration (`view-enter`) shortens 280→240 ms while `view-exit` shortens 200→180 ms. `AnimatedSwap.tsx` swaps `MOTION.slow` → `MOTION.med` in the timer that drops the enter class. Class names, component APIs, and call sites stay identical.

**Tech Stack:** CSS keyframes (no library), React 19, TypeScript 5.8, Vite 7. **No test framework is configured** (no vitest, no jest, no playwright config). Verification is by TypeScript build + visual walkthrough in the dev server (Playwright MCP tools may be used to drive verification programmatically if available, but are not required).

---

## File Structure

- **Modify:** `src/styles/global.css` — rewrite three keyframe pairs and their `.leaflet-*-enter|exit` class declarations. Other keyframes in the file are untouched.
- **Modify:** `src/components/AnimatedSwap.tsx` — one-line change to the `setTimeout` delay in the effect that promotes `enter → idle` and drops `exit` slots.

No new files. No component API changes. No call-site changes.

---

## Task 1: Pure cross-fade in `global.css`

**Files:**
- Modify: `src/styles/global.css:247-273` (view), `:314-327` (dialog), `:329-342` (fullscreen)

### - [ ] Step 1.1: Replace `leaflet-view` keyframes + classes

Use the Edit tool. Replace the exact block (lines 247–273 in the current file):

**old_string:**
```css
@keyframes leaflet-view-enter {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes leaflet-view-exit {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(-8px) scale(1.04);
  }
}
.leaflet-view-enter {
  animation: leaflet-view-enter 280ms cubic-bezier(0.32, 0.72, 0, 1) both;
}
.leaflet-view-exit {
  animation: leaflet-view-exit 200ms cubic-bezier(0.4, 0, 1, 1) both;
  pointer-events: none;
}
```

**new_string:**
```css
@keyframes leaflet-view-enter {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes leaflet-view-exit {
  from { opacity: 1; }
  to   { opacity: 0; }
}
.leaflet-view-enter {
  animation: leaflet-view-enter 240ms ease-out both;
}
.leaflet-view-exit {
  animation: leaflet-view-exit 180ms cubic-bezier(0.4, 0, 1, 1) both;
  pointer-events: none;
}
```

What changed:
- Enter keyframe body: drop `transform: translateY(16px) scale(0.96)` → opacity only
- Exit keyframe body: drop `transform: translateY(-8px) scale(1.04)` → opacity only
- `.leaflet-view-enter`: duration 280ms → 240ms, easing spring → `ease-out`
- `.leaflet-view-exit`: duration 200ms → 180ms, easing unchanged

### - [ ] Step 1.2: Replace `leaflet-dialog` keyframes + classes

Use the Edit tool. Replace the exact block:

**old_string:**
```css
@keyframes leaflet-dialog-enter {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes leaflet-dialog-exit {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.96); }
}
.leaflet-dialog-enter {
  animation: leaflet-dialog-enter 240ms cubic-bezier(0.32, 0.72, 0, 1) both;
}
.leaflet-dialog-exit {
  animation: leaflet-dialog-exit 180ms cubic-bezier(0.4, 0, 1, 1) both;
}
```

**new_string:**
```css
@keyframes leaflet-dialog-enter {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes leaflet-dialog-exit {
  from { opacity: 1; }
  to   { opacity: 0; }
}
.leaflet-dialog-enter {
  animation: leaflet-dialog-enter 240ms ease-out both;
}
.leaflet-dialog-exit {
  animation: leaflet-dialog-exit 180ms cubic-bezier(0.4, 0, 1, 1) both;
}
```

What changed:
- Enter keyframe body: drop `transform: scale(0.94 → 1)` → opacity only
- Exit keyframe body: drop `transform: scale(1 → 0.96)` → opacity only
- `.leaflet-dialog-enter`: easing spring → `ease-out`. Duration unchanged.
- `.leaflet-dialog-exit`: unchanged.

### - [ ] Step 1.3: Replace `leaflet-fullscreen` keyframes + classes

Use the Edit tool. Replace the exact block:

**old_string:**
```css
@keyframes leaflet-fullscreen-enter {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes leaflet-fullscreen-exit {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.98); }
}
.leaflet-fullscreen-enter {
  animation: leaflet-fullscreen-enter 240ms cubic-bezier(0.32, 0.72, 0, 1) both;
}
.leaflet-fullscreen-exit {
  animation: leaflet-fullscreen-exit 180ms cubic-bezier(0.4, 0, 1, 1) both;
}
```

**new_string:**
```css
@keyframes leaflet-fullscreen-enter {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes leaflet-fullscreen-exit {
  from { opacity: 1; }
  to   { opacity: 0; }
}
.leaflet-fullscreen-enter {
  animation: leaflet-fullscreen-enter 240ms ease-out both;
}
.leaflet-fullscreen-exit {
  animation: leaflet-fullscreen-exit 180ms cubic-bezier(0.4, 0, 1, 1) both;
}
```

What changed:
- Enter keyframe body: drop `transform: scale(0.96 → 1)` → opacity only
- Exit keyframe body: drop `transform: scale(1 → 0.98)` → opacity only
- `.leaflet-fullscreen-enter`: easing spring → `ease-out`. Duration unchanged.
- `.leaflet-fullscreen-exit`: unchanged.

### - [ ] Step 1.4: Quick sanity check on the file

Run: `grep -n "transform: scale\|transform: translateY" src/styles/global.css`

Expected output (only the chapter-enter rule should still have a transform):
```
182:    transform: translateY(8px);
```

If you see any `transform: scale` or other `transform: translateY` matches in
lines 240–360 (the page-transition keyframe block), something didn't replace.
Re-check the failing Edit.

### - [ ] Step 1.5: Stage the CSS change

Run: `git add src/styles/global.css`

(Do not commit yet — Task 2 makes the matching `AnimatedSwap` timer change and the two land in one commit.)

---

## Task 2: Realign `AnimatedSwap` timer

**Files:**
- Modify: `src/components/AnimatedSwap.tsx:81`

### - [ ] Step 2.1: Update the timer delay

Use the Edit tool. The change is a single token:

**old_string:**
```ts
      reduced ? 0 : MOTION.slow,
```

**new_string:**
```ts
      reduced ? 0 : MOTION.med,
```

Why: the previous `leaflet-view-enter` keyframe ran 280 ms (`MOTION.slow`). With Task 1 it now runs 240 ms (`MOTION.med`). Keep timer and keyframe aligned so the `.leaflet-view-enter` class is removed exactly when the animation finishes.

There is one other comment in this file mentioning the old timing:

```
67	  // Once enough time has passed for both keyframes to finish, drop the
68	  // exiting slots and promote the entering one to idle. Use MOTION.slow
69	  // because the view-enter keyframe in global.css runs 280ms — wait at
70	  // least that long before stripping the class, or the animation will
71	  // be cut short.
```

### - [ ] Step 2.2: Update the explanatory comment

Use the Edit tool to update the rationale to match the new timing:

**old_string:**
```ts
  // Once enough time has passed for both keyframes to finish, drop the
  // exiting slots and promote the entering one to idle. Use MOTION.slow
  // because the view-enter keyframe in global.css runs 280ms — wait at
  // least that long before stripping the class, or the animation will
  // be cut short.
```

**new_string:**
```ts
  // Once enough time has passed for both keyframes to finish, drop the
  // exiting slots and promote the entering one to idle. Use MOTION.med
  // because the view-enter keyframe in global.css runs 240ms — wait at
  // least that long before stripping the class, or the animation will
  // be cut short.
```

### - [ ] Step 2.3: TypeScript check

Run: `npx tsc -p tsconfig.json --noEmit`

Expected: no output, exit code 0. (`MOTION.med` is an existing key on the `MOTION` const in `src/styles/motion.ts:13`, so this is a no-op for the type system, but the build still confirms nothing else broke.)

If `tsc` fails for unrelated pre-existing errors, capture the output and reconcile with the user before continuing — do not silently work around type errors.

### - [ ] Step 2.4: Stage the AnimatedSwap change

Run: `git add src/components/AnimatedSwap.tsx`

### - [ ] Step 2.5: Commit

Run:

```bash
git commit -m "$(cat <<'EOF'
feat(animations): simplify page transitions to pure cross-fade

Collapse leaflet-view, leaflet-dialog, and leaflet-fullscreen keyframe
pairs to opacity-only. Switch enter easing from spring to ease-out.
Realign AnimatedSwap's enter-class timer to MOTION.med (240ms) to
match the new shorter view-enter duration. Mobile sheet and desktop
side-panel keep their slide motion.

Spec: docs/superpowers/specs/2026-05-25-simplify-page-transitions-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Run: `git status`

Expected: working tree clean, branch ahead by one new commit.

---

## Task 3: Visual verification pass

**Files:** none — verification only.

**Why this matters:** the project has no automated rendering tests. Animation regressions are easy to miss in code review. Walk through the checklist below before considering the work done.

### - [ ] Step 3.1: Start the dev server

Check whether a dev server is already running on the default Vite port (5173). If not:

Run (background): `pnpm dev`

Wait for stdout to print `Local: http://localhost:5173/` (Vite's ready signal). Note the actual port — Vite picks the next free one if 5173 is taken.

### - [ ] Step 3.2: Walk through the seven verification scenarios

Open the dev URL in a browser (or drive via Playwright MCP `browser_navigate` if you prefer programmatic verification). For each scenario, watch for the **expected** behavior. Any other behavior is a regression — stop and reconcile.

1. **Page transition — Library → Reader.** Open any book from the Library.
   *Expected:* Library content fades out; Reader content fades in. No vertical movement, no scaling.

2. **Page transition — Reader → Library.** Hit Back from the Reader.
   *Expected:* clean cross-fade in the reverse direction.

3. **Library shelf swap.** Switch between All / Reading / Finished / Wishlist / Store tabs.
   *Expected:* the shelf body cross-fades on each tab change. Header and bottom nav stay still.

4. **Modal dialog.** From the Library, delete a book (this opens `ConfirmDialog`). Cancel it.
   *Expected:* scrim fades in/out, card fades in/out. **No** scale-pop on the card.

5. **Desktop full-screen.** At desktop width (≥720 px), open SettingsSheet from the bottom nav. Close it.
   *Expected:* the full-screen overlay fades in/out without scaling.

6. **Mobile bottom-sheet (unchanged).** At phone width (DevTools mobile mode, ≤720 px), open SettingsSheet from the bottom nav.
   *Expected:* the sheet still **slides up** from the bottom. This is the "unchanged" surface — if it fades instead of sliding, something in the wrong keyframe was edited.

7. **Desktop side-panel (unchanged).** In the Reader at desktop width, open the TOC or settings panel from the header.
   *Expected:* the panel still **slides in** from its anchor edge. Unchanged.

### - [ ] Step 3.3: Reduce-motion check

Toggle the OS preference (Linux: GNOME → Accessibility → Reduce animations; or run Chrome with `chrome://flags#prefers-reduced-motion` or DevTools → Rendering → emulate `prefers-reduced-motion: reduce`).

Repeat scenarios 1, 4, 5, and 6.

*Expected:* every transition is instant. No stuck animation classes. No frames where content sits at the start of a transform.

### - [ ] Step 3.4: Stop the dev server

If you started it in Step 3.1, kill the background process.

### - [ ] Step 3.5: Report verification result

Report each of the seven scenarios + reduce-motion as PASS or FAIL. If any FAIL, do not declare the work complete — return to the matching task and re-check the edit.

---

## Post-implementation

After Task 3 all-PASS:

- No further commits needed; Task 2 already produced the one expected commit.
- The branch is ready for review or merge.
- The original spec at `docs/superpowers/specs/2026-05-25-simplify-page-transitions-design.md` and the recent commit message together explain the change to a reviewer.
