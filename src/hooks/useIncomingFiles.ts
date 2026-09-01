// Drains files handed to Riwaq from outside — an "Open with" launch, an
// Android share — into the incoming-files queue.
//
// Three triggers for one drain, because no single one covers every case:
// mount catches a cold launch (the paths were queued before any JS ran),
// the app://opened event catches a warm desktop launch, and
// visibilitychange catches Android's warm delivery, where the Kotlin side
// sets a static field rather than emitting. Draining is idempotent, so
// overlapping triggers are harmless.

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { pushIncoming } from "../store/incomingFiles";
import { showReceived } from "../store/dropOverlay";

async function drainOnce(): Promise<void> {
  let received = 0;
  try {
    const desktop = (await invoke("take_pending_opens")) as string[] | null;
    if (desktop && desktop.length > 0) {
      pushIncoming(desktop);
      received += desktop.length;
    }
  } catch {
    // Command unavailable or transient — the next trigger retries.
  }
  try {
    const uri = (await invoke("consume_open_uri")) as string | null;
    if (uri) {
      // CROSS-LANGUAGE CONTRACT with MainActivity.kt's rememberLaunchIntent:
      // a SEND_MULTIPLE share (a multi-select "share to Riwaq") joins every
      // URI into this one field with "\n" — a character that cannot occur
      // inside a content:// URI. A single VIEW/SEND still round-trips
      // unchanged, since splitting a string with no "\n" yields one
      // element.
      const paths = uri.split("\n");
      pushIncoming(paths);
      received += paths.length;
    }
  } catch {
    // Non-Android or transient — silent, same as useLaunchIntent.
  }
  if (received > 0) {
    // Acknowledge the arrival even when nobody is looking at the library.
    // Without this, a book handed to Riwaq via Open-with or the Android
    // share sheet while the reader or settings was on screen was
    // completely silent — Library owns the only import toast, and it's
    // unmounted behind those screens, which is exactly the common case
    // (the app foregrounding from a share while mid-chapter).
    showReceived(received);
  }
}

export function useIncomingFiles(): void {
  useEffect(() => {
    void drainOnce();

    // StrictMode (and a fast unmount in general) can tear this effect down
    // before listen()'s promise resolves. Without the `disposed` flag,
    // `unlisten` would still be undefined when cleanup runs, the `.then`
    // below would write the real unlisten function into an already-
    // detached closure, and that subscription would leak for the app's
    // lifetime. Checking `disposed` in the `.then` unregisters it
    // immediately instead.
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("app://opened", () => {
      void drainOnce();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") void drainOnce();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      unlisten?.();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
