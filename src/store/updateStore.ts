// The plumbing the Android and desktop update stores share: a module store
// read in React with useSyncExternalStore, and the one-version skip with its
// Undo. The two flows differ in everything else, which stays in
// androidUpdate.ts and desktopUpdate.ts.

import { useSyncExternalStore } from "react";
import { clearSkip } from "./updateFlow";

export interface Store<S> {
  readonly state: S;
  /** Merge `patch` into a fresh object (useSyncExternalStore compares by
   *  identity) and tell every listener. */
  set(patch: Partial<S>): void;
  subscribe(listener: (s: S) => void): () => void;
  getState(): S;
  /** The whole state: the caller re-renders on every change. */
  use(): S;
  /** One value derived from the state: the caller re-renders only when it
   *  changes (by Object.is), so a status poll or a progress tick does not
   *  re-render a sidebar that only shows a dot. `select` must return a
   *  primitive or a reference the state already holds. */
  useSelect<T>(select: (s: S) => T): T;
  /** Test-only: drop the listeners and start from `initial()` again. */
  reset(): void;
}

export function createStore<S>(initial: () => S): Store<S> {
  let state = initial();
  const listeners = new Set<(s: S) => void>();
  const getState = () => state;
  const subscribe = (listener: (s: S) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    get state() {
      return state;
    },
    set(patch) {
      state = { ...state, ...patch };
      for (const l of listeners) l(state);
    },
    subscribe,
    getState,
    use: () => useSyncExternalStore(subscribe, getState, getState),
    useSelect: (select) => {
      const read = () => select(state);
      return useSyncExternalStore(subscribe, read, read);
    },
    reset() {
      listeners.clear();
      state = initial();
    },
  };
}

export type UpdateToast = "later" | "skipped" | null;

/** The fields of a store state that the skip and its toast use. */
export interface SkipFields {
  offer: { version: string } | null;
  running: string;
  skipped: string | undefined;
  toast: UpdateToast;
  /** Bumped by every toast shown, so the same toast twice in a row is a new
   *  toast (its timer restarts) rather than no change at all. */
  toastSeq: number;
}

/** The toast fields for showing `kind` now. */
export function showToast(
  s: SkipFields,
  kind: Exclude<UpdateToast, null>,
): Pick<SkipFields, "toast" | "toastSeq"> {
  return { toast: kind, toastSeq: s.toastSeq + 1 };
}

/** "Skip this version", its Undo, and the rule that a skip covers one
 *  version only. `save` persists the tweak (`skippedUpdateVersion`). */
export function createSkip<S extends SkipFields>(store: Store<S>) {
  let save: (v: string | undefined) => void = () => {};
  /** The skip that "Undo" puts back (usually undefined). */
  let beforeUndo: string | undefined;
  return {
    setSave(fn: (v: string | undefined) => void) {
      save = fn;
    },
    /** Drop the skip once something newer is offered or the device is
     *  already at or past it. */
    reconcile() {
      const s = store.state;
      if (!s.running) return;
      if (clearSkip(s.skipped, s.offer?.version ?? null, s.running)) {
        store.set({ skipped: undefined } as Partial<S>);
        save(undefined);
      }
    },
    /** Skip `version`, toast it, and apply `patch` (closing the sheet or
     *  dialog) in the same update. */
    skip(version: string, patch: Partial<S>) {
      beforeUndo = store.state.skipped;
      store.set({
        ...patch,
        skipped: version,
        ...showToast(store.state, "skipped"),
      } as Partial<S>);
      save(version);
    },
    undo() {
      const prev = beforeUndo;
      beforeUndo = undefined;
      store.set({ skipped: prev, toast: null } as Partial<S>);
      save(prev);
    },
    reset() {
      save = () => {};
      beforeUndo = undefined;
    },
  };
}
