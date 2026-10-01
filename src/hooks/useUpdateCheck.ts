import { useCallback, useEffect, useRef, useState } from "react";
import type { Tweaks } from "../types/reader";
import type { ChannelEnv } from "../store/updateChannel";
import { shouldCheck } from "../store/updateThrottle";
import {
  type CheckResult,
  fetchManifestVersion,
  resolveCheck,
} from "../store/updates";

/** Ask the platform what it is.
 *
 *  Everything is dynamically imported so the Android bundle never eagerly
 *  pulls a desktop-only path, and every failure degrades to `{ os: "" }` —
 *  which `resolveChannel` maps to the manual channel. Guessing wrong in that
 *  direction costs a user one extra tap; guessing wrong the other way offers
 *  an install that cannot happen.
 *
 *  Both flags degrade to false, the safe answer for each, though not for the
 *  same reason. A false isAppImage withholds the self-update button. A false
 *  isFlatpak withholds nothing, and that is the point: a wrongly TRUE one
 *  silences every update offer, so a non-Flatpak user would stop hearing about
 *  releases with nothing to show why, whereas a Flatpak user wrongly told
 *  "false" only sees a redundant link. Each probe fails on its own so one
 *  broken command cannot hide the other's answer, and every OS but Linux is
 *  false outright because Flatpak does not exist there.
 */
async function readEnv(): Promise<ChannelEnv> {
  try {
    const { type } = await import("@tauri-apps/plugin-os");
    const os = type() as string;
    if (os !== "linux") return { os, isAppImage: false, isFlatpak: false };
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const probe = (command: string) =>
        invoke<boolean>(command).catch(() => false);
      const [isAppImage, isFlatpak] = await Promise.all([
        probe("is_appimage"),
        probe("is_flatpak"),
      ]);
      return { os, isAppImage, isFlatpak };
    } catch {
      // Can't tell — treat it as a package install and offer the download.
      return { os, isAppImage: false, isFlatpak: false };
    }
  } catch {
    return { os: "", isAppImage: false, isFlatpak: false };
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
  // Null until a check in this session has finished.
  const [result, setResult] = useState<CheckResult | null>(null);
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
        const { invoke } = await import("@tauri-apps/api/core");
        const [manifest, env, current] = await Promise.all([
          fetchManifestVersion(invoke),
          readEnv(),
          import("@tauri-apps/api/app")
            .then((m) => m.getVersion())
            .catch(() => ""),
        ]);
        const r = resolveCheck({ latest: manifest, current, env });
        setResult(r);
        // Stamp whenever GitHub actually answered, update or not: the
        // throttle is about how often we ask. But NOT on a failure — an
        // offline launch should try again next launch, not a day later.
        if (r.kind !== "failed") setTweak("lastUpdateCheck", Date.now());
      } catch {
        setResult({ kind: "failed" });
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
    info: !dismissed && result?.kind === "update" ? result.info : null,
    result,
    checking,
    // A manual check un-dismisses: pressing "Check now" is asking to be told,
    // so an update found by it must show even after an earlier "Later".
    check: useCallback(() => {
      setDismissed(false);
      void run(true);
    }, [run]),
    dismiss: useCallback(() => setDismissed(true), []),
  };
}
