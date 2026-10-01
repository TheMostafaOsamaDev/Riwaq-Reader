// App-wide navigation history, backed by the browser History API.
//
// Why the History API and not a hand-rolled stack: the platform already
// maintains a back/forward stack that the *webview* wires to the things we
// want to honor for free — the Android hardware back button, desktop mouse
// side-buttons (BrowserBack/BrowserForward), and Alt+←/→. We push one
// history entry per "major destination" and listen for `popstate`; a single
// listener then drives back AND forward across every one of those triggers.
// (The alternative — our own array + index — would force us to re-wire each
// of those input sources by hand.)
//
// The unit of navigation is a *snapshot* of the app's destination-level state,
// split into two orthogonal dimensions so overlays keep rendering the way
// they do today:
//   - `base`    — the full-screen destination shown by App's top-level swap
//                 (a Library view, the reader, or Settings).
//   - `overlay` — a layer that sits ON TOP of the base without replacing it
//                 (the streaming reader, the download queue). Modeling these
//                 as a separate dimension is what lets the Library stay
//                 mounted under the streaming reader (preserving the open
//                 novel-detail) exactly as before.
//
// Rendering derives entirely from the current snapshot — there is no second
// copy of "which screen" living in component state, so back/forward can never
// drift out of sync with what's on screen. The heavy *content* each screen
// needs (the loaded book, the import queue, …) still lives in the components;
// only the destination coordinates live here.

import { useSyncExternalStore } from "react";

/** A page inside the Store. No page means the sources list. */
export type StorePage =
  | { kind: "extensions" }
  | { kind: "source"; sourceId: string }
  | { kind: "novel"; sourceId: string; novelUrl: string };

/** The book-status filter (Reading/Finished/Wishlist/All) is deliberately NOT
 *  part of navigation history — flipping a filter pill is not a "back" step
 *  (see the design note in Library). It stays ephemeral in the Library. */
export type LibraryView =
  | { kind: "shelf" }
  | { kind: "store"; page?: StorePage }
  | { kind: "shelves" }
  | { kind: "shelfDetail"; shelfId: string }
  | {
      kind: "novel";
      sourceId: string;
      novelUrl: string;
      /** Present when the detail view is opened from a library card (vs. from
       *  the Store before the novel is in the library). */
      libraryEntryId?: string;
    };

/** Full-screen destination shown by App's top-level view swap. */
export type BaseLocation =
  | { screen: "library"; view: LibraryView }
  | { screen: "reader"; bookId: string }
  | { screen: "settings" };

/** A layer rendered on top of the base without replacing it. */
export type Overlay =
  | { kind: "stream"; sourceId: string; novelUrl: string; chapterId?: number }
  | { kind: "downloads" };

export interface NavSnapshot {
  base: BaseLocation;
  overlay: Overlay | null;
}

export interface NavState {
  snapshot: NavSnapshot;
}

const ROOT: NavSnapshot = {
  base: { screen: "library", view: { kind: "shelf" } },
  overlay: null,
};

// `index` is our position in the history stack; `maxIndex` is the furthest
// forward entry that still exists, so forward() can tell when there is
// nothing ahead. The History API tracks the stack itself but doesn't expose
// that, so we mirror just enough (two integers, stamped into each entry's
// state) to answer it.
let snapshot: NavSnapshot = ROOT;
let index = 0;
let maxIndex = 0;
// The snapshots of the entries we know, by index. Used only to spot a move
// back onto the entry directly behind (A→B→A), which becomes a back step
// rather than a third entry. After a full reload only the current entry is
// known, so the rule simply finds nothing behind and pushes as before.
let entries: NavSnapshot[] = [];
let state: NavState = compute();
const listeners = new Set<() => void>();

interface StampedState {
  navIndex: number;
  snapshot: NavSnapshot;
}

function isStamped(s: unknown): s is StampedState {
  return (
    typeof s === "object" && s !== null && "navIndex" in s && "snapshot" in s
  );
}

function compute(): NavState {
  return { snapshot };
}

function commit(): void {
  state = compute();
  for (const l of listeners) l();
}

let initialized = false;

function init(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const existing = window.history.state;
  if (isStamped(existing)) {
    // A full reload (e.g. Vite dev refresh) landed us back on an entry we
    // already stamped — trust it rather than clobbering the user's position.
    index = existing.navIndex;
    maxIndex = Math.max(maxIndex, index);
    snapshot = existing.snapshot;
    entries = [];
    entries[index] = snapshot;
  } else {
    // Fresh launch: stamp the current (root) entry as index 0 so a later
    // popstate back to it is recognized instead of read as "unknown".
    window.history.replaceState({ navIndex: 0, snapshot: ROOT }, "");
    index = 0;
    maxIndex = 0;
    snapshot = ROOT;
    entries = [ROOT];
  }
  window.addEventListener("popstate", onPopState);
  commit();
}

function onPopState(e: PopStateEvent): void {
  const s = e.state;
  if (isStamped(s)) {
    index = s.navIndex;
    snapshot = s.snapshot;
  } else {
    // Popped past our stamped entries (shouldn't normally happen since the
    // root is stamped) — fall back to the root shelf rather than a blank.
    index = 0;
    snapshot = ROOT;
  }
  // maxIndex is left untouched: forward entries still exist above us.
  entries[index] = snapshot;
  commit();
}

function snapshotsEqual(a: NavSnapshot, b: NavSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Navigate to a new destination. Pushes a history entry (so it becomes a
 *  back step) unless `replace` is set, in which case it swaps the current
 *  entry in place — used for redirects that shouldn't be independently
 *  back-navigable. A no-op when the target equals the current snapshot. */
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

export function forward(): void {
  init();
  if (index < maxIndex) window.history.forward();
}

// --- Convenience navigators (keep call-sites in App/Library declarative) ---

/** Go to a full-screen base destination, clearing any overlay. */
export function goBase(base: BaseLocation, opts?: { replace?: boolean }): void {
  navigate({ base, overlay: null }, opts);
}

export function goLibrary(
  view: LibraryView,
  opts?: { replace?: boolean },
): void {
  goBase({ screen: "library", view }, opts);
}

export function goShelf(shelfId: string, opts?: { replace?: boolean }): void {
  goLibrary({ kind: "shelfDetail", shelfId }, opts);
}

/** Go to the Store, optionally at one of its pages. */
export function goStorePage(page?: StorePage): void {
  goLibrary(page ? { kind: "store", page } : { kind: "store" });
}

export function goReader(bookId: string, opts?: { replace?: boolean }): void {
  goBase({ screen: "reader", bookId }, opts);
}

export function goSettings(): void {
  goBase({ screen: "settings" });
}

/** Open an overlay on top of the *current* base (so, e.g., the Library stays
 *  mounted under the streaming reader). */
export function openOverlay(overlay: Overlay): void {
  init();
  navigate({ base: snapshot.base, overlay });
}

export function subscribe(fn: () => void): () => void {
  init();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getState(): NavState {
  return state;
}

export function useNav(): NavState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// Initialize at module load so `getState()` is correct before the first
// render (useSyncExternalStore reads the snapshot before it subscribes).
init();
