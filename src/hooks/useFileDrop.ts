// Desktop drag-and-drop. Turns Tauri's drag events into the overlay's
// state and hands accepted paths to the incoming-files queue.
//
// Resolution happens in Rust on `enter`, not in JS: a dropped FOLDER is
// indistinguishable from an extension-less file by name alone, and
// expanding one needs a directory read the webview can't do for arbitrary
// paths. Tauri's `over` event carries no paths, so this costs one IPC per
// drag rather than one per mousemove.
//
// The overlay's state itself lives in store/dropOverlay.ts, not here —
// useIncomingFiles also needs to drive it (an Open-with/share arrival gets
// the same "received" confirmation), so this hook only writes into the
// shared store rather than owning its own React state.

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { pushIncoming } from "../store/incomingFiles";
import { setAccept, setIdle, setRefuse, showReceived } from "../store/dropOverlay";

interface DropClassification {
  /** Books the drop resolved to, folder contents already expanded. */
  books: string[];
  /** Dropped paths that yielded nothing importable. */
  unsupported: string[];
}

const EMPTY: DropClassification = { books: [], unsupported: [] };

export function useFileDrop(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;
    // The classification from `enter`, reused on `drop`. Tauri repeats the
    // paths in the drop payload, but re-resolving them there would both
    // re-read every dropped folder and race a file moved mid-drag.
    let latest: DropClassification = EMPTY;

    void getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const p = event.payload;

        if (p.type === "enter") {
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
          if (latest.books.length > 0) setAccept(latest.books.length);
          else setRefuse();
          return;
        }

        if (p.type === "leave") {
          latest = EMPTY;
          setIdle();
          return;
        }

        if (p.type === "drop") {
          const books = latest.books;
          const skipped = latest.unsupported.length;
          latest = EMPTY;
          if (books.length === 0) {
            setIdle();
            return;
          }
          pushIncoming(books);
          // Acknowledge the drop itself. The library's import summary
          // confirms completion later — but it is unreachable while the
          // reader is on screen, which is exactly when this matters.
          showReceived(books.length, skipped);
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
      // Disabling mid-drag (a platform check resolving, in practice —
      // see App.tsx) must not leave the shared overlay stuck showing
      // "accept"/"refuse" forever with nothing left to move it on.
      setIdle();
    };
  }, [enabled]);
}
