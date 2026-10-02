// Pure decisions for the Android update flow. No React, no IPC — every rule
// here is a function of plain inputs, so each one is tested on its own.

import { isNewerVersion } from "./updateVersion";

export type AndroidChannel =
  | { kind: "in-app" }
  | {
      kind: "store-assisted";
      store: "orion" | "obtainium";
      pkg: string;
      label: string;
    }
  | { kind: "managed"; pkg: string; label: string; storeInstalled: boolean }
  | { kind: "manual" };

export interface InstallSource {
  installer: string;
  label: string;
  storeInstalled: boolean;
}

/** Installers that mean "nobody manages this install": the system package
 *  installer (a tapped APK), adb — and Shizuku, which Orion and Obtainium can
 *  use and which records com.android.shell — and Riwaq itself after one
 *  in-app update. Misfiling a store install here is harmless: the store
 *  ships the same signed APK, and whichever installs first wins. */
const SIDELOAD = new Set([
  "",
  "com.google.android.packageinstaller",
  "com.android.packageinstaller",
  "com.android.shell",
  "com.riwaq.reader",
]);
/** A Map, not an object literal: an installer string is outside input, and an
 *  object lookup would find "constructor" or "toString" on its prototype. */
const ASSISTED = new Map<string, "orion" | "obtainium">([
  ["com.orion.store", "orion"],
  ["dev.imranr.obtainium", "obtainium"],
  ["dev.imranr.obtainium.fdroid", "obtainium"],
]);

export function androidChannel(src: InstallSource | null): AndroidChannel {
  if (!src) return { kind: "manual" };
  if (SIDELOAD.has(src.installer)) return { kind: "in-app" };
  const store = ASSISTED.get(src.installer);
  if (store) {
    return src.storeInstalled
      ? { kind: "store-assisted", store, pkg: src.installer, label: src.label }
      : { kind: "in-app" };
  }
  return {
    kind: "managed",
    pkg: src.installer,
    label: src.label,
    storeInstalled: src.storeInstalled,
  };
}

const STATES = [
  "idle",
  "waiting",
  "downloading",
  "verifying",
  "ready",
  "installing",
  "failed",
] as const;
export type NativeState = (typeof STATES)[number];
export interface NativeStatus {
  state: NativeState;
  version?: string;
  bytes: number;
  total: number;
  error: string | null;
}

/** AppUpdater.status() as JSON. Anything unreadable is "idle": a status poll
 *  must never throw into the UI. */
export function parseNativeStatus(json: string): NativeStatus {
  const idle: NativeStatus = { state: "idle", bytes: 0, total: 0, error: null };
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!o || !STATES.includes(o.state as NativeState)) return idle;
    return {
      state: o.state as NativeState,
      ...(typeof o.version === "string" ? { version: o.version } : {}),
      bytes: typeof o.bytes === "number" ? o.bytes : 0,
      total: typeof o.total === "number" ? o.total : 0,
      error: typeof o.error === "string" ? o.error : null,
    };
  } catch {
    return idle;
  }
}

/** Android's versionCode, as tauri derives it: major*1e6 + minor*1e3 + patch.
 *  AppUpdater.code() in Kotlin is the same formula. */
export function versionCode(v: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? +m[1] * 1_000_000 + +m[2] * 1_000 + +m[3] : -1;
}

/** Whether the APK cached for `cached` is stale. Once the running version is
 *  at or past it — whoever did the update — it goes. AppUpdater.cleanupAsync
 *  in Kotlin mirrors this exactly; this copy is the tested specification. */
export function cleanupDecision(
  running: string,
  cached: string | undefined,
): "keep" | "delete" {
  if (!cached) return "keep";
  return versionCode(running) >= versionCode(cached) ? "delete" : "keep";
}

export type Pill =
  | { kind: "available" }
  | { kind: "progress"; pct: number }
  | { kind: "waiting" }
  | { kind: "ready" }
  | { kind: "failed" }
  | null;

export interface FlowInput {
  offered: string | null;
  running: string;
  native: NativeStatus;
  skipped: string | undefined;
  laterThisSession: boolean;
  channel: AndroidChannel["kind"];
}

/** Everything is keyed on the RUNNING version: if Orion, Obtainium, F-Droid
 *  or adb already put the offered version (or newer) on the device, there is
 *  nothing to show, whatever state our own download was in. */
function pending({ offered, running }: FlowInput): boolean {
  return offered !== null && isNewerVersion(offered, running);
}

export function pillFor(i: FlowInput): Pill {
  if (!pending(i) || i.channel === "managed" || i.channel === "manual") {
    return null;
  }
  // A file for an OLDER offer (0.6.0 ready, 0.6.1 now published) is stale:
  // show the new offer, never an install of the superseded APK. The store's
  // offer() cancels it natively, which deletes the file.
  const stale =
    i.native.version !== undefined && i.native.version !== i.offered;
  switch (stale ? "idle" : i.native.state) {
    case "downloading":
    case "verifying":
      return {
        kind: "progress",
        pct: i.native.total
          ? Math.min(100, Math.floor((i.native.bytes / i.native.total) * 100))
          : 0,
      };
    case "waiting":
      return { kind: "waiting" };
    case "ready":
    case "installing":
      return { kind: "ready" };
    case "failed":
      return { kind: "failed" };
    default:
      if (i.skipped === i.offered || i.laterThisSession) return null;
      return { kind: "available" };
  }
}

export function attentionDot(i: FlowInput): boolean {
  if (!pending(i) || i.channel === "managed" || i.channel === "manual") {
    return false;
  }
  return i.skipped !== i.offered;
}

export type MobilePref = "ask" | "always" | "wifi";

export function decideStart({
  metered,
  pref,
}: {
  metered: boolean;
  pref: MobilePref;
}): "start" | "ask" | "wait" {
  if (!metered || pref === "always") return "start";
  return pref === "wifi" ? "wait" : "ask";
}

/** A skip covers one version only: clear it once the device is at or past
 *  it, or once something newer than it is offered. */
export function clearSkip(
  skipped: string | undefined,
  offered: string | null,
  running: string,
): boolean {
  if (!skipped) return false;
  const s = versionCode(skipped);
  return (
    versionCode(running) >= s || (offered !== null && versionCode(offered) > s)
  );
}
