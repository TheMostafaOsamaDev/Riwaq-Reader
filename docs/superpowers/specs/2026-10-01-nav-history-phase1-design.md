# Navigation history, phase 1: remove the arrow buttons, own the inputs, close the gaps

Date: 2026-10-01
Branch: `feat/nav-history`

## Context

The desktop sidebar header has a back/forward arrow pair (`NavArrows`,
`src/components/LibrarySidebar.tsx`). We are removing it. History itself stays,
and is driven entirely by keyboard, mouse side buttons, the Android hardware
back, and (in a later phase) the macOS trackpad swipe.

This is phase 1 of four. Each phase gets its own spec, plan and PR:

1. **This spec.** Remove the buttons, own the inputs, close the history gaps.
2. Per-entry memory: each history entry gets an id and remembers its view state
   (scroll, query, filters, loaded result pages), restored on Back/Forward.
3. In-book jumps: TOC, progress-bar seek and highlight jumps become history
   steps in the same shared stack, so Back returns to where you were reading
   before it leaves the book.
4. macOS trackpad swipe, via WKWebView's `allowsBackForwardNavigationGestures`
   (wry has it, Tauri 2.11 does not expose it), plus the wheel-handler fixes it
   needs.

Decisions already taken with the user:

- One shared history for screens and (phase 3) in-book jumps.
- Mouse side buttons are owned in JS, not left to the webview.
- The arrows are removed with no on-screen replacement. Every deep desktop
  view already has its own visible back or close (novel page, Store pages,
  reader, Settings); a shelf page has none, but the sidebar is always visible
  and lists every shelf.

## Facts this design rests on

- `src/store/navigation.ts` is a History-API store: one `pushState` per
  destination, one `popstate` listener. Snapshot = `{ base, overlay }`.
- `App.tsx:384-406` handles Alt+←/→ and ⌘[ / ⌘]. It calls `preventDefault`
  even inside text fields, which steals macOS Option+← (move one word).
- Mouse buttons 4/5 already navigate natively on every desktop platform:
  - macOS and Linux: wry intercepts the native event, dispatches a synthetic
    `mousedown`/`mouseup` with `button` 3/4, then calls `history.back()` /
    `history.forward()` unless the `mouseup` was `defaultPrevented`
    (`wry-0.55.1/src/wkwebview/synthetic_mouse_events.rs`,
    `src/webkitgtk/synthetic_mouse_events.rs`). No `auxclick`, no pointer
    events.
  - Windows: WebView2/Chromium navigates on `mouseup` and fires real
    `mousedown`/`mouseup`/`auxclick` events.
  So a JS handler that does not cancel the native action goes back twice.
- `DesktopReader.tsx:704` and `FixedPageViewer.tsx:1079` handle ←/→ without
  checking modifiers, so Alt+← in the reader goes back *and* turns a page or
  chapter.
- The Store keeps its own sub-navigation in `useState` (`Store.tsx:85-98`:
  `sources | extensions | source | novel`). None of it is in history, so Back
  from a Store novel leaves the Store entirely.
- `uiIntents.ts` holds two one-shot flags, `pendingStoreSource` and
  `pendingExtensionsManager`, that exist only to hand a Store page across a
  remount because that page is not in history.
- The mobile Store header's back (`MobileLibrary.tsx:262`) calls
  `setTab("all")`, which pushes a new `shelf` entry instead of going back.
- No caller uses `{ replace: true }`, and the root entry is always stamped at
  index 0. No live path where Back gets stuck has been found.

## A. Remove the buttons completely

- Delete the `NavArrows` component and its use in the sidebar head
  (`LibrarySidebar.tsx`, around lines 148-179 and 933-990).
- Remove imports only it used (`useNav`, `back`, `forward`; check `Icon`,
  `TRANSITION`, `Theme` still have other users before removing).
- Rewrite the head comment so it no longer mentions the arrow pair. The brand
  mark and wordmark row keeps its layout.
- Delete `nav.back` / `nav.forward` from `src/i18n/en.ts` and `src/i18n/ar.ts`
  after confirming nothing else reads them.
- Drop `canBack` / `canForward` from `NavState`; nothing reads them once the
  arrows are gone. Keep the internal `index` / `maxIndex` so `forward()` can
  still tell whether there is anything ahead.

The parallel `fix/sidebar-tree` worktree has uncommitted edits to
`LibrarySidebar.tsx` in other regions (tree items, `Collapse`, `TreeButton`).
Its changes don't overlap ours; expect a clean merge, but re-check whichever
lands second.

## B. One input module: `src/store/navInput.ts`

A single `installNavInput(): () => void`, called once from `App` (replacing the
effect at `App.tsx:384-406`). It returns its own teardown for tests and HMR.

**Keyboard** (`keydown`, capture phase on `window`):

| Keys | Action | Platform |
|---|---|---|
| Alt+← / Alt+→ | back / forward | all |
| ⌘[ / ⌘] | back / forward | macOS (`metaKey`) |
| `BrowserBack` / `BrowserForward` keys | back / forward | all |

- Alt+← is always back, in RTL as well as LTR, matching every browser.
- If the event target is an `input`, a `textarea` or `contentEditable`, Alt+←/→
  is ignored so the text field keeps its word-motion shortcut. ⌘[ / ⌘] and the
  Browser keys still navigate.
