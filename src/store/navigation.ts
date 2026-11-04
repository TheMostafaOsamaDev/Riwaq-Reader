// App-wide navigation history, backed by the browser History API.
//
// Why the History API and not a hand-rolled stack: the platform already
// maintains a back/forward stack and wires the Android hardware back button
// to it for free. We push one history entry per "major destination" and
// listen for `popstate`, so a single listener drives back AND forward for
// every trigger. The desktop triggers (Alt+←/→, ⌘[ / ⌘], mouse side
// buttons) are routed in by navInput.ts, which calls back()/forward().
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
  // The phone's Downloads tab: a page of the home shell, with the bottom bar.
  // The desktop shows downloads as an overlay ({ kind: "downloads" } below).
  | { kind: "downloads" }
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
  // `category` is the phone's drill-down into one settings section: in
  // history, so the back gesture steps from a section to the list rather
  // than out of Settings. The desktop shows every section at once and never
  // sets it.
  | { screen: "settings"; category?: string };

/** A layer rendered on top of the base without replacing it. */
export type Overlay =
  | { kind: "stream"; sourceId: string; novelUrl: string; chapterId?: number }
  | { kind: "downloads" }
  // The phone library's search. In history so the system back gesture
  // closes it, as it does every other layer.
  | { kind: "search" };

export interface NavSnapshot {
  base: BaseLocation;
  overlay: Overlay | null;
}

export interface NavState {
  snapshot: NavSnapshot;
  /** How the last change happened: a new entry (forward, or a forward
   *  gesture), a step back, or an in-place replace. Lets a page transition
   *  slide the right way — deeper in from the side, back out again. */
  move: NavMove;
  /** Bumped on every navigation. A view whose identity changes while this
   *  stays put changed WITHOUT navigating (a library filter, a deleted
   *  shelf) — no direction to slide in, so MobilePageSwap fades it. */
  seq: number;
}

export type NavMove = "push" | "pop" | "replace" | "none";

const ROOT: NavSnapshot = {
  base: { screen: "library", view: { kind: "shelf" } },
  overlay: null,
};

// `index` is our position in the history stack, stamped into each entry's
// state so a popstate tells us where we landed. `entries` mirrors the
// snapshots of the entries we know, by index: forward() checks it for
// anything ahead (the History API doesn't say), and navigate() checks the
// entry directly behind to turn A→B→A into a back step rather than a third
// entry. After a full reload only the current entry is known, so the
// collapse finds nothing behind and pushes as before.
let snapshot: NavSnapshot = ROOT;
let index = 0;
let entries: NavSnapshot[] = [];
let move: NavMove = "none";
let seq = 0;
let state: NavState = compute();
const listeners = new Set<() => void>();

// Layers: history entries pushed by a bottom sheet (pushLayer) so the system
// Back closes the sheet instead of leaving the screen under it. A layer entry
// carries the same snapshot as the screen it sits on, so popping one changes
// nothing about the destination: no commit, no page transition.
//
// Keyed by the entry's navIndex. `onBack` is null for a DEAD layer: one whose
// sheet closed while another layer sat above it, so its entry could not be
// popped yet. A dead entry is skipped (popped again) whenever history lands
// on it, so the user never spends a Back press on a sheet that is gone.
interface LayerRecord {
  /** Which pushLayer call owns the record, so a stale `release` cannot drop
   *  a newer layer that reused the same entry. */
  id: number;
  onBack: (() => void) | null;
}
const layers = new Map<number, LayerRecord>();
let layerSeq = 0;
// history.back() calls we made ourselves to drop a closed sheet's entry. Their
// popstate is swallowed. Until it arrives (a task later in a real WebView) any
// navigation or new layer waits in `deferred`: pushing first would let the
// queued traversal pop the NEW entry instead of the old one.
let pendingSelfPops = 0;
const deferred: Array<() => void> = [];

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
  return { snapshot, move, seq };
}

function commit(): void {
  seq += 1;
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
    snapshot = existing.snapshot;
    entries = [];
    entries[index] = snapshot;
  } else {
    // Fresh launch: stamp the current (root) entry as index 0 so a later
    // popstate back to it is recognized instead of read as "unknown".
    window.history.replaceState({ navIndex: 0, snapshot: ROOT }, "");
    index = 0;
    snapshot = ROOT;
    entries = [ROOT];
  }
  window.addEventListener("popstate", onPopState);
  commit();
}

function selfPop(): void {
  pendingSelfPops += 1;
  window.history.back();
}

function flushDeferred(): void {
  // One at a time: an action may itself start a self-pop, and everything
  // after it must then wait for that one too.
  while (pendingSelfPops === 0 && deferred.length > 0) {
    const next = deferred.shift();
    next?.();
  }
}

/** Forget every layer above `at`, top first, returning the live ones'
 *  onBack callbacks in that order. */
function dropLayersAbove(at: number): Array<() => void> {
  const closers: Array<() => void> = [];
  const above = [...layers.keys()].filter((k) => k > at).sort((a, b) => b - a);
  for (const k of above) {
    const rec = layers.get(k);
    layers.delete(k);
    if (rec?.onBack) closers.push(rec.onBack);
  }
  return closers;
}

/** If history now sits on a dead layer's entry, pop past it. */
function skipDeadLayer(): boolean {
  const rec = layers.get(index);
  if (!rec || rec.onBack !== null) return false;
  layers.delete(index);
  selfPop();
  return true;
}

