// React's side of the source registry.
//
// registry.ts's accessors are synchronous by contract — `getSource(id)`,
// `getSourceMeta(id)`, `listSources()` all answer from a Map that is empty
// until a load has committed. That is fine for the Store, which gates its
// own render on its own `initExtensions()` call, and wrong for everybody
// else: a component that read an accessor during a render before the first
// load has nothing that tells it to look again.
//
// So there are two things here, and they are deliberately separate:
//
//   useExtensionsRevision()  — re-render when the registry commits. Reads,
//                              never triggers.
//   useLoadedExtensions()    — the same, plus "make sure something has
//                              loaded it", for consumers the user reached
//                              by navigating.
//
// WHERE THESE MAY BE CALLED FROM is load-bearing, not stylistic. See the
// header comment at components/Store.tsx: starting extension loading inside
// the app's page-load window reproduced this codebase's Android
// lock-ordering deadlock three separate times, and the Store's placement is
// safe because the Store is only ever reached by user navigation, long
// after that window has closed. Every consumer of useLoadedExtensions()
// inherits exactly that argument — a novel page, the streaming reader, the
// search overlay. None of them may be swapped for App startup or the
// Library's own mount.

import { useEffect, useSyncExternalStore } from "react";
import { deferPastPageLoad } from "../lib/deferPastPageLoad";
import {
  ensureExtensions,
  extensionsRevision,
  subscribeExtensions,
} from "./registry";

/** Re-render this component whenever the registry commits a new table.
 *
 *  The returned number is not meant to be displayed; it is a value to put
 *  in a `useMemo` dependency list beside the id, so a cached `getSource` /
 *  `getSourceMeta` answer is recomputed when the registry finally has one.
 *  A number rather than a boolean because an install or uninstall must move
 *  it too, not only the first load. */
export function useExtensionsRevision(): number {
  return useSyncExternalStore(
    subscribeExtensions,
    extensionsRevision,
    extensionsRevision,
  );
}

/** `useExtensionsRevision()`, and load the registry if nothing has yet.
 *
 *  Call this from views the user NAVIGATED to — read the header above
 *  before adding a call site. */
export function useLoadedExtensions(): number {
  const revision = useExtensionsRevision();
  useEffect(() => {
    // ensureExtensions() is memoised and never rejects, so overlapping
    // mounts share one load and this needs no cleanup or `.catch`.
    void ensureExtensions();
  }, []);
  return revision;
}

/** Whether the one-shot gesture listener below has already been armed.
 *  Module-level: one listener for the whole app, however many cards ask. */
let armed = false;

/** Load the registry on the first real user interaction with the app.
 *
 *  This exists for exactly one caller — the source badge on a library card
 *  (components/library/cardChrome.tsx). The library grid is on screen from
 *  the moment the app paints, so unlike the Store or a novel page it cannot
 *  ask for the registry from its own mount: that would put extensions' first
 *  filesystem call back inside the page-load window the header above is
 *  about.
 *
 *  A user gesture is the same structural argument the Store rests on, just
 *  earlier in the session: the webview has painted and the user has touched
 *  it, so the native onPageLoaded dispatch that the deadlock races is done.
 *  The load is still handed to deferPastPageLoad as well, so even on a
 *  webview that delivers a touch to JS before `load` fires, the fs call
 *  lands after `load` plus a macrotask — the same timing main.tsx uses for
 *  the app-data migration.
 *
 *  Nothing arms this when the library holds no source-backed books, because
 *  then no card renders a badge and nobody calls it. */
export function loadExtensionsOnFirstGesture(): void {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const opts = { capture: true, passive: true } as const;
  const go = () => {
    window.removeEventListener("pointerdown", go, opts);
    window.removeEventListener("keydown", go, opts);
    deferPastPageLoad(() => void ensureExtensions());
  };
  window.addEventListener("pointerdown", go, opts);
  window.addEventListener("keydown", go, opts);
}