- A handled key calls `preventDefault()`. Auto-repeat (`e.repeat`) is
  prevented but ignored, so holding Alt+← steps back once, not through the
  whole stack.

**Mouse side buttons** (capture phase on `window`; capture runs even for
wry's non-bubbling synthetic events):

- On `mousedown` with `button === 3 || 4`: `preventDefault()`.
- On `mouseup` with `button === 3 || 4`: `preventDefault()` (this is what stops
  wry's injected `history.back()` / `forward()` and Chromium's native one),
  then call our `back()` / `forward()`.
- Cancelling on `mousedown` too covers WebView2 builds reported to act on
  press.
- `auxclick` is not used; macOS and Linux never fire it.

**Reader conflicts:**

- `DesktopReader.tsx` arrow handler: return early when `altKey`, `metaKey` or
  `ctrlKey` is set.
- `FixedPageViewer.tsx` arrow handler: same.

**Android:** unchanged. Hardware back arrives as `popstate` through the
webview history.

The misleading comment in `App.tsx` ("Mouse side-buttons are left to the
webview") is removed with the effect it described.

## C. The Store's pages go into history

`LibraryView`'s store entry gains an optional page:

```ts
| {
    kind: "store";
    page?:
      | { kind: "extensions" }
      | { kind: "source"; sourceId: string }
      | { kind: "novel"; sourceId: string; novelUrl: string };
  }
```

No `page` means the sources list, so every existing `{ kind: "store" }` stays
valid.

- `Store.tsx` drops its `view` state and reads the page from the nav store
  (via a prop from `Library`, matching how other library views receive theirs).
- `openSource` / `openExtensions` / `openNovel` push
  `goLibrary({ kind: "store", page })`.
- `backToSources` / `backToSource` become `back()`.
- The download-range dialog stays local state; it is a dialog, not a
  destination.
- `uiIntents.ts`: `pendingStoreSource` and `pendingExtensionsManager` (with
  their request/consume helpers) are replaced at their call sites by direct
  `goLibrary({ kind: "store", page: … })`, then deleted. Their callers must be
  traced to confirm the replacement happens at the same moment, before the
  Store mounts.
- The Library's own `{ kind: "novel" }` view (opened from a library card) is
  unchanged. Store novels stay under `store` so the Store tab stays
  highlighted.

The Library body's `AnimatedSwap` key for the Store (`tab:store`) stays the
same across Store pages. Store pages swap inside the Store as they do today,
so no new remount or animation is introduced.

## D. No A→B→A loops

- `navigation.ts` keeps an in-memory `entries: NavSnapshot[]` mirror of what it
  pushed, indexed like `index`. It is written on push and replace, and read on
  `popstate`.
- In `navigate()` (push, not replace): if `index > 0` and the target equals
  `entries[index - 1]`, call `back()` instead of pushing. The forward entry
  stays available.
- After a full reload, `entries` knows only the current entry, so the check
  finds nothing behind and simply pushes, as now.
- `MobileLibrary.tsx:262` (mobile Store header back) calls `back()` instead of
  `setTab("all")`.
- The bottom-nav tab switches keep pushing. The loop rule already removes their
  ping-pong.

Equality uses the existing `snapshotsEqual` (JSON compare).

## E. Back never gets stuck (guard)

In `back()`: if `index === 0` and the snapshot is not the root, replace the
entry with the root (`navigate(ROOT, { replace: true })`) instead of doing
nothing. No current path triggers it; it is a three-line guard so the reader's
and Settings' close buttons (which call `back()`) can never be dead.

## Out of scope for phase 1

- Scroll/state restoration (phase 2), in-book jumps (phase 3), trackpad swipe
  (phase 4).
- Persisting history across app restarts.
- Any new on-screen navigation control.

## Testing

Unit tests (Vitest + happy-dom; History API is available there):

- `navInput`: each key combination maps to the right call; Alt+←/→ ignored in
  `input`, `textarea` and `contentEditable` while ⌘[ / ⌘] still navigate;
  mouse `button` 3/4 `mouseup` calls `back()` / `forward()` exactly once and is
  `defaultPrevented`, and `mousedown` is `defaultPrevented`; buttons 0-2 are
  ignored; teardown removes every listener.
- To avoid a false green (see the false-green-tests note), each test is
  tampered once: break the handler and confirm the test fails.
- Reader: Alt+← and ⌘← in `DesktopReader` and `FixedPageViewer` do not turn a
  page; plain ← still does.
- `navigation`: A→B→A collapses to a back step, and Forward then returns to B;
  pushing after a collapse truncates forward as usual; the store-page
  round-trip (sources → source → novel → Back → Back lands on sources); the
  `back()` guard at index 0 off-root.
- `Store.test.tsx`: updated for history-driven pages.

Manual, on the macOS app (a copy of app data, never the real library):

- The mouse side buttons go back and forward exactly one step, in the library
  and in the reader.
- Option+← inside the search box moves one word and does not navigate.
- Store → source → novel → Back → Back returns through the source to the
  sources list.

Android (emulator): hardware back still walks the same entries, including the
new Store pages, and exits the app from the root.

`pnpm check` (format check, lint, `tsc && vite build`, `vitest run`) must pass
before calling it done.
