// Shared state for the full-window drop/received overlay (DropOverlay.tsx).
//
// Two producers write here: useFileDrop (desktop drag-and-drop) and
// useIncomingFiles (a book arriving via "Open with" or the Android share
// sheet). Before this store existed, the overlay's state lived as local
// React state inside useFileDrop, so only a drag-and-drop could ever show
// it — a book arriving through Open-with or a share while the reader or
// settings was on screen (the most common Android path) produced no
// feedback at all: Library owns the only import toast, and it's unmounted
// behind those screens. Mirrors the store/incomingFiles.ts idiom: a
// module-scoped place two unrelated call sites can both push into.

import { useSyncExternalStore } from "react";

export type DropState =
  | { kind: "idle" }
  | { kind: "accept"; count: number }
  | { kind: "refuse" }
  | { kind: "received"; count: number; skipped: number };

/** How long the post-drop/post-drain confirmation stays up. Long enough to
 *  read, short enough not to sit over the reader. */
const RECEIVED_MS = 1400;

let state: DropState = { kind: "idle" };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  for (const l of listeners) l();
}

/** Every transition clears whatever auto-idle timer is pending first — a
 *  stale timer from a prior "received" must not fire mid-way through a
 *  fresh drag and force the overlay back to idle out from under it. */
function clearTimer() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
}

export function setIdle(): void {
  clearTimer();
  state = { kind: "idle" };
  emit();
}

export function setAccept(count: number): void {
  clearTimer();
  state = { kind: "accept", count };
  emit();
}

export function setRefuse(): void {
  clearTimer();
  state = { kind: "refuse" };
  emit();
}

/** Show the "received" confirmation and auto-idle after RECEIVED_MS. Used
 *  by both a desktop drop (useFileDrop) and a file arriving from outside
 *  while the app is already running (useIncomingFiles) — the one acked by
 *  its own drag gesture, the other by nothing else, which is the point. */
export function showReceived(count: number, skipped = 0): void {
  clearTimer();
  state = { kind: "received", count, skipped };
  emit();
  timer = setTimeout(() => setIdle(), RECEIVED_MS);
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): DropState {
  return state;
}

export function useDropOverlayState(): DropState {
  return useSyncExternalStore(subscribe, getState, getState);
}
