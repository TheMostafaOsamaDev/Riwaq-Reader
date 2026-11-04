# Native-feel bottom sheets: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `MobileSheet` so every phone/tablet bottom sheet in Riwaq drags,
expands, settles and closes like a native sheet.

**Architecture:**
- **Pure modules** decide everything that can be decided without the DOM:
  `physics.ts` (geometry, rubber band, spring/ease sampling, snap choice, how a
  drag is shared between the sheet and its list) and the `decideOwner` decision
  in `gesture.ts`.
- **`SheetController`**, an imperative engine, owns the position and writes
  `transform`/`opacity` straight to the DOM. It plays every animation through
  the Web Animations API, so nothing renders in React per frame.
- **`MobileSheet`** is reduced to lifecycle, measuring, a footer slot, Esc, and a
  Back-button "layer" that `navigation.ts` keeps in browser history.

**Tech Stack:** React 19, TypeScript, Vitest 4 + happy-dom, Biome. Runs in the
Tauri 2 Android System WebView (Chromium) and WebKitGTK.

**Spec:** `docs/superpowers/specs/2026-11-04-native-feel-sheets-design.md`. Read it
before any task: it holds the behaviour table, the call-site table and the
reasons.

## Global Constraints

- No new dependencies.
- Use only engine features both Android WebView (Chromium) and WebKitGTK have:
  Touch Events, Pointer Events, WAAPI (`element.animate`),
  `overscroll-behavior`. Fall back to applying the final state when
  `element.animate` is missing (happy-dom).
- Programmatic open: `EASE_POINTS.enter` over `MOTION.med` (240 ms). Programmatic
  close: `EASE_POINTS.exit` over `MOTION.fast` (180 ms). Both come from
  `src/styles/motion.ts`.
- Reduced motion (`isReducedMotion()` from `src/styles/motion.ts`): every
  animation jumps to its end. Gestures still track the finger.
- Keep `Z.panel` stacking and the `.riwaq-clip-window` wrapper. Bottom clearance
  stays on `var(--safe-bottom)`, never `env(safe-area-inset-bottom)`.
- Never register a non-passive `touchmove` or `wheel` listener on `document` or
  `window`. Sheet listeners live on the sheet box and only while it is mounted.
- Tests:
  - Run with `NODE_OPTIONS=--no-experimental-webstorage pnpm test` (Node 26 here).
  - `pnpm check` (format, lint, build, test) must pass before the PR.
- Commit messages: `type(scope): subject` plus an optional body. **No
  `Co-Authored-By` or "Generated with" lines**, in commits or the PR.
- On-device testing uses only a side-by-side debug build
  (`applicationIdSuffix ".sheets"`). Never install over, open, drive, clear or
  uninstall `com.riwaq.reader`.

## Review Focus

1. **The keyboard opens inside a sheet** (download-range search autofocus,
   Contents search). The viewport shrinks mid-open, and the sheet must keep its
   snap and stay on screen. → Task 4,
   `setGeometry keeps the current snap when the viewport shrinks`.
2. **A sheet reopens while its exit animation is still running** (tapping ⋮
   twice, switching menus). It must come back to default, and its Back layer
   must not be popped by the previous close's `history.back()`. → Task 3,
   `pushLayer during a pending self-pop waits for it`. Task 5,
   `reopening during exit lands at default and pushes one layer`.
3. **Back pressed twice quickly with a sheet open.** The first press closes the
   sheet. The second leaves the screen. Never both on one press. → Task 3,
   `two Back presses: first closes the layer, second navigates`.
4. **Reduced motion is on.** Closing must still unmount the sheet and fire
   `onExited`. Otherwise the long-press menu never runs its action. → Task 5,
   `with reduced motion, close unmounts and fires onExited`.
5. **A drag starts on a Contents row or a ⋮ menu row** and the browser still
   delivers a click on release. The click must not open the chapter or run the
   action. → Task 4, `a click right after a drag is swallowed once`.

---

## File map

| File | Responsibility |
|---|---|
| `src/components/sheet/physics.ts` (new) | Pure maths: geometry → snap positions, scrim opacity, footer offset, rubber band, velocity, snap choice, spring and ease sampling, drag distribution. |
| `src/components/sheet/gesture.ts` (new) | Who owns a touch: the pure `decideOwner`, plus small DOM helpers (`findBody`, `isScrollableY`, `classifyTarget`, `readTranslateY`). |
| `src/components/sheet/animate.ts` (new) | `playTracks`: plays sampled values on several elements in lockstep via WAAPI, or applies the end state immediately. |
| `src/components/sheet/SheetController.ts` (new) | The imperative engine: position, snaps, animations, touch/mouse/wheel input, momentum, click suppression, reveal. |
| `src/components/sheet/SheetContext.tsx` (new) | `SheetContext`, `useSheet()`, `SheetFooter`. |
| `src/components/MobileSheet.tsx` (rewrite) | Lifecycle, measuring, DOM skeleton, Back layer, Esc. Same export name and import path. |
| `src/components/sheetSnap.ts` (delete) | Replaced by `sheet/physics.ts`. |
| `src/store/navigation.ts` (modify) | `pushLayer` / release, plus layer-aware `onPopState`, `navigate`, `forward`. |
| Call sites | `PanelShell`, `MobileReader`, `FixedPageReader`, `ActionsMenu`, `DownloadRangeDialog`, `UpdateSheet`, `WhatsNewAfterUpdate`, `FontSelect`, `ContextMenu`. |

---

### Task 1: Sheet physics (pure)

**Files:**
- Create: `src/components/sheet/physics.ts`
- Test: `src/components/sheet/physics.test.ts`

**Interfaces:**
- Produces:
  - `type Snap = "full" | "default" | "dismissed"`
  - `interface SheetGeometry { viewportH: number; insetTop: number; boxH: number; defaultVisibleH: number; expandable: boolean }`
    - `y` is the box's `translateY`. 0 means the box sits at its layout
      position.
    - Expandable: `boxH = viewportH − insetTop`.
    - Not expandable: `boxH = defaultVisibleH`.
  - `interface MoveSample { y: number; t: number }`
  - Constants: `SLOP_PX = 6`, `FLICK_PX_PER_S = 700`, `PROJECTION_S = 0.15`,
    `RUBBER_COEFF = 0.55`, `OVERDRAW_PX = 120`, `AUTO_HEIGHT_CAP = 0.9`,
    `VELOCITY_WINDOW_MS = 120`, `MOMENTUM_DECAY_PER_MS = 0.998`,
    `SHEET_SPRING = { stiffness: 380, damping: 39 }` (mass 1, ≈ critically
    damped).
  - `snapY(snap: Snap, g: SheetGeometry): number`
    - `full` → 0 (expandable only; non-expandable returns the default value);
    - `default` → `boxH − defaultVisibleH`;
    - `dismissed` → `boxH`.
  - `topSnap(g): "full" | "default"`
  - `scrimOpacity(y, g): number`: `clamp((boxH − y) / defaultVisibleH, 0, 1)`.
  - `footerOffset(y, g): number`: `−min(max(y, 0), snapY("default", g))`.
  - `rubberBand(overshoot: number, dimension: number): number`: signed,
    `d·(1 − 1/(|x|·0.55/d + 1))`.
  - `displayY(rawY, g): number`: rubber-banded above `snapY(topSnap(g))` with
    `dimension = viewportH`, clamped at `snapY("dismissed")`.
  - `velocityFromSamples(samples: MoveSample[]): number`: px/s, +down. Same
    algorithm as today's `sheetSnap.ts`.
  - `pickSnap(y: number, velocity: number, g: SheetGeometry): Snap`
  - `springSamples(from: number, to: number, v0: number, frameMs = 1000/60): number[]`:
    the first value is `from`, the last is exactly `to`. Sampling stops once
    `|x − to| < 0.5` and `|v| < 10`. The sample count is capped at 120.
  - `easeSamples(from: number, to: number, durationMs: number, points: readonly [number, number, number, number], frameMs = 1000/60): number[]`:
    uses `cubicBezier` from `src/styles/motion.ts`; the first value is `from`,
    the last is `to`.
  - `interface DistributeInput { delta: number; sheetY: number; minY: number; scrollTop: number; maxScroll: number; bodyLinked: boolean }`
  - `distribute(i): { sheetY: number; scrollTop: number; mover: "sheet" | "body" | null }`

