# Navigation history phase 1 — Implementation Plan

**Goal:** Remove the sidebar back/forward arrows completely, route every
back/forward input (keyboard, mouse side buttons) through one module, and close
the history gaps (Store pages, A→B→A loops, a stuck Back).

**Architecture:** `src/store/navigation.ts` stays the single History-API-backed
nav store; it gains an in-memory mirror of pushed entries (for loop collapse),
a root guard in `back()`, and a `StorePage` dimension on the Store view. A new
`src/store/navInput.ts` owns keyboard and mouse back/forward with capture-phase
listeners and cancels the webview's native side-button navigation. The Store
stops keeping its own page state and renders the page named by history.

**Tech Stack:** React 19, TypeScript, Vite, Vitest 4 + happy-dom, Biome, Tauri 2
(wry 0.55 webview).

**Spec:** `docs/superpowers/specs/2026-10-01-nav-history-phase1-design.md`

## Global Constraints

- Work only in `/Users/themostafaosama/Desktop/my-work/Riwaq-nav-history`
  (branch `feat/nav-history`). Never run checkout/switch/reset/stash in
  `~/Desktop/my-work/Riwaq-reader`; it is a live checkout.
- Commit messages are written as the user: no `Co-Authored-By` trailer, no
  "Generated with" footer, no mention of Claude or AI.
- Never `git add -A`. Commit with the pathspec form so nothing else staged is
  swept in: `git commit -m "…" -- path/one path/two`.
- Component and DOM tests start with `// @vitest-environment happy-dom` (the
  default environment is `node`).
- Run `pnpm format` before each commit (Biome); `pnpm check` (format check,
  lint, `tsc && vite build`, `vitest run`) must pass at the end.
- Alt+← is always back and Alt+→ always forward, in RTL as well as LTR.
- No new on-screen navigation control.
- Every new test is tampered once: break the code it covers, see it fail,
  restore. A test that cannot fail proves nothing.

## Review Focus

1. **Option+←/→ while typing** (Cmd+K search box, rename dialog): must still
   move the caret by word, not navigate. Pinned in Task 3.
2. **Arabic (or other non-Latin) keyboard layout + ⌘[**: `e.key` is not `"["`,
   so a key-only check silently does nothing for exactly this app's users.
   Pinned in Task 3 via the `e.code` fallback test.
3. **wry's synthetic side-button events don't bubble** and are dispatched on
   `document.elementFromPoint`, deep in the tree. Only a capture-phase window
   listener sees them. Pinned in Task 3.
4. **Holding Alt+←** must step back once, not race to the root. Pinned in
   Task 3.
5. **A dev reload** leaves the entry mirror empty; the loop rule must then push
   as before, not misfire into a back step. Pinned in Task 2.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/components/LibrarySidebar.tsx` | modify | lose `NavArrows` and its import |
| `src/i18n/en.ts`, `src/i18n/ar.ts` | modify | drop `nav.back` / `nav.forward` |
| `src/store/navigation.ts` | modify | `NavState` slimmed; entry mirror + loop collapse; `back()` guard; `StorePage`, `goStorePage` |
| `src/store/navigation.test.ts` | create | store behaviour |
| `src/store/navInput.ts` | create | keyboard + mouse back/forward |
| `src/store/navInput.test.ts` | create | input mapping |
| `src/App.tsx` | modify | install `navInput`, drop old key effect |
| `src/components/DesktopReader.tsx` | modify | arrow handler ignores modified keys |
| `src/reader/fixed/FixedPageViewer.tsx` | modify | same |
| `src/components/readerNavKeys.test.tsx` | create | DesktopReader: Alt/⌘/Ctrl arrows don't turn |
| `src/reader/fixed/navKeysInViewer.test.tsx` | create | FixedPageViewer: same |
| `src/components/Store.tsx` | modify | page from props/history; no local page state; no intents |
| `src/components/Store.test.tsx` | modify | history-driven pages |
| `src/components/library/types.ts` | modify | `storePage?` layout prop |
| `src/components/library/Library.tsx` | modify | pass `storePage`; drop extensions-manager effect |
| `src/components/library/DesktopLibrary.tsx` | modify | pass `page`; search opens a source via history |
| `src/components/library/MobileLibrary.tsx` | modify | pass `page`; header back calls `back()` |
| `src/components/SourceHomeView.tsx` | modify | "Open extensions" via history; comment |
| `src/components/novel/ExtensionNotice.tsx` | modify | same |
| `src/store/uiIntents.ts` | modify | delete store-source + extensions-manager intents |
| `src/store/uiIntents.test.ts` | delete | covered only the deleted intent |

---

### Task 1: Remove the arrow buttons completely

**Files:**
- Modify: `src/components/LibrarySidebar.tsx` (import at line 28; head at ~148-179; `NavArrows` at ~933-990)
- Modify: `src/i18n/en.ts:190-191`, `src/i18n/ar.ts:150-151`
- Modify: `src/store/navigation.ts` (`NavState`, `compute`, index comment)

**Interfaces:**
- Produces: `NavState` is now `{ snapshot: NavSnapshot }`. `canBack` / `canForward` no longer exist.

- [ ] **Step 1: Confirm nothing else uses what we're deleting**

Run:
```bash
cd /Users/themostafaosama/Desktop/my-work/Riwaq-nav-history
grep -rn "canBack\|canForward\|NavArrows\|nav\.back\|nav\.forward" src
```
Expected: hits only in `LibrarySidebar.tsx`, `navigation.ts`, `en.ts`, `ar.ts`. If anything else appears, stop and report it.

- [ ] **Step 2: Delete `NavArrows` and its use**

In `src/components/LibrarySidebar.tsx`:

Remove the import line:
```ts
import { useNav, back, forward } from "../store/navigation";
```

Replace the head comment:
```tsx
      {/* Head — brand mark + wordmark, with the history back/forward pair
          pinned to the inline-end (the desktop equivalent of the Android
          hardware back). */}
```
with:
```tsx
      {/* Head — brand mark + wordmark. */}
```

Delete the line `        <NavArrows theme={theme} />` (directly after the wordmark `</span>`).

Delete the whole `NavArrows` function, from its doc comment
`/** History back/forward pair for the desktop chrome. Buttons disable when`
through its closing `}` (the line before `function MenuItem({`).

Keep the `Icon`, `useI18n`, `Theme` and `TRANSITION` imports/consts: other code in the file still uses them (`TRANSITION` has 14 other uses).

- [ ] **Step 3: Delete the strings**

In `src/i18n/en.ts` delete:
```ts
  "nav.back": "Back",
  "nav.forward": "Forward",
```
In `src/i18n/ar.ts` delete:
```ts
  "nav.back": "رجوع",
  "nav.forward": "للأمام",
```

- [ ] **Step 4: Slim `NavState`**

In `src/store/navigation.ts` replace:
```ts
export interface NavState {
  snapshot: NavSnapshot;
  /** True when there is an earlier entry to pop to (drives the desktop Back
   *  button's enabled state; on Android the OS supplies the affordance). */
  canBack: boolean;
  /** True when a forward entry exists (i.e. the user has gone back and not
   *  yet pushed a new destination over the top). */
  canForward: boolean;
}
```
with:
```ts
export interface NavState {
  snapshot: NavSnapshot;
}
```
Replace `compute()`:
```ts
function compute(): NavState {
  return { snapshot };
}
```
Replace the comment above `let snapshot` (it starts `// \`index\` is our position in the history stack`) with:
```ts
// `index` is our position in the history stack; `maxIndex` is the furthest
// forward entry that still exists, so forward() can tell when there is
// nothing ahead. The History API tracks the stack itself but doesn't expose
// that, so we mirror just enough (two integers, stamped into each entry's
// state) to answer it.
```

