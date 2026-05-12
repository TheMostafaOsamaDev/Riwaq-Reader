// Module-scoped store for the image lightbox.
//
// The lightbox itself is a global overlay mounted at the App root, but it
// can be triggered from anywhere inside the reader (BookBody, the
// streaming reader, future panels). Plumbing a callback through every
// intermediate component would be invasive, so this store mirrors the
// pattern importProgress already uses — an imperative `open(src)` /
// `close()` API + a React hook for the consumer.

import { useSyncExternalStore } from "react";

export interface LightboxState {
  src: string | null;
  alt?: string;
}

const initial: LightboxState = { src: null };
let state: LightboxState = initial;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function open(src: string, alt?: string): void {
  state = { src, alt };
  emit();
}

export function close(): void {
  if (state.src === null) return;
  state = { src: null };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): LightboxState {
  return state;
}

export function useLightbox(): LightboxState {
  return useSyncExternalStore(subscribe, getState, getState);
}
