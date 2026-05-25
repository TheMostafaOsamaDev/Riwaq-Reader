// React hook that wires Android's launch-intent extras to the
// in-app UI. On mount, drains any pending intent stashed by
// MainActivity (cold launch). For warm launches (singleTask
// re-delivery), the native side sets the static field and we poll
// once per visibility-change — a Tauri event would be cleaner but
// requires emitting from Kotlin, which is more code.
//
// Today the only intent we handle is `leaflet.open=queue` →
// openDownloadQueue() via uiIntents.

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openDownloadQueue } from "../store/uiIntents";

async function drainOnce(): Promise<void> {
  try {
    const value = (await invoke("consume_launch_intent")) as string | null;
    if (value === "queue") openDownloadQueue();
  } catch {
    // Non-Android or transient — silent.
  }
}

export function useLaunchIntent(): void {
  useEffect(() => {
    // Cold launch: drain whatever was stashed when the activity was
    // first created.
    void drainOnce();

    // Warm launch: when the activity comes back to the foreground
    // (singleTask re-delivery on Android), the static field gets a
    // fresh value. Re-drain on visibility change.
    const onVisible = () => {
      if (document.visibilityState === "visible") void drainOnce();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