- [ ] **Step 5: Typecheck, lint, test**

Run: `pnpm build && pnpm lint && pnpm test`
Expected: all pass. A TS error naming `canBack`/`canForward` means Step 1 missed a user; fix it there.

- [ ] **Step 6: Commit**

```bash
pnpm format
git commit -m "feat(nav): remove the sidebar back/forward arrows" -- src/components/LibrarySidebar.tsx src/i18n/en.ts src/i18n/ar.ts src/store/navigation.ts
```

---

### Task 2: Navigation store — loop collapse, root guard, Store pages

**Files:**
- Modify: `src/store/navigation.ts`
- Create: `src/store/navigation.test.ts`

**Interfaces:**
- Produces:
  - `export type StorePage = { kind: "extensions" } | { kind: "source"; sourceId: string } | { kind: "novel"; sourceId: string; novelUrl: string };`
  - `LibraryView` member `{ kind: "store"; page?: StorePage }` (no `page` = sources list).
  - `export function goStorePage(page?: StorePage): void`
  - `navigate()` steps back instead of pushing when the target equals the entry directly behind.
  - `back()` at index 0 off-root replaces the entry with the root.

- [ ] **Step 1: Write the failing tests**

Create `src/store/navigation.test.ts`:
```ts
// @vitest-environment happy-dom
//
// The nav store is module state initialised at import, so every case loads a
// fresh copy over a history entry it has never stamped (state null), which
// is what a cold launch looks like to init().
import { beforeEach, describe, expect, it, vi } from "vitest";

type Nav = typeof import("./navigation");
let nav: Nav;

async function freshNav(): Promise<Nav> {
  vi.resetModules();
  return import("./navigation");
}

beforeEach(async () => {
  window.history.replaceState(null, "");
  nav = await freshNav();
});

const view = () => {
  const b = nav.getState().snapshot.base;
  return b.screen === "library" ? b.view : b;
};
const navIndex = () =>
  (window.history.state as { navIndex: number }).navIndex;

describe("navigate", () => {
  it("pushes a new destination and back() returns to the previous one", () => {
    nav.goLibrary({ kind: "store" });
    expect(view()).toEqual({ kind: "store" });
    expect(navIndex()).toBe(1);
    nav.back();
    expect(view()).toEqual({ kind: "shelf" });
    expect(navIndex()).toBe(0);
  });

  it("collapses A→B→A into a back step, keeping B on Forward", () => {
    nav.goLibrary({ kind: "store" });
    nav.goLibrary({ kind: "shelf" });
    expect(view()).toEqual({ kind: "shelf" });
    expect(navIndex()).toBe(0);
    nav.forward();
    expect(view()).toEqual({ kind: "store" });
    expect(navIndex()).toBe(1);
  });

  it("only collapses onto the entry directly behind", () => {
    nav.goLibrary({ kind: "store" }); // 1
    nav.goLibrary({ kind: "shelves" }); // 2
    nav.goShelf("s1"); // 3
    nav.goLibrary({ kind: "store" }); // behind is shelfDetail → push
    expect(view()).toEqual({ kind: "store" });
    expect(navIndex()).toBe(4);
  });

  it("a push after a collapse truncates forward history as usual", () => {
    nav.goLibrary({ kind: "store" });
    nav.goLibrary({ kind: "shelf" }); // collapse → index 0, store ahead
    nav.goLibrary({ kind: "shelves" }); // push → index 1, store gone
    expect(navIndex()).toBe(1);
    nav.forward();
    expect(view()).toEqual({ kind: "shelves" });
  });

  it("after a reload knows nothing behind, so it pushes instead of collapsing", async () => {
    nav.goLibrary({ kind: "store" }); // index 1; shelf behind
    nav = await freshNav(); // reload: restores index 1 from history.state
    expect(view()).toEqual({ kind: "store" });
    nav.goLibrary({ kind: "shelf" });
    expect(navIndex()).toBe(2);
  });
});

describe("back()", () => {
  it("is a no-op at the root", () => {
    nav.back();
    expect(view()).toEqual({ kind: "shelf" });
    expect(navIndex()).toBe(0);
  });

  it("falls back to the root when the first entry is not the root", () => {
    nav.goReader("b1", { replace: true });
    expect(view()).toEqual({ screen: "reader", bookId: "b1" });
    nav.back();
    expect(view()).toEqual({ kind: "shelf" });
    expect(navIndex()).toBe(0);
  });
});

describe("Store pages", () => {
  it("walk back through novel → source → sources", () => {
    nav.goStorePage();
    nav.goStorePage({ kind: "source", sourceId: "src" });
    nav.goStorePage({ kind: "novel", sourceId: "src", novelUrl: "/n" });
    nav.back();
    expect(view()).toEqual({
      kind: "store",
      page: { kind: "source", sourceId: "src" },
    });
    nav.back();
    expect(view()).toEqual({ kind: "store" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/store/navigation.test.ts`
