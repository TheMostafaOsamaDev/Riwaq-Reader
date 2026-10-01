// Pure decisions for the Android update flow. No React, no IPC — every rule
// here is a function of plain inputs, so each one is tested on its own.

export type AndroidChannel =
  | { kind: "in-app" }
  | {
      kind: "store-assisted";
      store: "orion" | "obtainium";
      pkg: string;
      label: string;
    }
  | { kind: "managed"; pkg: string; label: string }
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
  return { kind: "managed", pkg: src.installer, label: src.label };
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
