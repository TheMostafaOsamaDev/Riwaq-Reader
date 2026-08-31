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

async function drainOnce(): Promise<void> {
  try {
    const desktop = (await invoke("take_pending_opens")) as string[] | null;
    if (desktop && desktop.length > 0) pushIncoming(desktop);
  } catch {
    // Command unavailable or transient — the next trigger retries.
  }
  try {
    const uri = (await invoke("consume_open_uri")) as string | null;
    if (uri) pushIncoming([uri]);
  } catch {
    // Non-Android or transient — silent, same as useLaunchIntent.
  }
}

export function useIncomingFiles(): void {
  useEffect(() => {
    void drainOnce();

    let unlisten: (() => void) | undefined;
    void listen("app://opened", () => {
      void drainOnce();
    }).then((fn) => {
      unlisten = fn;
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") void drainOnce();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      unlisten?.();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
