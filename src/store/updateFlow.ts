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
