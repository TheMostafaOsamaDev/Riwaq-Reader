// Shared state for the full-window drop/received overlay (DropOverlay.tsx).
//
// Written by useFileDrop (desktop drag-and-drop). A module-scoped store
// rather than that hook's own state so the overlay, mounted at the app root,
// can render it. Files arriving through "Open with" or the Android share sheet
// don't come through here: the background importer's toast acknowledges
// those (components/BackgroundImportToast.tsx).

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

/** Show the "received" confirmation for a drop, and auto-idle after
 *  RECEIVED_MS. */
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