function onPopState(e: PopStateEvent): void {
  const s = e.state;
  if (pendingSelfPops > 0) {
    // Our own release() dropping a closed sheet's entry. The screen under it
    // is unchanged, so this is not a navigation.
    pendingSelfPops -= 1;
    index = isStamped(s) ? s.navIndex : 0;
    entries.length = index + 1;
    dropLayersAbove(index);
    if (skipDeadLayer()) return;
    flushDeferred();
    return;
  }
  const landing = isStamped(s) ? s.navIndex : 0;
  const closers = dropLayersAbove(landing);
  if (
    closers.length > 0 &&
    isStamped(s) &&
    snapshotsEqual(s.snapshot, snapshot)
  ) {
    // Back closed the sheet(s) on this screen. Truncate so Forward never
    // re-enters a sheet that is gone.
    index = landing;
    entries.length = index + 1;
    for (const close of closers) close();
    skipDeadLayer();
    return;
  }
  if (isStamped(s)) {
    move = s.navIndex < index ? "pop" : "push";
    index = s.navIndex;
    snapshot = s.snapshot;
  } else {
    // Popped past our stamped entries (shouldn't normally happen since the
    // root is stamped) — fall back to the root shelf rather than a blank.
    move = "pop";
    index = 0;
    snapshot = ROOT;
  }
  // Entries above us are untouched: forward still reaches them.
  entries[index] = snapshot;
  commit();
  for (const close of closers) close();
  skipDeadLayer();
}

function snapshotsEqual(a: NavSnapshot, b: NavSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Navigate to a new destination. Pushes a history entry (so it becomes a
 *  back step) unless `replace` is set, in which case it swaps the current
 *  entry in place — used for redirects that shouldn't be independently
 *  back-navigable. A no-op when the target equals the current snapshot.
 *
 *  Going to the entry directly behind is a back step, which settles when
 *  `popstate` arrives (asynchronously in a real webview): until then the
 *  store still reports the entry being left. */
export function navigate(
  next: NavSnapshot,
  opts?: { replace?: boolean },
): void {
  init();
  if (pendingSelfPops > 0) {
    deferred.push(() => navigate(next, opts));
    return;
  }
  if (!opts?.replace && snapshotsEqual(next, snapshot)) return;
  const top = layers.get(index);
  if (top) {
    // A sheet's entry is on top. Take it over for the destination rather than
    // stacking on it: "Open full settings" closes the reader's settings sheet
    // and navigates in one handler, before the sheet's own close could pop
    // its entry, and that pop would otherwise undo the navigation. No A→B→A
    // collapse here either: stepping back would only pop the sheet. The sheet
    // is told to close (a no-op when it already is), so it can never sit open
    // without a Back step of its own.
    layers.delete(index);
    window.history.replaceState({ navIndex: index, snapshot: next }, "");
    snapshot = next;
    entries.length = index + 1;
    entries[index] = next;
    move = opts?.replace ? "replace" : "push";
    commit();
    top.onBack?.();
    return;
  }
  if (opts?.replace) {
    window.history.replaceState({ navIndex: index, snapshot: next }, "");
    snapshot = next;
    entries[index] = next;
    move = "replace";
  } else {
    const behind = entries[index - 1];
    if (behind && snapshotsEqual(next, behind)) {
      // Going to where we just came from: step back instead, so the forward
      // entry survives and the stack doesn't grow A→B→A→B…
      back();
      return;
    }
    index += 1;
    entries.length = index; // a new entry truncates any forward history
    entries[index] = next;
    window.history.pushState({ navIndex: index, snapshot: next }, "");
    snapshot = next;
    move = "push";
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
  if (pendingSelfPops > 0) {
    deferred.push(back);
    return;
  }
  if (index > 0) window.history.back();
  else if (!snapshotsEqual(snapshot, ROOT)) navigate(ROOT, { replace: true });
}

export function forward(): void {
  init();
  if (pendingSelfPops > 0) {
    deferred.push(forward);
    return;
  }
  if (index < entries.length - 1) window.history.forward();
}

/** Give a bottom sheet a history entry of its own, so the system Back (and
 *  back() from a mouse side button or Alt+←) closes it rather than leaving the
 *  screen under it. Call when the sheet opens; `onBack` runs when Back pops
 *  the entry, and when a navigation takes the entry over (the sheet must
 *  close then; for a sheet already closing it is a no-op). Returns `release`,
 *  to call when the sheet closes any other way: it drops the entry without
 *  calling `onBack` and without navigating, and is safe to call twice or after
 *  the entry is already gone. Most callers want `useBackLayer`. */
export function pushLayer(onBack: () => void): () => void {
  init();
  layerSeq += 1;
  const id = layerSeq;
  let at = -1;
  let placed = false;
  let released = false;
  const place = () => {
    if (released) return;
    placed = true;
    const here = layers.get(index);
    if (here && here.onBack === null) {
      // A dead layer's entry is on top: reuse it rather than stacking.
      window.history.replaceState({ navIndex: index, snapshot }, "");
    } else {
      index += 1;
      entries.length = index;
      entries[index] = snapshot;
      window.history.pushState({ navIndex: index, snapshot }, "");
    }
    layers.set(index, { id, onBack });
    at = index;
  };
  if (pendingSelfPops > 0) deferred.push(place);
  else place();
  return () => {
    if (released) return;
    released = true;
    if (!placed) return;
    const rec = layers.get(at);
    // Gone already: popped by Back, or taken over by a navigation.
    if (!rec || rec.id !== id) return;
    if (at === index) {
      layers.delete(at);
      selfPop();
    } else {
      // Another sheet sits above this one; its entry can't be popped yet.
      rec.onBack = null;
    }
  };
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
  goLibrary({ kind: "store", page });
}

export function goReader(bookId: string, opts?: { replace?: boolean }): void {
  goBase({ screen: "reader", bookId }, opts);
}

export function goSettings(): void {
  goBase({ screen: "settings" });
}

/** Open one settings section (the phone's drill-down), as a history entry. */
export function goSettingsCategory(category: string): void {
  goBase({ screen: "settings", category });
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