Expected: FAIL. The collapse cases fail on `navIndex` (2 instead of 0), the root-guard case stays on the reader, and `goStorePage` is not a function. The first, third and "no-op at the root" cases may already pass; that's fine.

- [ ] **Step 3: Implement**

In `src/store/navigation.ts`:

Add above `LibraryView`:
```ts
/** A page inside the Store. No page means the sources list. */
export type StorePage =
  | { kind: "extensions" }
  | { kind: "source"; sourceId: string }
  | { kind: "novel"; sourceId: string; novelUrl: string };
```
Change the store member of `LibraryView` from `| { kind: "store" }` to:
```ts
  | { kind: "store"; page?: StorePage }
```

Below `let maxIndex = 0;` add:
```ts
// The snapshots of the entries we know, by index. Used only to spot a move
// back onto the entry directly behind (A→B→A), which becomes a back step
// rather than a third entry. After a full reload only the current entry is
// known, so the rule simply finds nothing behind and pushes as before.
let entries: NavSnapshot[] = [];
```

In `init()`, after each branch sets `snapshot`, record it. The stamped branch becomes:
```ts
    index = existing.navIndex;
    maxIndex = Math.max(maxIndex, index);
    snapshot = existing.snapshot;
    entries = [];
    entries[index] = snapshot;
```
and the fresh branch:
```ts
    window.history.replaceState({ navIndex: 0, snapshot: ROOT }, "");
    index = 0;
    maxIndex = 0;
    snapshot = ROOT;
    entries = [ROOT];
```

In `onPopState`, after both branches set `index`/`snapshot` and before `commit()`, add:
```ts
  entries[index] = snapshot;
```

Replace the body of `navigate()`:
```ts
export function navigate(
  next: NavSnapshot,
  opts?: { replace?: boolean },
): void {
  init();
  if (!opts?.replace && snapshotsEqual(next, snapshot)) return;
  if (opts?.replace) {
    window.history.replaceState({ navIndex: index, snapshot: next }, "");
    snapshot = next;
    entries[index] = next;
  } else {
    const behind = index > 0 ? entries[index - 1] : undefined;
    if (behind && snapshotsEqual(next, behind)) {
      // Going to where we just came from: step back instead, so the forward
      // entry survives and the stack doesn't grow A→B→A→B…
      back();
      return;
    }
    index += 1;
    maxIndex = index; // pushing a new entry truncates any forward history
    entries.length = index;
    entries[index] = next;
    window.history.pushState({ navIndex: index, snapshot: next }, "");
    snapshot = next;
  }
  commit();
}
```

Replace `back()`:
```ts
/** Step back one entry (the platform fires `popstate`, which updates us). At
 *  the root this is a no-op on desktop; on Android the OS then handles the
 *  back press itself (backgrounding/closing the app), which is what we want.
 *  If the first entry is somehow not the root, Back goes to the root rather
 *  than doing nothing, so a close button can never be dead. */
export function back(): void {
  init();
  if (index > 0) window.history.back();
  else if (!snapshotsEqual(snapshot, ROOT)) navigate(ROOT, { replace: true });
}
```

After `goShelf`, add:
```ts
/** Go to the Store, optionally at one of its pages. */
export function goStorePage(page?: StorePage): void {
  goLibrary(page ? { kind: "store", page } : { kind: "store" });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/store/navigation.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Tamper check**

Temporarily change `if (behind && snapshotsEqual(next, behind))` to `if (false)`. Run the file: the two collapse cases must FAIL. Restore. Then, in the stamped `init()` branch, temporarily replace `entries = [];` with `entries = [ROOT];` (pretending the reload knows the root is behind): the reload case must FAIL (navIndex 0, not 2). Restore and re-run: PASS.

- [ ] **Step 6: Full suite + commit**

Run: `pnpm build && pnpm test`
Expected: PASS.
```bash
pnpm format
git commit -m "feat(nav): collapse A→B→A, guard Back at the root, add Store pages" -- src/store/navigation.ts src/store/navigation.test.ts
```

---

### Task 3: One input module for keyboard and mouse back/forward

**Files:**
- Create: `src/store/navInput.ts`
- Create: `src/store/navInput.test.ts`
- Modify: `src/App.tsx:384-406` (the effect commented "Desktop back/forward, routed through nav history") and its imports

**Interfaces:**
- Consumes: `back(): void`, `forward(): void` from `./navigation`.
- Produces: `export function installNavInput(target?: Window): () => void` and `export function navDirection(e: KeyboardEvent): "back" | "forward" | null`.

- [ ] **Step 1: Write the failing tests**

Create `src/store/navInput.test.ts`:
```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const back = vi.fn();
const forward = vi.fn();
vi.mock("./navigation", () => ({ back, forward }));

const { installNavInput } = await import("./navInput");

let uninstall: () => void;
beforeEach(() => {
  back.mockClear();
  forward.mockClear();
  uninstall = installNavInput();
});
afterEach(() => {
  uninstall();
  document.body.replaceChildren();
});

function key(init: KeyboardEventInit, target: EventTarget = document.body) {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
}

function mouse(
  type: "mousedown" | "mouseup",
  button: number,
  target: EventTarget = document.body,
) {
  // Mirrors wry's synthetic event on macOS/Linux: cancelable, NOT bubbling,
  // dispatched on whatever element is under the pointer.
  const e = new MouseEvent(type, { button, cancelable: true, bubbles: false });
  target.dispatchEvent(e);
  return e;
}

