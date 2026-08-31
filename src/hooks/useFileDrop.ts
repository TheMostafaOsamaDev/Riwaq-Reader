// Desktop drag-and-drop. Turns Tauri's drag events into the overlay's
// state and hands accepted paths to the incoming-files queue.
//
// Resolution happens in Rust on `enter`, not in JS: a dropped FOLDER is
// indistinguishable from an extension-less file by name alone, and
// expanding one needs a directory read the webview can't do for arbitrary
// paths. Tauri's `over` event carries no paths, so this costs one IPC per
// drag rather than one per mousemove.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { pushIncoming } from "../store/incomingFiles";

export type DropState =
  | { kind: "idle" }
  | { kind: "accept"; count: number }
  | { kind: "refuse" }
  | { kind: "received"; count: number; skipped: number };

interface DropClassification {
  /** Books the drop resolved to, folder contents already expanded. */
  books: string[];
  /** Dropped paths that yielded nothing importable. */
  unsupported: string[];
}

const EMPTY: DropClassification = { books: [], unsupported: [] };

/** How long the post-drop confirmation stays up. Long enough to read,
 *  short enough not to sit over the reader. */
const RECEIVED_MS = 1400;

export function useFileDrop(enabled: boolean): DropState {
  const [state, setState] = useState<DropState>({ kind: "idle" });

  useEffect(() => {
    if (!enabled) return;

    let unlisten: (() => void) | undefined;
    let timer: number | undefined;
    let disposed = false;
    // The classification from `enter`, reused on `drop`. Tauri repeats the
    // paths in the drop payload, but re-resolving them there would both
    // re-read every dropped folder and race a file moved mid-drag.
    let latest: DropClassification = EMPTY;

    // A `received` confirmation schedules its own idle-out below. That
    // timeout must not survive into whatever the drag surface does next —
    // otherwise a stale timer from a prior drop fires mid-way through a
    // fresh drag and forces the overlay back to idle out from under it.
    // Every branch that moves the state on clears whatever timer is
    // currently pending first.
    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    void getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const p = event.payload;

        if (p.type === "enter") {
          clearTimer();
          try {
            latest = await invoke<DropClassification>("classify_drop", {
              paths: p.paths,
            });
          } catch {
            // Resolution failed — refuse rather than promise an import we
            // can't describe.
            latest = EMPTY;
          }
          if (disposed) return;
          setState(
            latest.books.length > 0
              ? { kind: "accept", count: latest.books.length }
              : { kind: "refuse" },
          );
          return;
        }

        if (p.type === "leave") {
          clearTimer();
          latest = EMPTY;
          setState({ kind: "idle" });
          return;
        }

        if (p.type === "drop") {
          clearTimer();
          const books = latest.books;
          const skipped = latest.unsupported.length;
          latest = EMPTY;
          if (books.length === 0) {
            setState({ kind: "idle" });
            return;
          }
          pushIncoming(books);
          // Acknowledge the drop itself. The library's import summary
          // confirms completion later — but it is unreachable while the
          // reader is on screen, which is exactly when this matters.
          setState({ kind: "received", count: books.length, skipped });
          timer = window.setTimeout(
            () => setState({ kind: "idle" }),
            RECEIVED_MS,
          );
        }
      })
      .then((fn) => {
        // Unmounted before the listener resolved — tear it down now, or it
        // outlives the component.
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      unlisten?.();
      clearTimer();
    };
  }, [enabled]);

  return state;
}
