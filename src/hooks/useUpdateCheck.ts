import { useCallback, useEffect, useRef, useState } from "react";
import type { Tweaks } from "../types/reader";
import { shouldCheck } from "../store/updateThrottle";
import {
  evaluateUpdate,
  fetchManifestVersion,
  type UpdateInfo,
} from "../store/updates";

/** Ask the platform what it is.
 *
 *  Everything is dynamically imported so the Android bundle never eagerly
 *  pulls a desktop-only path, and every failure degrades to `{ os: "" }` —
 *  which `resolveChannel` maps to the manual channel. Guessing wrong in that
 *  direction costs a user one extra tap; guessing wrong the other way offers
 *  an install that cannot happen. */
async function readEnv(): Promise<{ os: string; isAppImage: boolean }> {
  try {
    const { type } = await import("@tauri-apps/plugin-os");
    const os = type() as string;
    if (os !== "linux") return { os, isAppImage: false };
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return { os, isAppImage: await invoke<boolean>("is_appimage") };
    } catch {
      // Can't tell — treat it as a package install and offer the download.
      return { os, isAppImage: false };
    }
  } catch {
    return { os: "", isAppImage: false };
  }
}

/** Check once per session (subject to the 24h throttle), plus on demand.
 *
 *  Deliberately does not block or delay launch: it is fired from an effect
 *  and nothing waits on it. */
export function useUpdateCheck(
  t: Tweaks,
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void,
) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // A ref, not state: the guard has to be set synchronously or a double
  // render starts two fetches before either has re-rendered.
  const inFlight = useRef(false);
  // Read through a ref so `run` does not change identity every time a tweak
  // does — otherwise the launch effect would want to re-fire.
  const latest = useRef(t);
  latest.current = t;

  const run = useCallback(
    async (manual: boolean) => {
      if (inFlight.current) return;
      const tw = latest.current;
      if (
        !shouldCheck({
          enabled: tw.autoCheckUpdates,
          lastCheck: tw.lastUpdateCheck,
          now: Date.now(),
          manual,
        })
      ) {
        return;
      }
      inFlight.current = true;
      setChecking(true);
      try {
        const [manifest, env, current] = await Promise.all([
          fetchManifestVersion(fetch),
          readEnv(),
          import("@tauri-apps/api/app")
            .then((m) => m.getVersion())
            .catch(() => ""),
        ]);
        setInfo(evaluateUpdate({ latest: manifest, current, env }));
        // Stamp even when there was no update: the throttle is about how
        // often we ask, not about how often the answer is yes.
        setTweak("lastUpdateCheck", Date.now());
      } finally {
        inFlight.current = false;
        setChecking(false);
      }
    },
    [setTweak],
  );

  useEffect(() => {
    void run(false);
  }, [run]);

  return {
    info: dismissed ? null : info,
    checking,
    check: useCallback(() => void run(true), [run]),
    dismiss: useCallback(() => setDismissed(true), []),
  };
}