describe("keyboard", () => {
  it.each([
    [{ key: "ArrowLeft", altKey: true }, "back"],
    [{ key: "ArrowRight", altKey: true }, "forward"],
    [{ key: "[", metaKey: true }, "back"],
    [{ key: "]", metaKey: true }, "forward"],
    [{ key: "BrowserBack" }, "back"],
    [{ key: "BrowserForward" }, "forward"],
  ] as const)("%o → %s", (init, dir) => {
    const e = key(init);
    expect(e.defaultPrevented).toBe(true);
    expect(dir === "back" ? back : forward).toHaveBeenCalledTimes(1);
    expect(dir === "back" ? forward : back).not.toHaveBeenCalled();
  });

  it("⌘[ on a non-Latin layout falls back to the physical key", () => {
    // Arabic layout: the [ key reports a letter, not "[".
    key({ key: "ج", code: "BracketLeft", metaKey: true });
    key({ key: "د", code: "BracketRight", metaKey: true });
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("ignores plain arrows and other modifier mixes", () => {
    for (const init of [
      { key: "ArrowLeft" },
      { key: "ArrowLeft", ctrlKey: true },
      { key: "ArrowLeft", altKey: true, shiftKey: true },
      { key: "ArrowLeft", altKey: true, metaKey: true },
      { key: "[" },
      { key: "[", metaKey: true, shiftKey: true },
    ]) {
      expect(key(init).defaultPrevented).toBe(false);
    }
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it.each(["input", "textarea", "contenteditable"])(
    "leaves Alt+arrows to a %s (word motion) but still honours ⌘[",
    (kind) => {
      const el =
        kind === "contenteditable"
          ? Object.assign(document.createElement("div"), {
              contentEditable: "true",
            })
          : document.createElement(kind);
      document.body.appendChild(el);
      expect(key({ key: "ArrowLeft", altKey: true }, el).defaultPrevented).toBe(
        false,
      );
      expect(back).not.toHaveBeenCalled();
      key({ key: "[", metaKey: true }, el);
      expect(back).toHaveBeenCalledTimes(1);
    },
  );

  it("auto-repeat is swallowed: holding Alt+← steps back once", () => {
    key({ key: "ArrowLeft", altKey: true });
    const held = key({ key: "ArrowLeft", altKey: true, repeat: true });
    key({ key: "ArrowLeft", altKey: true, repeat: true });
    expect(held.defaultPrevented).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("mouse side buttons", () => {
  it.each([
    [3, "back"],
    [4, "forward"],
  ] as const)(
    "button %i: cancels the native action and steps %s exactly once",
    (button, dir) => {
      const deep = document.createElement("span");
      document.body.appendChild(document.createElement("div")).appendChild(deep);
      expect(mouse("mousedown", button, deep).defaultPrevented).toBe(true);
      expect(back).not.toHaveBeenCalled();
      expect(forward).not.toHaveBeenCalled();
      expect(mouse("mouseup", button, deep).defaultPrevented).toBe(true);
      expect(dir === "back" ? back : forward).toHaveBeenCalledTimes(1);
      expect(dir === "back" ? forward : back).not.toHaveBeenCalled();
    },
  );

  it("ignores the primary, middle and secondary buttons", () => {
    for (const b of [0, 1, 2]) {
      expect(mouse("mousedown", b).defaultPrevented).toBe(false);
      expect(mouse("mouseup", b).defaultPrevented).toBe(false);
    }
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });
});

it("uninstall removes every listener", () => {
  uninstall();
  key({ key: "ArrowLeft", altKey: true });
  mouse("mouseup", 3);
  expect(back).not.toHaveBeenCalled();
  uninstall = installNavInput(); // so afterEach has something to remove
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/store/navInput.test.ts`
Expected: FAIL — cannot resolve `./navInput`.

- [ ] **Step 3: Implement**

Create `src/store/navInput.ts`:
```ts
// Every desktop back/forward input, routed into the nav store.
//
// Keyboard: Alt+←/→ everywhere (back is Alt+← in RTL too, as in every
// browser), ⌘[ / ⌘], and the BrowserBack/BrowserForward keys some keyboards
// have.
//
// Mouse side buttons (4/5, `MouseEvent.button` 3/4): the webview already
// navigates on these by itself. On macOS and Linux wry swallows the native
// event, dispatches a synthetic mousedown/mouseup on the element under the
// pointer, and calls history.back()/forward() unless that mouseup was
// defaultPrevented; WebView2 (Windows) navigates on mouseup natively. So we
// cancel both halves and navigate ourselves, once, through the same back()/
// forward() as every other input. The synthetic events don't bubble, which
// is why every listener here is on the window in the capture phase.
//
// Android is untouched: hardware Back arrives as `popstate` through the
// webview's own history.

import { back, forward } from "./navigation";

type Direction = "back" | "forward";

const SIDE_BUTTONS: Record<number, Direction> = { 3: "back", 4: "forward" };

/** Which way a keydown navigates, or null if it isn't a navigation key. */
export function navDirection(e: KeyboardEvent): Direction | null {
  if (e.key === "BrowserBack") return "back";
  if (e.key === "BrowserForward") return "forward";
  if (e.shiftKey || e.ctrlKey) return null;
  if (e.metaKey && !e.altKey) {
    // On a non-Latin layout (Arabic, for one) the [ key reports a letter, so
    // fall back to the physical key, but only then: on AZERTY "BracketLeft"
    // is a different printable key and its own character must win.
    const latin = /^[\x20-\x7e]$/.test(e.key);
    if (e.key === "[" || (!latin && e.code === "BracketLeft")) return "back";
    if (e.key === "]" || (!latin && e.code === "BracketRight")) return "forward";
    return null;
  }
  if (e.altKey && !e.metaKey) {
    if (e.key === "ArrowLeft") return "back";
    if (e.key === "ArrowRight") return "forward";
  }
  return null;
}

function isTextEntry(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
}

function go(dir: Direction): void {
  if (dir === "back") back();
  else forward();
}

function onKeyDown(e: KeyboardEvent): void {
  const dir = navDirection(e);
  if (!dir) return;
  // Option+←/→ moves the caret by a word on macOS; don't steal it from a
  // field the user is typing in.
  if (e.altKey && isTextEntry(e.target)) return;
  e.preventDefault();
  if (e.repeat) return; // holding the key steps once, not to the root
  go(dir);
}

function onMouseDown(e: MouseEvent): void {
  if (e.button in SIDE_BUTTONS) e.preventDefault();
}

function onMouseUp(e: MouseEvent): void {
  const dir = SIDE_BUTTONS[e.button];
  if (!dir) return;
  e.preventDefault();
  go(dir);
}

/** Install the listeners; returns a function that removes them. */
export function installNavInput(target: Window = window): () => void {
  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("mousedown", onMouseDown, true);
  target.addEventListener("mouseup", onMouseUp, true);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    target.removeEventListener("mousedown", onMouseDown, true);
    target.removeEventListener("mouseup", onMouseUp, true);
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/store/navInput.test.ts`
Expected: PASS. If the contenteditable case fails because happy-dom does not implement `isContentEditable`, do not weaken the test: change `isTextEntry` to also accept `t.closest('[contenteditable=""], [contenteditable="true"]') !== null`, which is correct in real browsers too.

- [ ] **Step 5: Tamper check**

One at a time, each must make at least one test FAIL, then restore:
- remove `e.preventDefault();` from `onMouseUp`;
- change the three `true` capture flags in `installNavInput` to `false` (the non-bubbling mouse cases must fail);
- delete the `!latin && e.code === "BracketLeft"` clause;
- delete `if (e.repeat) return;`.

- [ ] **Step 6: Wire into App**

In `src/App.tsx`, replace the whole effect that begins with the comment
`// Desktop back/forward, routed through nav history. Alt+←/→ and (on macOS)`
and ends with `window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);` with:
```tsx
  // Keyboard and mouse back/forward (see navInput.ts for the side-button
  // story). Android's hardware Back arrives as popstate instead.
  useEffect(() => installNavInput(), []);
```
Add `import { installNavInput } from "./store/navInput";` beside the `./store/navigation` import. Remove `forward` from the `./store/navigation` import list if nothing else in `App.tsx` uses it (check with `grep -n "forward(" src/App.tsx`).

- [ ] **Step 7: Full suite + commit**

Run: `pnpm build && pnpm lint && pnpm test`
Expected: PASS.
```bash
pnpm format
git commit -m "feat(nav): own keyboard and mouse back/forward in one module" -- src/store/navInput.ts src/store/navInput.test.ts src/App.tsx
```

---

### Task 4: Readers ignore modified arrow keys

**Files:**
- Modify: `src/components/DesktopReader.tsx` (arrow handler, ~line 704-735)
- Modify: `src/reader/fixed/FixedPageViewer.tsx` (paged arrow handler, ~line 1076-1084)
- Create: `src/components/readerNavKeys.test.tsx`
- Create: `src/reader/fixed/navKeysInViewer.test.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing DesktopReader test**

Create `src/components/readerNavKeys.test.tsx`:
```tsx
// @vitest-environment happy-dom
//
// Alt+←/→ (and ⌘/Ctrl+arrows) belong to app navigation. The reader's own
// arrow handler must leave them alone, or one press both leaves the reader
// and turns a chapter.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpubBook } from "../epub/types";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { I18nProvider } from "../i18n/I18nProvider";
import type { BookState } from "../store/library";
import { THEMES } from "../styles/tokens";
import { DesktopReader } from "./DesktopReader";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

const BOOK: EpubBook = {
  id: "b1",
  title: "Book",
  author: "Author",
  language: "en",
  chapters: [0, 1, 2].map((i) => ({
    id: `c${i}`,
    href: `c${i}.xhtml`,
    title: `Chapter ${i + 1}`,
    order: i,
    paragraphs: Array.from({ length: 10 }, (_, n) => ({
      text: `Paragraph ${n} of chapter ${i + 1}.`,
    })),
  })),
};

const STATE: BookState = {
  bookId: "b1",
  currentChapter: 1,
  paragraphIndex: 0,
  highlights: [],
};

const onChapterChange = vi.fn();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  onChapterChange.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <DesktopReader
          theme={THEMES.sepia}
          themeKey="sepia"
          t={{ ...DEFAULT_TWEAKS, readingMode: "scroll" }}
          setTweak={() => {}}
          book={BOOK}
          state={STATE}
          currentChapter={1}
          resumeParagraph={0}
          jumpNonce={0}
          onChapterChange={onChapterChange}
          onParagraphChange={() => {}}
          onCreateHighlight={() => {}}
          onDeleteHighlight={() => {}}
          onUpdateHighlightNote={() => {}}
          onJumpToHighlight={() => {}}
          activePanel={null}
          setActivePanel={() => {}}
          onBack={() => {}}
        />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function press(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}

describe("DesktopReader arrow keys", () => {
  it("plain arrows still change chapter (control for the case below)", () => {
    press({ key: "ArrowRight" });
    press({ key: "ArrowLeft" });
    expect(onChapterChange).toHaveBeenCalledTimes(2);
  });

  it.each(["altKey", "metaKey", "ctrlKey"] as const)(
    "%s + arrow does not change chapter",
    (mod) => {
      press({ key: "ArrowRight", [mod]: true });
      press({ key: "ArrowLeft", [mod]: true });
      expect(onChapterChange).not.toHaveBeenCalled();
    },
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/components/readerNavKeys.test.tsx`
Expected: the control passes (chapter 1 of 3, so both directions move); the three modifier cases FAIL with 2 calls. If the control fails, the harness is wrong — fix it before going on; a modifier test with a broken control proves nothing.

- [ ] **Step 3: Fix DesktopReader**

In `src/components/DesktopReader.tsx`, in the keydown handler, after
```ts
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
```
add:
```ts
      // Alt/⌘/Ctrl+arrows are app back/forward (navInput.ts), not page turns.
      if (e.altKey || e.metaKey || e.ctrlKey) return;
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/components/readerNavKeys.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing FixedPageViewer test**

Create `src/reader/fixed/navKeysInViewer.test.tsx`:
```tsx
// @vitest-environment happy-dom
//
// Paged PDF/DOCX: ←/→ flip pages, but Alt/⌘/Ctrl+arrows are app
// back/forward and must not also flip.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FixedPageViewer } from "./FixedPageViewer";
import type { FixedPageSource } from "./FixedPageSource";
import { THEMES } from "../../styles/tokens";

const VIEWPORT = 900;
const sizeProps = ["clientWidth", "clientHeight"] as const;
let saved: PropertyDescriptor[] = [];
let host: HTMLDivElement;
let root: Root;
let page = -1;

function fakeSource(): FixedPageSource {
  return {
    kind: "pdf",
    pageCount: 60,
    outline: [],
    hasTextLayer: false,
    async pageSize() {
      return { w: 612, h: 792 };
    },
    async renderPage(i, el) {
      const p = document.createElement("div");
      p.setAttribute("data-page-index", String(i));
      el.replaceChildren(p);
    },
    destroy() {},
  };
}

async function settle() {
  for (let n = 0; n < 6; n++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

beforeEach(async () => {
  // happy-dom lays nothing out; give the viewer a viewport to measure.
  saved = sizeProps.map(
    (p) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, p)!,
  );
  for (const p of sizeProps) {
    Object.defineProperty(HTMLElement.prototype, p, {
      configurable: true,
      get: () => VIEWPORT,
    });
  }
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  page = -1;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <FixedPageViewer
        source={fakeSource()}
        flow="paged"
        fit="width"
        zoom={1}
        tint="none"
        dir="ltr"
        turnAxis="y"
        theme={THEMES.light}
        themeKey="light"
        highlights={[]}
        onSelect={() => {}}
        onHighlightClick={() => {}}
        onProgress={(p) => {
          page = p.page;
        }}
      />,
    );
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  sizeProps.forEach((p, i) => {
    Object.defineProperty(HTMLElement.prototype, p, saved[i]);
  });
});

async function press(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
  await settle();
  await settle();
}

describe("FixedPageViewer paged arrow keys", () => {
  it("plain → flips a page (control for the cases below)", async () => {
    expect(page).toBe(0);
    await press({ key: "ArrowRight" });
    expect(page).toBe(1);
  });

  it.each(["altKey", "metaKey", "ctrlKey"] as const)(
    "%s + → does not flip",
    async (mod) => {
      expect(page).toBe(0);
      await press({ key: "ArrowRight", [mod]: true });
      expect(page).toBe(0);
    },
  );
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm vitest run src/reader/fixed/navKeysInViewer.test.tsx`
Expected: control PASS (page 0 → 1; this was confirmed by a probe while writing this plan), modifier cases FAIL with `page` 1.

- [ ] **Step 7: Fix FixedPageViewer**

In `src/reader/fixed/FixedPageViewer.tsx`, replace:
```ts
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") flip(dir === "rtl" ? +1 : -1);
```
with:
```ts
    const onKey = (e: KeyboardEvent) => {
      // Alt/⌘/Ctrl+arrows are app back/forward (navInput.ts), not page turns.
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowLeft") flip(dir === "rtl" ? +1 : -1);
```

- [ ] **Step 8: Run, tamper, commit**

Run: `pnpm vitest run src/reader/fixed/navKeysInViewer.test.tsx src/components/readerNavKeys.test.tsx`
Expected: PASS. Tamper: remove each new guard line in turn; its file's modifier cases must FAIL. Restore.
```bash
pnpm build && pnpm test
pnpm format
git commit -m "fix(reader): Alt/⌘/Ctrl+arrows no longer turn a page as well as navigating" -- src/components/DesktopReader.tsx src/reader/fixed/FixedPageViewer.tsx src/components/readerNavKeys.test.tsx src/reader/fixed/navKeysInViewer.test.tsx
```

---

### Task 5: The Store's pages live in history

**Files:**
- Modify: `src/components/Store.tsx`
- Modify: `src/components/Store.test.tsx`
- Modify: `src/components/library/types.ts` (after `activeShelfId?: string;`)
- Modify: `src/components/library/Library.tsx` (~line 274 and ~978-986, layout props ~1118)
- Modify: `src/components/library/DesktopLibrary.tsx` (destructure, `<Store>` ~229, search ~461)
- Modify: `src/components/library/MobileLibrary.tsx` (destructure, `BackHeader` ~262, `<Store>` ~268)
- Modify: `src/components/SourceHomeView.tsx` (import line 28, comment ~92, button ~208)
- Modify: `src/components/novel/ExtensionNotice.tsx` (import line 15, button ~124)
- Modify: `src/store/uiIntents.ts`
- Delete: `src/store/uiIntents.test.ts`

**Interfaces:**
- Consumes: `StorePage`, `goStorePage(page?: StorePage)`, `back()`, `useNav()`, `goLibrary()` from `src/store/navigation.ts` (Task 2).
- Produces: `Store` prop `page?: StorePage`; `LayoutProps.storePage?: StorePage`.

- [ ] **Step 1: Write the failing Store tests**

In `src/components/Store.test.tsx`:

Replace the import block
```ts
import {
  openExtensionsManager,
  takePendingExtensionsManager,
} from "../store/uiIntents";
```
with:
```ts
import type { ReactElement } from "react";
import { goLibrary, useNav } from "../store/navigation";
```

Replace the three sub-view mocks for `SourcesListView`, `SourceHomeView` and `NovelDetailView` with clickable stubs (keep the `ExtensionsView` and `DownloadRangeDialog` mocks as they are):
```tsx
vi.mock("./SourcesListView", () => ({
  SourcesListView: ({ onOpenSource }: { onOpenSource: (id: string) => void }) => (
    <button
      type="button"
      data-testid="sources-list-view"
      onClick={() => onOpenSource("s1")}
    />
  ),
}));
vi.mock("./SourceHomeView", () => ({
  SourceHomeView: ({
    sourceId,
    onOpenNovel,
    onBack,
  }: {
    sourceId: string;
    onOpenNovel: (url: string) => void;
    onBack: () => void;
  }) => (
    <div data-testid="source-home" data-source={sourceId}>
      <button
        type="button"
        data-testid="open-novel"
        onClick={() => onOpenNovel("/n1")}
      />
      <button type="button" data-testid="source-back" onClick={onBack} />
    </div>
  ),
}));
vi.mock("./novel/NovelDetailView", () => ({
  NovelDetailView: ({
    novelUrl,
    onBack,
  }: {
    novelUrl: string;
    onBack: () => void;
  }) => (
    <div data-testid="novel-detail" data-novel={novelUrl}>
      <button type="button" data-testid="novel-back" onClick={onBack} />
    </div>
  ),
}));
```

In `beforeEach`, delete the line `takePendingExtensionsManager();`.

Replace `function mount() { … }` with a version that can render something other than the bare Store:
```tsx
  function mount(el?: ReactElement) {
    root = createRoot(host);
    act(() => {
      root.render(
        <I18nProvider locale="en">
          {el ?? (
            <Store
              theme={THEMES.light}
              layout="desktop"
              onStreamRead={() => {}}
              onImportComplete={() => {}}
            />
          )}
        </I18nProvider>,
      );
    });
  }

  /** The Store as the Library renders it: its page comes from history. */
  function HistoryStore() {
    const { snapshot } = useNav();
    const v = snapshot.base.screen === "library" ? snapshot.base.view : null;
    return (
      <Store
        theme={THEMES.light}
        layout="desktop"
        page={v?.kind === "store" ? v.page : undefined}
        onStreamRead={() => {}}
        onImportComplete={() => {}}
      />
    );
  }

  async function ready() {
    await act(async () => {
      resolveInit?.();
      await Promise.resolve();
    });
  }

  const q = (id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (id: string) =>
    act(() => {
      q(id)?.click();
    });
```

Replace the two tests `"opens the extensions manager for a request made before it mounted"` and `"opens the extensions manager for a request made while mounted"` (and the comment block above them) with:
```tsx
  // The page comes from nav history, so a Store mounted fresh — back from
  // the reader, or sent to the extensions manager from a saved novel's
  // notice — lands on that page, not on the sources list.
  it("renders the page it is given on a fresh mount", async () => {
    mount(
      <Store
        theme={THEMES.light}
        layout="desktop"
        page={{ kind: "source", sourceId: "s9" }}
        onStreamRead={() => {}}
        onImportComplete={() => {}}
      />,
    );
    await ready();
    expect(q("source-home")?.dataset.source).toBe("s9");
    expect(q("sources-list-view")).toBeNull();
  });

  it("renders the extensions manager without waiting for extensions", () => {
    mount(
      <Store
        theme={THEMES.light}
        layout="desktop"
        page={{ kind: "extensions" }}
        onStreamRead={() => {}}
        onImportComplete={() => {}}
      />,
    );
    expect(q("extensions-view")).not.toBeNull();
  });

  it("walks its pages through history: sources → source → novel and back", async () => {
    act(() => goLibrary({ kind: "store" }));
    mount(<HistoryStore />);
    await ready();
    click("sources-list-view");
    expect(q("source-home")?.dataset.source).toBe("s1");
    click("open-novel");
    expect(q("novel-detail")?.dataset.novel).toBe("/n1");
    click("novel-back");
    expect(q("source-home")?.dataset.source).toBe("s1");
    // The platform Back (Android hardware, mouse button) walks the same way.
    act(() => window.history.back());
    expect(q("sources-list-view")).not.toBeNull();
    act(() => window.history.forward());
    click("source-back");
    expect(q("sources-list-view")).not.toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/components/Store.test.tsx`
Expected: FAIL. The new cases fail because `Store` has no `page` prop and keeps its own state. The older init/skeleton cases still pass.

- [ ] **Step 3: Rewrite the Store's page handling**

In `src/components/Store.tsx`:

Replace the opening comment's first paragraph
```ts
// The Store — top-level container for browsing source extensions.
//
// Owns the in-store navigation state:
```
with:
```ts
// The Store — top-level container for browsing source extensions.
//
// Renders the in-store page named by nav history (`page`, from the
// Library's `{ kind: "store", page }` view), so Back walks
// novel → source → sources like any other destination:
```
and in the paragraph that follows, replace
```ts
// Each sub-view receives a small set of callbacks (`onOpenSource`,
// `onOpenNovel`, `onBack`) so navigation flows in one direction through
// here.
```
with:
```ts
// Each sub-view receives a small set of callbacks (`onOpenSource`,
// `onOpenNovel`, `onBack`); opening pushes a history entry and onBack is
// plain back().
```
and replace the sentence
```ts
// below, not just an implementation detail: switching tabs does NOT
// preserve `view`/`rangeDialog` state.
```
with:
```ts
// below, not just an implementation detail: switching tabs does NOT
// preserve `rangeDialog` state (the page itself lives in history).
```

Replace the uiIntents import block:
```ts
import {
  onOpenExtensionsManager,
  onOpenStoreSource,
  takePendingExtensionsManager,
  takePendingStoreSource,
} from "../store/uiIntents";
```
with:
```ts
import { back, goStorePage, type StorePage } from "../store/navigation";
```
Change `import { useCallback, useEffect, useState } from "react";` only if a hook becomes unused (it won't: all three are still used).

Add to `interface Props`:
```ts
  /** Which Store page is showing, from nav history. Absent = sources list. */
  page?: StorePage;
```

Replace the `StoreView` type with:
```ts
type StoreView = { kind: "sources" } | StorePage;
```

Destructure `page` in the component signature, and replace
```ts
  const [view, setView] = useState<StoreView>({ kind: "sources" });
```
with:
```ts
  const view: StoreView = page ?? { kind: "sources" };
```

Replace the five callbacks `openSource` … `backToSource` with:
```ts
  const openSource = useCallback((sourceId: string) => {
    goStorePage({ kind: "source", sourceId });
  }, []);

  const openExtensions = useCallback(() => {
    goStorePage({ kind: "extensions" });
  }, []);

  const openNovel = useCallback((sourceId: string, novelUrl: string) => {
    goStorePage({ kind: "novel", sourceId, novelUrl });
  }, []);

  const backToSources = useCallback(() => back(), []);
  const backToSource = useCallback(() => back(), []);
```

Delete both intent effects: the one under the comment
`// Open a source targeted from outside the Store (the main search's Websites`
and the one under `// "Open Extensions", asked for from anywhere — in practice the notice a`.

- [ ] **Step 4: Thread `storePage` through the Library**

`src/components/library/types.ts` — add `import type { StorePage } from "../../store/navigation";` with the other imports, and after `activeShelfId?: string;`:
```ts
  /** The Store page from nav history, when the Store is the destination. */
  storePage?: StorePage;
```

`src/components/library/Library.tsx` — after
```ts
  const activeShelfId = view.kind === "shelfDetail" ? view.shelfId : undefined;
```
add:
```ts
  const storePage = view.kind === "store" ? view.page : undefined;
```
In `layoutCommonProps`, after `activeShelfId,` add `storePage,`.
Delete the effect and its comment block:
```ts
  // "Open Extensions", asked for by the notice a saved novel shows when its
  // ...
  useEffect(
    () => onOpenExtensionsManager(() => goLibrary({ kind: "store" })),
    [],
  );
```
and remove `onOpenExtensionsManager,` from the `../../store/uiIntents` import (keep `onOpenDownloadQueue`).

`src/components/library/DesktopLibrary.tsx` — add `storePage,` next to `activeShelfId,` in the props destructuring; add `page={storePage}` to `<Store … layout="desktop" …>`; replace
```tsx
          onOpenStoreSource={(sourceId) => {
            openStoreSource(sourceId);
            setTab("store");
          }}
```
with:
```tsx
          onOpenStoreSource={(sourceId) =>
            goStorePage({ kind: "source", sourceId })
          }
```
Replace `import { openStoreSource } from "../../store/uiIntents";` with `import { goStorePage } from "../../store/navigation";` (merge into an existing `../../store/navigation` import if the file has one).

`src/components/library/MobileLibrary.tsx` — add `storePage,` next to `activeShelfId,` in the destructuring; add `page={storePage}` to `<Store … layout="mobile" …>`; change the Store `BackHeader`'s `onBack={() => setTab("all")}` to `onBack={() => back()}` (`back` is already imported).

- [ ] **Step 5: "Open extensions" goes through history**

`src/components/SourceHomeView.tsx` — replace `import { openExtensionsManager } from "../store/uiIntents";` with `import { goStorePage } from "../store/navigation";`; change `onClick={openExtensionsManager}` to `onClick={() => goStorePage({ kind: "extensions" })}`; change the comment
```ts
  // Load sections on mount, and again whenever sourceId changes — e.g.
  // uiIntents.openStoreSource can swap sourceId in place without
  // unmounting this component.
```
to:
```ts
  // Load sections on mount, and again whenever sourceId changes — e.g.
  // the main search opening another source while this page is showing
  // swaps sourceId in place without unmounting this component.
```

`src/components/novel/ExtensionNotice.tsx` — replace `import { openExtensionsManager } from "../../store/uiIntents";` with `import { goStorePage } from "../../store/navigation";` and `onClick={openExtensionsManager}` with `onClick={() => goStorePage({ kind: "extensions" })}`.

- [ ] **Step 6: Delete the now-dead intents**

In `src/store/uiIntents.ts` delete everything from the comment
`// One-shot "open a specific source in the Store" intent. Carries the source`
to the end of the file (`openStoreSource`, `onOpenStoreSource`, `takePendingStoreSource`, `openExtensionsManager`, `onOpenExtensionsManager`, `takePendingExtensionsManager` and their state). Keep the pub/sub core and the download-queue intent.

Delete `src/store/uiIntents.test.ts` (every case in it covers the deleted extensions-manager intent):
```bash
git rm src/store/uiIntents.test.ts
```

Confirm nothing still refers to them:
```bash
grep -rn "openStoreSource\|takePendingStoreSource\|onOpenStoreSource\|ExtensionsManager" src
```
Expected: only `SearchOverlay.tsx`'s own `onOpenStoreSource` prop (a callback name, not the intent) and nothing else.

- [ ] **Step 7: Run to verify pass**

Run: `pnpm vitest run src/components/Store.test.tsx src/store/navigation.test.ts`
Expected: PASS.

- [ ] **Step 8: Tamper check**

Temporarily make `backToSource` call `goStorePage()` instead of `back()`: the history-walk test must FAIL (novel-back lands on the sources list). Temporarily ignore the prop (`const view: StoreView = { kind: "sources" };`): both page tests must FAIL. Restore.

- [ ] **Step 9: Full suite + commit**

Run: `pnpm build && pnpm lint && pnpm test`
Expected: PASS.
```bash
pnpm format
git commit -m "feat(store): keep the Store's pages in nav history" -- src/components/Store.tsx src/components/Store.test.tsx src/components/library/types.ts src/components/library/Library.tsx src/components/library/DesktopLibrary.tsx src/components/library/MobileLibrary.tsx src/components/SourceHomeView.tsx src/components/novel/ExtensionNotice.tsx src/store/uiIntents.ts src/store/uiIntents.test.ts
```

---

### Task 6: Whole-branch verification on the real apps

**Files:** none changed unless a check fails.

- [ ] **Step 1: Full check**

Run: `pnpm check`
Expected: format check, lint, build and tests all pass. Paste the summary lines in the report.

- [ ] **Step 2: Desktop app against a copy of app data**

Follow the `desktop-worktree-live-reload` and `never-drive-the-real-app-data` notes in memory: copy the app-data directory first, run the mac app against this worktree's vite. Then check, and write down what you saw for each:
- The sidebar head shows only the logo and wordmark; nothing is left of the arrow pair (no gap, no stray border).
- Mouse side button 4 goes back exactly one step and button 5 forward one step, in the library and in an open book (open a book, press 4 once: you are on the library, not one screen further back).
- Alt+← / Alt+→ and ⌘[ / ⌘] do the same; in the reader Alt+← leaves the book without turning a page first.
- In the Cmd+K search box, Option+← moves the caret by one word and does not navigate.
- Store → a source → a novel → Back → Back: novel, source, sources list.
- Library → Store → Library from the sidebar, then Back: stays on the library (root); Forward: Store.

- [ ] **Step 3: Android emulator**

Using the `android-emulator-dev-setup` note (`pnpm android:dev`, AVD `leaflet`): hardware Back walks Store novel → source → sources → library, and exits the app from the library root. The mobile Store header's back arrow goes to the previous screen.

- [ ] **Step 4: Report**

Report each check above as passed / failed with what was observed. Do not open a PR; the user decides that.