`pickSnap` algorithm (fixes the rule the spec states):

```ts
const pts = [g.expandable && "full", "default", "dismissed"].filter(Boolean) as Snap[];
const projected = y + velocity * PROJECTION_S;
let best = nearest(pts, projected);           // by |snapY − projected|
if (Math.abs(velocity) >= FLICK_PX_PER_S) {
  const dir = Math.sign(velocity);             // +1 down
  const next = pts                              // first snap strictly beyond y in dir
    .filter((s) => dir > 0 ? snapY(s, g) > y + 0.5 : snapY(s, g) < y - 0.5)
    .sort((a, b) => dir * (snapY(a, g) - snapY(b, g)))[0];
  if (next && dir * (snapY(best, g) - snapY(next, g)) < 0) best = next;
}
return best;
```

`distribute` algorithm (`delta` is the finger's dy, +down):

```ts
let { sheetY, scrollTop } = i; let rem = i.delta; let mover = null;
if (rem < 0) {                                   // finger up: sheet first, then body
  const take = Math.max(rem, Math.min(0, i.minY - sheetY)); // ≤ 0
  sheetY += take; rem -= take; if (take) mover = "sheet";
  if (rem < 0 && i.bodyLinked) {
    const s = Math.min(-rem, i.maxScroll - scrollTop); scrollTop += s; rem += s; if (s) mover = "body";
  }
  if (rem < 0) { sheetY += rem; mover = "sheet"; }  // overshoot, rubber-banded by displayY
} else if (rem > 0) {                            // finger down: undo overshoot, body to top, then sheet
  const back = Math.min(rem, Math.max(0, i.minY - sheetY));
  sheetY += back; rem -= back; if (back) mover = "sheet";
  if (rem > 0 && i.bodyLinked) {
    const s = Math.min(rem, scrollTop); scrollTop -= s; rem -= s; if (s) mover = "body";
  }
  if (rem > 0) { sheetY += rem; mover = "sheet"; }
}
return { sheetY, scrollTop, mover };
```

- [ ] **Step 1: Write the failing tests** in `physics.test.ts`

Use `G = { viewportH: 800, insetTop: 40, boxH: 760, defaultVisibleH: 600, expandable: true }`.
Snaps are full 0, default 160, dismissed 760. Use
`F = { ...G, boxH: 300, defaultVisibleH: 300, expandable: false }`.

```ts
it("places the three snaps", () => {
  expect([snapY("full", G), snapY("default", G), snapY("dismissed", G)]).toEqual([0, 160, 760]);
  expect([snapY("full", F), snapY("default", F), snapY("dismissed", F)]).toEqual([0, 0, 300]);
  expect(topSnap(G)).toBe("full"); expect(topSnap(F)).toBe("default");
});
it("scrim is opaque from default up and fades to 0 at dismissed", () => {
  expect(scrimOpacity(0, G)).toBe(1); expect(scrimOpacity(160, G)).toBe(1);
  expect(scrimOpacity(460, G)).toBeCloseTo(0.5); expect(scrimOpacity(760, G)).toBe(0);
});
it("footer stays on the screen bottom between full and default, then leaves with the sheet", () => {
  expect(footerOffset(0, G)).toBe(0); expect(footerOffset(80, G)).toBe(-80);
  expect(footerOffset(160, G)).toBe(-160); expect(footerOffset(400, G)).toBe(-160);
  expect(footerOffset(-30, G)).toBe(0);
});
it("rubber band resists and never exceeds the input", () => {
  expect(rubberBand(0, 800)).toBe(0);
  expect(Math.abs(rubberBand(-100, 800))).toBeLessThan(100);
  expect(rubberBand(-100, 800)).toBeLessThan(0);
  expect(Math.abs(rubberBand(-200, 800))).toBeGreaterThan(Math.abs(rubberBand(-100, 800)));
  expect(displayY(-100, G)).toBeGreaterThan(-100); expect(displayY(-100, G)).toBeLessThan(0);
  expect(displayY(900, G)).toBe(760); expect(displayY(50, G)).toBe(50);
});
it("picks the nearest snap on a slow release", () => {
  expect(pickSnap(60, 0, G)).toBe("full"); expect(pickSnap(100, 0, G)).toBe("default");
  expect(pickSnap(470, 0, G)).toBe("dismissed"); expect(pickSnap(400, 0, G)).toBe("default");
});
it("a flick goes at least one snap in its direction", () => {
  expect(pickSnap(150, -800, G)).toBe("full");
  expect(pickSnap(160, 800, G)).toBe("dismissed");
  expect(pickSnap(0, 800, G)).toBe("default");
  expect(pickSnap(0, 5000, G)).toBe("dismissed");
  expect(pickSnap(0, 800, F)).toBe("dismissed");
});
it("velocity is the slope over the last 120 ms", () => {
  expect(velocityFromSamples([{ y: 0, t: 0 }, { y: 50, t: 100 }])).toBeCloseTo(500);
  expect(velocityFromSamples([{ y: 0, t: 0 }])).toBe(0);
});
it("spring samples start at from, end exactly at to, and don't overshoot from rest", () => {
  const s = springSamples(160, 0, 0);
  expect(s[0]).toBe(160); expect(s.at(-1)).toBe(0);
  expect(Math.min(...s)).toBeGreaterThanOrEqual(-0.5);
  expect(s.length).toBeGreaterThan(10); expect(s.length).toBeLessThanOrEqual(120);
});
it("spring keeps the release velocity at its start", () => {
  const s = springSamples(100, 0, -2000);
  expect(100 - s[1]).toBeGreaterThan(100 - springSamples(100, 0, 0)[1]);
});
it("ease samples follow the curve between from and to", () => {
  const s = easeSamples(760, 160, 240, [0.32, 0.72, 0, 1]);
  expect(s[0]).toBe(760); expect(s.at(-1)).toBe(160); expect(s.length).toBe(16);
});
it("finger up moves the sheet first, then scrolls the body", () => {
  expect(distribute({ delta: -200, sheetY: 160, minY: 0, scrollTop: 0, maxScroll: 1000, bodyLinked: true }))
    .toEqual({ sheetY: 0, scrollTop: 40, mover: "body" });
});
it("finger down scrolls the body to its top first, then moves the sheet", () => {
  expect(distribute({ delta: 100, sheetY: 0, minY: 0, scrollTop: 30, maxScroll: 1000, bodyLinked: true }))
    .toEqual({ sheetY: 70, scrollTop: 0, mover: "sheet" });
});
it("an unlinked body never scrolls; the sheet overshoots instead", () => {
  expect(distribute({ delta: -50, sheetY: 0, minY: 0, scrollTop: 0, maxScroll: 1000, bodyLinked: false }))
    .toEqual({ sheetY: -50, scrollTop: 0, mover: "sheet" });
});
it("finger down first takes back an overshoot", () => {
  expect(distribute({ delta: 30, sheetY: -20, minY: 0, scrollTop: 1000, maxScroll: 1000, bodyLinked: true }))
    .toEqual({ sheetY: 0, scrollTop: 990, mover: "body" });
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/components/sheet/physics.test.ts`.
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/sheet/physics.ts`**

Implement it to the interfaces above, using the two algorithm blocks.
`springSamples` integrates `a = −k·(x − to) − c·v` with semi-implicit Euler, in
about 4 sub-steps per frame, and pushes one value per frame.

- [ ] **Step 4: Run the tests and make sure they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sheet/physics.ts src/components/sheet/physics.test.ts
git commit -m "feat(sheet): pure physics for snaps, springs and drag sharing"
```

---

### Task 2: Gesture ownership and DOM helpers

**Files:**
- Create: `src/components/sheet/gesture.ts`
- Test: `src/components/sheet/gesture.test.ts` (`// @vitest-environment happy-dom`)

**Interfaces:**
- Produces:
  - `type Region = "chrome" | "body" | "nested"`
  - `type TargetKind = "plain" | "slider" | "editing"`
  - `interface OwnerInput { region: Region; kind: TargetKind; dx: number; dy: number; cancelable: boolean; atTopSnap: boolean; expandable: boolean; bodyScrollTop: number; bodyScrollable: boolean }`
  - `decideOwner(i: OwnerInput): "sheet" | "pass"`. Its rules, in order:
    1. `!cancelable` → pass.
    2. `editing` → pass.
    3. `|dx| > |dy|` → pass.
    4. A slider needs `|dy| > 2·|dx|`, otherwise pass.
    5. `nested` → pass.
    6. `chrome` → sheet.
    7. On the body, with `dy < 0` (up):
       - `expandable && !atTopSnap` → sheet;
       - `!bodyScrollable` → sheet;
       - otherwise pass.
    8. On the body, with `dy > 0` (down): `bodyScrollTop <= 0` → sheet,
       otherwise pass.
  - `findBody(content: HTMLElement): HTMLElement`: the first
    `[data-sheet-scrollable]` inside `content`, else `content`.
  - `isScrollableY(el: Element): boolean`: computed `overflow-y` is `auto` or
    `scroll`, and `scrollHeight − clientHeight > 1`.
  - `classifyTarget(target: Element, body: HTMLElement): { region: Region; kind: TargetKind }`
    - Region:
      - `chrome` when `!body.contains(target)`;
      - `nested` when any element from `target` up to `body` (exclusive)
        `isScrollableY`;
      - else `body`.
    - Kind:
      - `editing` when `closest('[data-no-drag], [contenteditable=""], [contenteditable="true"]')`
        matches, or when the closest `input, textarea` is
        `document.activeElement`;
      - `slider` for `closest('input[type="range"], [role="slider"]')`;
      - else `plain`.
  - `readTranslateY(el: HTMLElement): number`: parses
    `getComputedStyle(el).transform`, which is `none`, `matrix(…)` or
    `matrix3d(…)`; `none` → 0.

- [ ] **Step 1: Write the failing tests**

```ts
const base: OwnerInput = { region: "body", kind: "plain", dx: 0, dy: -10, cancelable: true,
  atTopSnap: false, expandable: true, bodyScrollTop: 0, bodyScrollable: true };
it("swipe up on the body below full belongs to the sheet", () =>
  expect(decideOwner(base)).toBe("sheet"));
it("swipe up on the body at full is a native scroll", () =>
  expect(decideOwner({ ...base, atTopSnap: true })).toBe("pass"));
it("pull down with the body at its top belongs to the sheet at either snap", () => {
  expect(decideOwner({ ...base, dy: 10 })).toBe("sheet");
  expect(decideOwner({ ...base, dy: 10, atTopSnap: true })).toBe("sheet");
});
it("pull down with the body scrolled is a native scroll at either snap", () => {
  expect(decideOwner({ ...base, dy: 10, bodyScrollTop: 40 })).toBe("pass");
  expect(decideOwner({ ...base, dy: 10, bodyScrollTop: 40, atTopSnap: true })).toBe("pass");
});
it("chrome always drags", () =>
  expect(decideOwner({ ...base, region: "chrome", atTopSnap: true })).toBe("sheet"));
it("nested scrollers, horizontal moves, editing and uncancelable moves pass", () => {
  expect(decideOwner({ ...base, region: "nested" })).toBe("pass");
  expect(decideOwner({ ...base, dx: 12, dy: -10 })).toBe("pass");
  expect(decideOwner({ ...base, kind: "editing" })).toBe("pass");
  expect(decideOwner({ ...base, cancelable: false })).toBe("pass");
});
it("a slider is claimed only by a clearly vertical move", () => {
  expect(decideOwner({ ...base, kind: "slider", dx: 6, dy: -10 })).toBe("pass");
  expect(decideOwner({ ...base, kind: "slider", dx: 3, dy: -20 })).toBe("sheet");
});
it("a non-expandable sheet claims up only when its body can't scroll", () => {
  const f = { ...base, expandable: false, atTopSnap: true };
  expect(decideOwner(f)).toBe("pass");
  expect(decideOwner({ ...f, bodyScrollable: false })).toBe("sheet");
});
```

DOM tests:
- Build a content element with a header `div`, a `[data-sheet-scrollable]` body,
  and an inner `div` with `overflow-y: auto` that holds a `button` and a
  heading `div`.
- Stub `scrollHeight` / `clientHeight` with `Object.defineProperty`.
- Assert:
  - `findBody` returns the tagged body, or the content when none is tagged;
  - the header is classified `chrome`;
  - a body button is `body`/`plain`;
  - the inner heading is `nested`;
  - a focused `input` is `editing` and an unfocused one is `plain`;
  - `input[type=range]` is `slider`;
  - `readTranslateY` returns 120 for inline `transform: translateY(120px)`.
    happy-dom may report it verbatim, so accept `translateY(...)` as well as
    the matrix forms.

- [ ] **Step 2: Run** `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/components/sheet/gesture.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `src/components/sheet/gesture.ts`** to the interfaces above.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/sheet/gesture.ts src/components/sheet/gesture.test.ts
git commit -m "feat(sheet): decide who owns a touch on a sheet"
```

---

### Task 3: Back-button layers in navigation history

**Files:**
- Modify: `src/store/navigation.ts`
- Test: `src/store/navigation.test.ts` (append a `describe("layers")`)

**Interfaces:**
- Produces: `pushLayer(onBack: () => void): () => void`. It returns `release`,
  which is idempotent.
- Behaviour, as the spec's "Back button" section states it:
  - A layer entry is `pushState({ navIndex, snapshot, layer: id })` with the
    current snapshot. No `commit()`.
  - **A user pop that lands below layers** removes those layers, top first,
    and calls each `onBack`. When the snapshot is unchanged it does not commit,
    and it truncates `entries` to `index + 1`.
  - **`release()` on the current top layer:** `pendingSelfPops++` and
    `history.back()`. The resulting popstate is swallowed: no `onBack`, no
    commit, `entries` truncated. Then deferred actions are flushed.
  - **`release()` on a layer that isn't on top** marks it dead.
    - Any popstate that lands on a dead layer entry, ours or the user's,
      chains another self-pop.
    - `pushLayer` while the current entry is a dead layer reuses it with
      `replaceState`.
  - **`navigate()` while the current entry is a live or dead layer:** reuse
    that entry with `replaceState` for the new snapshot. Skip the A→B→A
    collapse. Drop the layer record without calling `onBack`, then commit with
    `move: "push"`.
  - **`navigate()` or `pushLayer()` while `pendingSelfPops > 0`:** queue it and
    run it when the last self-pop lands. A queued layer's `release` removes it
    from the queue.

- [ ] **Step 1: Write the failing tests** (in the existing file's style; happy-dom fires `popstate` synchronously)

```ts
describe("layers", () => {
  const seq = () => nav.getState().seq;
  it("pushLayer adds a history entry without navigating", () => {
    nav.goReader("b1"); const s = seq();
    nav.pushLayer(() => {});
    expect(navIndex()).toBe(2); expect(seq()).toBe(s); expect(view()).toEqual({ screen: "reader", bookId: "b1" });
  });
  it("Back closes the layer and stays on the screen", () => {
    nav.goReader("b1"); const onBack = vi.fn(); nav.pushLayer(onBack); const s = seq();
    window.history.back();
    expect(onBack).toHaveBeenCalledOnce(); expect(navIndex()).toBe(1); expect(seq()).toBe(s);
    expect(view()).toEqual({ screen: "reader", bookId: "b1" });
  });
  it("two Back presses: first closes the layer, second navigates", () => {
    nav.goReader("b1"); const onBack = vi.fn(); nav.pushLayer(onBack);
    window.history.back(); window.history.back();
    expect(onBack).toHaveBeenCalledOnce(); expect(view()).toEqual({ kind: "shelf" });
  });
  it("release pops its own entry silently and is idempotent", () => {
    nav.goReader("b1"); const onBack = vi.fn(); const release = nav.pushLayer(onBack); const s = seq();
    release(); release();
    expect(onBack).not.toHaveBeenCalled(); expect(navIndex()).toBe(1); expect(seq()).toBe(s);
  });
  it("release after Back is a no-op", () => {
    nav.goReader("b1"); const release = nav.pushLayer(() => {});
    window.history.back(); release();
    expect(navIndex()).toBe(1);
  });
  it("navigating with a layer open reuses its entry", () => {
    nav.goReader("b1"); const onBack = vi.fn(); const release = nav.pushLayer(onBack);
    nav.goSettings(); release();
    expect(onBack).not.toHaveBeenCalled(); expect(navIndex()).toBe(2);
    expect(nav.getState().snapshot.base).toEqual({ screen: "settings" });
    nav.back(); expect(view()).toEqual({ screen: "reader", bookId: "b1" });
  });
  it("navigating to the entry behind a layer still navigates", () => {
    nav.goReader("b1"); nav.pushLayer(() => {});
    nav.goLibrary({ kind: "shelf" });
    expect(view()).toEqual({ kind: "shelf" });
  });
  it("forward never re-enters a closed layer", () => {
    nav.goReader("b1"); nav.pushLayer(() => {}); window.history.back();
    nav.forward(); expect(navIndex()).toBe(1);
  });
  it("Back with two layers closes only the top one", () => {
    nav.goReader("b1"); const a = vi.fn(); const b = vi.fn();
    nav.pushLayer(a); nav.pushLayer(b); window.history.back();
    expect(b).toHaveBeenCalledOnce(); expect(a).not.toHaveBeenCalled(); expect(navIndex()).toBe(2);
  });
  it("releasing a lower layer, then the upper, lands on the screen in one step", () => {
    nav.goReader("b1"); const relA = nav.pushLayer(() => {}); const relB = nav.pushLayer(() => {});
    relA(); relB();
    expect(navIndex()).toBe(1);
  });
  describe("with an asynchronous history.back", () => {
    // Stub history.back so popstate is dispatched by the test, as a real WebView does it a task later.
    it("navigate during a pending self-pop waits for it", () => { /* release(); goStorePage(); expect(view()) still reader;
      dispatch the popstate; expect(view()).toEqual({ kind: "store" }); expect(navIndex()).toBe(2) */ });
    it("pushLayer during a pending self-pop waits for it", () => { /* release(); const onBack = vi.fn(); nav.pushLayer(onBack);
      dispatch the popstate; expect(navIndex()).toBe(2); window.history.back() (now sync again) → onBack called */ });
  });
});
```

The asynchronous variant:
- `vi.spyOn(window.history, "back")` records calls instead of traversing.
- The test then moves the real state back with
  `window.history.go(-1)` / `replaceState`, plus a manual
  `window.dispatchEvent(new PopStateEvent("popstate", { state }))` carrying
  the entry it lands on.
- Write those two bodies in full. The comments above fix their assertions.

- [ ] **Step 2: Run** `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/store/navigation.test.ts`. Expected: the new layer tests FAIL, `pushLayer` is not a function. The old tests pass.
- [ ] **Step 3: Implement it in `navigation.ts`.**
  - Extend `StampedState` with `layer?: number`.
  - Add module state: `layers: Map<number /*navIndex*/, { id: number; onBack: (() => void) | null }>`,
    `pendingSelfPops = 0` and `deferred: Array<() => void>`.
  - Make `navigate`, `onPopState` and `forward` layer-aware, as described
    above.
  - Keep the file's comment style: explain why a self-pop is swallowed and why
    navigate reuses a layer entry ("Open full settings" closes the sheet and
    navigates in one handler).
- [ ] **Step 4: Run the same command.** Expected: all PASS, old and new.
- [ ] **Step 5: Commit**

```bash
git add src/store/navigation.ts src/store/navigation.test.ts
git commit -m "feat(nav): back-button layers that close a sheet without navigating"
```

---

### Task 4: `playTracks` and `SheetController`

**Files:**
- Create: `src/components/sheet/animate.ts`, `src/components/sheet/SheetController.ts`
- Test: `src/components/sheet/SheetController.test.ts` (`// @vitest-environment happy-dom`)

**Interfaces:**
- Consumes: everything in Task 1 and Task 2.
- Produces:
  - `interface Track { el: HTMLElement; prop: "transform" | "opacity"; values: string[] }`
  - `interface Playback { cancel(): void; finished: Promise<boolean> }`
  - `playTracks(tracks: Track[], durationMs: number): Playback`
    - Uses WAAPI with `easing: "linear"` and `fill: "forwards"`. On finish it
      writes each final value inline, then cancels the animation.
    - With reduced motion, a missing `animate`, or `durationMs <= 0`, it writes
      the final values at once, and `finished` resolves `true`.
  - `interface SheetElements { box: HTMLElement; scrim: HTMLElement; content: HTMLElement; footer: HTMLElement }`
  - `interface SheetCallbacks { onDismiss(): void; onExitFinished(): void }`
  - `interface TouchPoint { id: number; x: number; y: number; t: number; target: Element; mouse?: boolean }`
  - `class SheetController`:
    - Lifecycle: `constructor(els, cb)`, `attach()`, `destroy()`,
      `setGeometry(g: SheetGeometry, animate = false)`.
    - State: `get snap(): Snap`, `get y(): number`.
    - Motion: `open()`, `close(velocity?: number)`, `expand()`,
      `settleTo(snap: "full" | "default", velocity: number)`.
    - `reveal(el: HTMLElement)`.
    - Input: `touchStart(p: TouchPoint)`,
      `touchMove(p: Omit<TouchPoint, "target"> & { cancelable: boolean }): boolean`
      (true means the caller must `preventDefault`), `touchEnd(p: { id: number; t: number })`,
      `wheel(deltaY: number): boolean`, `suppressesClick(t: number): boolean`.

Behaviour the tests pin:
- **`apply(y)`, private**, is the only writer of position styles. It writes:
  - `box.style.transform = translateY(${displayY}px)`;
  - `scrim.style.opacity = scrimOpacity`;
  - `footer.style.transform = translateY(${footerOffset}px)`.
- **`setGeometry`** re-applies the current snap's y, with no animation unless
  `animate` is set. `animate` uses the open ease and is for a `height` prop
  change. Mid-gesture, it only stores the geometry.
- **Multi-touch.** While a gesture is active, a `touchStart` with a different
  `id` is ignored, as are its moves and its end.
- **A finger that stopped before lifting has no velocity.** If
  `t − lastSample.t > VELOCITY_WINDOW_MS` at `touchEnd`, the velocity is 0.
- **`open()`** goes from `dismissed` to `default` with `easeSamples(…, MOTION.med, EASE_POINTS.enter)`.
  - `close(v)` with `v` undefined or 0 eases to `dismissed` with
    `MOTION.fast` and `EASE_POINTS.exit`. Any other `v` uses a spring.
  - Every animation builds three tracks from the same samples.
  - When `close` finishes (`finished === true`), it calls `onExitFinished`.
- **Gesture states:** `idle → pending → drag | pass`.
  - `pending` becomes a decision at `max(|dx|, |dy|) >= SLOP_PX`, using
    `decideOwner`.
  - `atTopSnap` is `snap === topSnap(g)`, judged with no animation running.
  - `bodyLinked` is `region === "body" && isScrollableY(body)`.
  - A drag uses `distribute()` and writes `body.scrollTop` when it is linked.
- **Release:**
  - If the sheet is on its start snap and `mover === "body"`, the body keeps
    its momentum: the velocity decays by `MOMENTUM_DECAY_PER_MS^dt` on rAF,
    until it is under 20 px/s or hits an end.
  - Otherwise `pickSnap` chooses a snap. `"dismissed"` means
    `close(v)` + `onDismiss()`; anything else means `settleTo`.
  - A release that was a drag sets `suppressClickUntil = t + 400`.
- **`touchStart` during a running animation or momentum** cancels it. It reads
  `readTranslateY(box)` back into y, then `apply(y)`.
- **Mouse** starts (`p.mouse`) are only accepted on chrome. They skip the
  ownership table: a mouse drag past the slop is always a sheet drag.
- **`wheel`:** with `deltaY > 0`, an expandable sheet and `snap !== "full"`, it
  calls `expand()` and returns true. Otherwise it returns false.
- **`reveal(el)`:**
  - If the element's bottom, projected to the target snap, is below
    `viewportH − footer.offsetHeight − 12`, the sheet calls `expand()` first
    when it can.
  - It then sets `body.scrollTop` (by `scrollTo({ top, behavior })`,
    `"instant"` under reduced motion) so the element's bottom clears that line.
  - It never calls `scrollIntoView`.
- **`attach()`** registers on `box`:
  - `touchstart` (passive), `touchmove` (`{ passive: false }`), `touchend`,
    `touchcancel`;
  - `pointerdown` for mouse only, with `pointermove`/`pointerup` on `window`
    during a mouse drag (passive);
  - `wheel` (`{ passive: false }`);
  - `click` (capture), which swallows one click inside the suppression window.
  `destroy()` removes all of them and cancels any running animation and
  momentum.

- [ ] **Step 1: Write the failing tests.**
  - Call `setReduceMotionOverride("on")` in `beforeEach`, so animations apply at
    once. Reset it to `"auto"` in `afterEach`.
  - Build the four elements and the geometry `G` from Task 1. Give the body
    `style.overflowY = "auto"` and stub its `scrollHeight` (1760) and
    `clientHeight` (760), so `isScrollableY` holds.
  - Drive input through the controller's methods, not DOM events. The
    click-suppression test and the listener test do use events.

```ts
it("opens to default", () => { c.open(); expect(c.snap).toBe("default"); expect(c.y).toBe(160); });
it("a chrome drag follows the finger with no render and settles to the nearest snap", () => {
  c.open(); c.touchStart(pt(0, 400, 0, grabber));
  expect(c.touchMove({ ...pt(0, 300, 50), cancelable: true })).toBe(true);
  expect(els.box.style.transform).toBe("translateY(60px)");
  c.touchEnd({ id: 1, t: 400 }); expect(c.snap).toBe("full");
});
it("swipe up on the list at default expands, then scrolls the list in the same gesture", () => {
  c.open(); c.touchStart(pt(0, 500, 0, bodyRow));
  c.touchMove({ ...pt(0, 300, 40), cancelable: true });
  expect(c.y).toBe(0); expect(body.scrollTop).toBe(40);
});
it("at full, swipe up on the list is left to the browser", () => {
  c.open(); c.settleTo("full", 0); c.touchStart(pt(0, 500, 0, bodyRow));
  expect(c.touchMove({ ...pt(0, 480, 20), cancelable: true })).toBe(false);
});
it("at default, pull down on a scrolled list is left to the browser", () => {
  c.open(); body.scrollTop = 300; c.touchStart(pt(0, 300, 0, bodyRow));
  expect(c.touchMove({ ...pt(0, 340, 20), cancelable: true })).toBe(false);
});
it("a fast flick down from default dismisses", () => {
  c.open(); c.touchStart(pt(0, 300, 0, grabber));
  c.touchMove({ ...pt(0, 330, 16), cancelable: true }); c.touchMove({ ...pt(0, 360, 32), cancelable: true });
  c.touchEnd({ id: 1, t: 40 });
  expect(cb.onDismiss).toHaveBeenCalledOnce(); expect(cb.onExitFinished).toHaveBeenCalledOnce();
});
it("pulling up at full rubber-bands and springs back", () => {
  c.open(); c.settleTo("full", 0); c.touchStart(pt(0, 300, 0, grabber));
  c.touchMove({ ...pt(0, 200, 30), cancelable: true });
  expect(c.y).toBeLessThan(0); expect(c.y).toBeGreaterThan(-100);
  c.touchEnd({ id: 1, t: 600 }); expect(c.y).toBe(0);
});
it("a horizontal start is never claimed for the rest of the touch", () => {
  c.open(); c.touchStart(pt(100, 300, 0, grabber));
  expect(c.touchMove({ ...pt(120, 302, 16), cancelable: true })).toBe(false);
  expect(c.touchMove({ ...pt(120, 360, 32), cancelable: true })).toBe(false);
});
it("a click right after a drag is swallowed once", () => {
  c.attach(); c.open(); /* drag via controller methods, then dispatch two clicks on bodyRow */
  // first click: listener not called; second click 500 ms later: called
});
it("wheel down at default expands first", () => {
  c.open(); expect(c.wheel(40)).toBe(true); expect(c.snap).toBe("full"); expect(c.wheel(40)).toBe(false);
});
it("setGeometry keeps the current snap when the viewport shrinks", () => {
  c.open(); c.setGeometry({ ...G, viewportH: 500, boxH: 460, defaultVisibleH: 375 });
  expect(c.snap).toBe("default"); expect(c.y).toBe(85);
});
it("attach registers no listener on document or window, and destroy removes them", () => { /* spy on
  document/window addEventListener: zero touchmove/wheel; spy on box remove: every added type removed */ });
it("reveal expands, then scrolls the list just enough", () => { /* stub el.getBoundingClientRect bottom 900
  at default; expect snap full and body.scrollTo called with top > 0 */ });
```

Here `pt(x, y, t, target?)` returns
`{ id: 1, x, y, t, target: target ?? bodyRow }`.

- [ ] **Step 2: Run** `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/components/sheet/SheetController.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `animate.ts` and `SheetController.ts`.** The class
  holds all mutable state in fields. Nothing in it imports React.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/sheet/animate.ts src/components/sheet/SheetController.ts src/components/sheet/SheetController.test.ts
git commit -m "feat(sheet): imperative sheet engine on compositor animations"
```

---

### Task 5: `MobileSheet` rewrite, `SheetContext`, `SheetFooter`

**Files:**
- Create: `src/components/sheet/SheetContext.tsx`
- Rewrite: `src/components/MobileSheet.tsx`
- Delete: `src/components/sheetSnap.ts`. Update the two comments that name it,
  `src/reader/fixed/FixedPageViewer.tsx:124` and
  `src/reader/scroll/touchPan.ts:142`, to name `sheet/physics.ts`.
- Test: rewrite `src/components/MobileSheet.test.tsx`

**Interfaces:**
- Consumes: `SheetController`, `SheetGeometry`, `OVERDRAW_PX`,
  `AUTO_HEIGHT_CAP` (Tasks 1 and 4), and `pushLayer` (Task 3).
- Produces:
  - `MobileSheet(props: { theme: Theme; open: boolean; onClose: () => void; children: ReactNode; height?: string /* default "82%"; "auto" = fit content */; expandable?: boolean /* default true; forced false when height === "auto" */; label?: string; onExited?: () => void })`
  - `SheetContext: React.Context<SheetApi | null>`, where
    `interface SheetApi { reveal(el: HTMLElement): void; footerSlot: HTMLElement | null }`
  - `useSheet(): SheetApi | null`
  - `SheetFooter({ children }: { children: ReactNode })`: inside a sheet it
    portals `children` into `footerSlot`; outside one it renders them inline.

Skeleton (attributes are part of the interface, because tests and Task 9 query
them):

```
div.riwaq-clip-window (position absolute, inset 0, zIndex Z.panel, overflow hidden)
  div[data-sheet-scrim]   onClick → onClose
  div[role=dialog][aria-modal][aria-label][data-sheet-box]
      style: position absolute; left 0; right 0; bottom −OVERDRAW_PX;
             height (boxH + OVERDRAW_PX) px, or auto with maxHeight (cap + OVERDRAW_PX) px for "auto";
             paddingBottom OVERDRAW_PX; boxSizing border-box; flex column; bg theme.bg; radius 18 top;
             overflow hidden; willChange transform
    div[data-sheet-grabber]  (36×4 bar, touchAction none)
    div[data-sheet-content]  flex "1 1 0" (fixed) | "0 1 auto" (auto); minHeight 0; overflowY auto;
                             overscrollBehaviorY contain; display flex; flexDirection column
    div[data-sheet-footer]   flexShrink 0; background theme.bg   ← SheetFooter portals here
```

- **No `transform` or `opacity` in React `style` props** on the box, the scrim
  or the footer: the controller owns them.
- **Lifecycle:**
  - `open` true → mount, then in `useLayoutEffect`: measure, `setGeometry`,
    `apply(dismissed)`, `open()`.
  - `open` false → `close()`. `onExitFinished` → unmount, then `onExited?.()`.
  - Reopening during the exit → `settleTo("default", 0)`.
  - The children are frozen during the exit, as today.
  - A `height` prop change while open re-measures and calls
    `setGeometry(g, true)`. This is the update sheet switching between 52% and
    86%.
- **Measuring.** `viewportH = window.innerHeight` and `insetTop` comes from
  today's `readSafeAreaInsetTop`.
  - `defaultVisibleH` comes from today's `parseHeightPx`. For `"auto"` it is
    `box.offsetHeight − OVERDRAW_PX`.
  - It re-measures on `resize`, on `visualViewport` resize, and from a
    `ResizeObserver` on the box (`"auto"`) and on the clip window.
- **Back.** `useEffect` on `open`: `const release = pushLayer(() => onCloseRef.current())`,
  and its cleanup calls `release()`.
- **Esc.** A `keydown` listener on `document` while open calls `onClose()`.
- **Dismissed by a gesture.** `onDismiss` calls `onClose()`. The exit is
  already running, so the later `open=false` must not restart it.

- [ ] **Step 1: Write the failing tests.**
  - Use happy-dom with `setReduceMotionOverride("on")`.
  - Render with `createRoot`, the way the current file does.
  - Dispatch touch input as `new Event("touchstart" | "touchmove" | "touchend", { bubbles: true, cancelable: true })`,
    with `touches`/`changedTouches` set through `Object.defineProperty`.

```ts
it("a closed sheet renders nothing and registers no listener on document", …);   // keep today's two cases, adapted:
it("an open sheet registers its blocking touchmove on the sheet box, not on document", …);
it("dragging the grabber moves the box without re-rendering the children", () => {
  // child component increments a counter on render; after touchstart + 3 touchmoves:
  // box.style.transform changed; counter unchanged
});
it("Back closes the sheet", () => { /* render open; window.history.back(); expect(onClose).toHaveBeenCalledOnce() */ });
it("Esc closes the sheet", …);
it("with reduced motion, close unmounts and fires onExited", () => {
  /* render open, rerender open=false → dialog gone, onExited called once */
});
it("reopening during exit lands at default and pushes one layer", () => {
  /* reduced motion off: stub HTMLElement.prototype.animate to return a never-finishing
     animation; open → close → open; expect a single extra history entry and the box
     transform at the default y */
});
it("SheetFooter portals into the footer slot, and renders inline outside a sheet", …);
it("a touch inside a nested scroller is never claimed", () => {
  /* inner overflow-y:auto div with stubbed scroll range; touchstart+touchmove up 30px →
     the touchmove event is not defaultPrevented */
});
it("height=auto sizes the box to its content and cannot expand", () => {
  /* stub box offsetHeight; drag up on the grabber → box transform y < 0 while dragging,
     back to 0 after touchend */
});
```

- [ ] **Step 2: Run** `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/components/MobileSheet.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement `SheetContext.tsx` and rewrite `MobileSheet.tsx`.**
  - Keep the long "why" comments that still apply: the clip window, and why
    the box is full-height.
  - Remove the ones about `--sheet-overhang` and the old drag handoff.
- [ ] **Step 4: Run the full suite:** `NODE_OPTIONS=--no-experimental-webstorage pnpm test`.
  - The new tests pass.
  - Any other failure must come from a sheet consumer whose test reads the old
    structure. Note it for Task 6; don't fix call sites here.
  - `pnpm build` must type-check, apart from call sites still passing nothing
    new. The props are backward compatible, so it should be clean.
- [ ] **Step 5: Commit**

```bash
git add -A src/components/MobileSheet.tsx src/components/MobileSheet.test.tsx src/components/sheet/SheetContext.tsx src/components/sheetSnap.ts src/reader/fixed/FixedPageViewer.tsx src/reader/scroll/touchPan.ts
git commit -m "feat(sheet): MobileSheet on the new engine, with Back, Esc and a footer slot"
```

---

### Task 6: Call sites

**Files:**
- Modify: `src/panels/PanelShell.tsx`, `src/components/MobileReader.tsx`,
  `src/reader/fixed/FixedPageReader.tsx`, `src/components/ActionsMenu.tsx`,
  `src/components/DownloadRangeDialog.tsx`,
  `src/components/update/UpdateSheet.tsx`,
  `src/components/update/WhatsNewAfterUpdate.tsx`
- Test: extend `src/components/ActionsMenu.test.tsx` and
  `src/components/update/UpdateSheet.test.tsx`; add
  `src/components/DownloadRangeDialog.sheet.test.tsx` only if no existing test
  renders the mobile layout.

**Interfaces:**
- Consumes: `MobileSheet` props `height`/`expandable` and `SheetFooter` (Task 5).

Changes, exactly as in the spec's call-site table:

| File | Change |
|---|---|
| `PanelShell.tsx` | `paddingBottom: "max(40px, calc(var(--safe-bottom) + 24px))"`; delete the `--sheet-overhang` comment paragraph |
| `MobileReader.tsx` (≈1541), `FixedPageReader.tsx` (≈1097) | panel wrapper `overflow: "auto"` → `"hidden"` |
| `ActionsMenu.tsx` | `height="auto"`; update the sizing comment |
| `DownloadRangeDialog.tsx` | mobile wrapper drops `paddingBottom: var(--sheet-overhang)`; the footer `div` is wrapped in `<SheetFooter>`; the nested picker list (≈761) loses `data-sheet-scrollable` and gains `overscrollBehaviorY: "contain"`; rewrite the comment that explains the overhang |
| `UpdateSheet.tsx` | wrapper drops `paddingBottom: var(--sheet-overhang)`; `Foot` renders its `div` inside `<SheetFooter>`; `expandable={view === "notes"}` |
| `WhatsNewAfterUpdate.tsx` | no prop change; its content now scrolls through `[data-sheet-content]` |

- [ ] **Step 1: Write the failing tests.**
  - `ActionsMenu.test.tsx`: `it("the phone sheet fits its content and does not expand")`.
    The `[data-sheet-box]` has no fixed height style (`style.height` is `""`
    or `auto`), and a grabber drag up returns to y 0.
  - `UpdateSheet.test.tsx`: `it("the action buttons render in the sheet footer")`.
    The buttons are descendants of `[data-sheet-footer]`.
  - DownloadRange, mobile: `it("the queue button sits in the sheet footer and the picker list is not the sheet body")`.
    The button is under `[data-sheet-footer]`, and `findBody(content)` is the
    outer body, not the picker.
- [ ] **Step 2: Run** those files. Expected: FAIL.
- [ ] **Step 3: Make the changes in the table.** Then `grep -rn "sheet-overhang" src` must print nothing.
- [ ] **Step 4: Run** `NODE_OPTIONS=--no-experimental-webstorage pnpm test` and `pnpm build`. Expected: all PASS, clean build.
- [ ] **Step 5: Commit**

```bash
git add -A src/panels/PanelShell.tsx src/components/MobileReader.tsx src/reader/fixed/FixedPageReader.tsx src/components/ActionsMenu.tsx src/components/ActionsMenu.test.tsx src/components/DownloadRangeDialog.tsx src/components/update/UpdateSheet.tsx src/components/update/UpdateSheet.test.tsx src/components/update/WhatsNewAfterUpdate.tsx
git commit -m "refactor(sheets): move every sheet onto footer slots and fit-to-content sizing"
```

---

### Task 7: Font picker

**Files:**
- Modify: `src/components/FontSelect.tsx`
- Test: `src/components/FontSelect.test.tsx` (create if absent; `// @vitest-environment happy-dom`)

**Interfaces:**
- Consumes: `useSheet()` (Task 5).

- [ ] **Step 1: Write the failing tests.**
  - `it("its list stops at its ends instead of scrolling what's behind it")`:
    after opening, the `ScrollArea` inner scroller
    (`[data-no-overlay-scrollbar]`) has `style.overscrollBehaviorY === "contain"`.
  - `it("asks the enclosing sheet to reveal it when it opens")`: render
    inside a `SheetContext.Provider` whose `reveal` is `vi.fn()`. Click the
    trigger, flush one rAF, and `reveal` is called once with the popover
    element.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `overscrollBehaviorY: "contain"` to the `scrollStyle`.
  - Hold a ref on the popover's outer element. When `open` turns true, call
    `sheet?.reveal(el)` in a `requestAnimationFrame` after layout.
- [ ] **Step 4: Run** the file and then the full suite. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/FontSelect.tsx src/components/FontSelect.test.tsx
git commit -m "fix(settings): the font list never scrolls the sheet behind it"
```

---

### Task 8: Library long-press menu on `MobileSheet`

**Files:**
- Modify: `src/components/ContextMenu.tsx` (touch path only)
- Test: `src/components/ContextMenu.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `MobileSheet` with `height="auto"` and `onExited` (Task 5).

Behaviour:
- **Wrapper.** The touch path renders a fixed layer,
  `position: fixed; inset: 0; zIndex: Z.menu`, with `pointerEvents` `"auto"`
  while open and `"none"` while closing (UpdateSheet's pattern), and a
  `MobileSheet` inside it.
  - `open` is local state: `true` on mount.
  - `requestClose` and `runWithExit(action)` set it to `false` and stash the
    action.
  - `onExited` runs the stashed action, then `onClose()`.
- **Contents.** The sheet holds the existing header, a divider, and the
  height-animated main/status slider, unchanged.
- **Removed:** both `SheetCard` wrappers, the Cancel card, the blur scrim, the
  touch `entered`/`leaving` transforms and `tapHaptic` on Cancel.
- **Outside-press and Esc.** The `document` `pointerdown` outside-press
  listener runs only on the desktop path. The touch path's Esc handler also
  goes, because MobileSheet's Esc covers it.
- **Desktop popover path:** untouched.

- [ ] **Step 1: Write the failing tests.** Force the touch path by stubbing
  `matchMedia` to match `(pointer: coarse)`, and set reduced motion on.
  - `it("opens as the shared bottom sheet")`: `[data-sheet-box]` exists and
    there is no "Cancel" button.
  - `it("Edit runs after the sheet has closed")`: click "Edit book info", then
    `onEdit` and `onClose` were each called once, in that order.
  - `it("Back closes it without running an action")`: `window.history.back()`
    calls `onClose` once and `onEdit`/`onDelete` zero times.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement the touch-path rewrite.**
- [ ] **Step 4: Run** the file and then the full suite plus `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/ContextMenu.tsx src/components/ContextMenu.test.tsx
git commit -m "feat(library): the long-press book menu is the shared bottom sheet"
```

---

### Task 9: On-device verification, tuning, and Spike 1

**Files:**
- Modify: constants in `src/components/sheet/physics.ts`, only if tuning calls
  for it.
- Modify: `src/components/sheet/SheetController.ts`, only if Spike 1 is kept.

The A73 and tablet procedure follows the memory note "Riwaq phone testing".
Build from this worktree with
`CARGO_TARGET_DIR=/mnt/sda3/MyWork/Riwaq-Reader/src-tauri/target`.

- [ ] **Step 1: Build the side-by-side APK.**
  1. Run `pnpm android:build:debug`.
  2. Re-add `applicationIdSuffix = ".sheets"` in the debug build type of
     `src-tauri/gen/android/app/build.gradle.kts`. Set `app_name` to
     "Riwaq Sheets" (`values`) and "رواق · أوراق" (`values-ar`).
  3. If Gradle fails with "Unresolved reference: TauriActivity", generate
     `TauriActivity.kt` as the memory note describes.
  4. Run `./gradlew assembleUniversalDebug -PtargetList=aarch64 -PabiList=arm64-v8a -ParchList=arm64 -x rustBuildArm64Debug`.
  5. `aapt2 dump packagename` must print `com.riwaq.reader.sheets`.
- [ ] **Step 2: Install on the A73 (`R5CT70AJBLA`) and seed books** from a tar of
  the desktop library, as the memory note describes. Never touch
  `com.riwaq.reader`.
- [ ] **Step 3: Drive each flow over CDP** (`Input.dispatchTouchEvent`), while
  recording with `screenrecord`. Each must pass:
  1. Reader Settings at 82%: one swipe up expands to full and continues
     scrolling the list.
  2. The font list scrolls to its end, and nothing behind it moves. The
     heading rows behave the same as the font rows.
  3. Contents at 82%, scrolled to the current chapter: a downward flick
     scrolls back with momentum and does not close the sheet.
  4. Contents at full: a pull down at the top drops it to 82%. A fast flick
     closes it.
  5. A drag that starts on a Contents row moves the sheet and does not open
     the chapter.
  6. A ⋮ menu and the long-press book menu rubber-band, can't expand, and
     close on a downward flick.
  7. The download-range "Queue" button is visible at the default height and
     stays pinned while you drag between default and full.
  8. Back with a sheet open closes the sheet and stays in the reader. A second
     Back leaves the reader.
  9. Catching the sheet mid-animation stops it under the finger, with no jump.
- [ ] **Step 4: Performance check.** Record a CDP `Tracing` (or `Performance`)
  profile while dragging the Settings sheet. There must be no React commit
  (no `MobileSheet`/`SettingsPanel` render) per touchmove, and no long tasks
  over 16 ms caused by the sheet.
- [ ] **Step 5: Spike 1.** Log `touchmove` timestamps, and the moment
  `scrollTop` reaches 0, during a native downward scroll at full.
  - **If moves keep arriving at frame rate after the top:** implement the
    hand-off in `SheetController` as the spec's Spike 1 section describes,
    with a body `overflow-y: hidden` while the sheet is displaced. Add a
    controller test, `it("a native scroll that reaches the top hands the pull to the sheet")`,
    and re-run flows 3 and 4.
  - **Otherwise:** leave the fallback and record the measurement for the PR.
- [ ] **Step 6: Tune.** Adjust `SHEET_SPRING`, `FLICK_PX_PER_S`, `PROJECTION_S`
  and `MOMENTUM_DECAY_PER_MS` only if a flow feels off, and re-run its
  recording. Note any change for the PR.
- [ ] **Step 7: Tablet portrait pass** (Redmi Pad SE `342f5057`).
  - Push the APK to `/sdcard/Download` and ask the owner to install it from
    Files. Confirm it with `pm list packages`.
  - Repeat flows 1, 2, 4, 6 and 8.
- [ ] **Step 8: Revert the build edits.** Revert the `build.gradle.kts` and
  `strings.xml` edits, then commit any tuning or spike change:

```bash
git checkout -- src-tauri/gen/android
git add src/components/sheet
git commit -m "tune(sheet): spring and flick constants from on-device testing"
```

---

### Task 10: Full check, docs, PR

**Files:**
- Modify: `docs/progress.md` (the line that mentions the sheet, if its claim
  changed)

- [ ] **Step 1: Run the full check.**
  `NODE_OPTIONS=--no-experimental-webstorage pnpm check`. Expected: format,
  lint, build and tests all pass.
- [ ] **Step 2: Clear stale references.**
  `grep -rn "sheet-overhang\|sheetSnap\|data-sheet-scrollable" src docs --include='*.ts' --include='*.tsx' --include='*.md' | grep -v superpowers`
  may list only the live `data-sheet-scrollable` tags (`PanelShell`,
  `DownloadRangeDialog` outer body, `UpdateSheet`) and the `gesture.ts`
  selector.
- [ ] **Step 3: Update the spec status line** to "implemented; see PR", then
  commit the docs.
- [ ] **Step 4: Finish the branch.** Use superpowers:finishing-a-development-branch.
  - Push `feat/native-sheets` and open a PR against `main`.
  - Include the on-device results and the Spike 1 outcome.
  - No attribution lines.
