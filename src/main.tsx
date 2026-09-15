import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { markBoot } from "./lib/diagnostics/breadcrumbs";
import { migrateLegacyRoot } from "./store/legacyRoot";

// The app-data root is migrated BEFORE the tree mounts, not lazily from inside
// the store modules.
//
// Every store function runs from a React effect or an event handler, so nothing
// can touch app-data before render() — which makes this the one place that is
// genuinely ordered ahead of all of them. Doing it per-call-site instead is not
// safe: a read that runs before the move sees an empty root and can persist
// that emptiness on top of the data the move then puts in place. That is a real
// bug this had — `listShelves()` probed `exists(shelves.json)`, seeded the two
// default shelves because the file "didn't exist" yet, and its write (which did
// trigger the migration) then overwrote the freshly-migrated real shelves.
//
// `migrateLegacyRoot()` is memoized, so every one of those call sites shares
// this single promise — which is why the migration is STARTED here but not
// WAITED ON before mounting.
//
// It used to gate the mount (`.finally(() => render())`). The reasoning was
// that the call "never rejects", which is true and beside the point: never
// rejecting is not the same as always settling. Its first act is `exists()`
// over Tauri's IPC, and on Android that bridge can stall at cold start — while
// it does, the user sees the boot background and nothing else. No spinner, no
// timeout, no fallback, for as long as the stall lasts. That is the Android
// blank-launch bug; reproduced on the emulator sitting blank past 70s having
// made three IPC calls and created no app-data directory at all.
//
// Mounting immediately is safe because the ordering guarantee does not live
// here. It lives at each store entry point, which awaits this same memoized
// promise before its first read — library.ts (via ensureRoot, 9 call sites),
// downloadQueue.ts, sourceLibrary.ts, shelves.ts. The gate was redundant with
// the thing that actually enforces correctness, and cost first paint.

// Breadcrumb 2 of 4: the bundle parsed and is executing. Synchronous and
// localStorage-backed on purpose — see lib/diagnostics/breadcrumbs.ts.
markBoot("module");

// Started AFTER the page-load event, not during module evaluation, because
// starting it here used to deadlock the app on Android — the blank launch.
//
// migrateLegacyRoot()'s first act is an fs-plugin call. The FIRST fs call in a
// process makes Tauri resolve the plugin's scope ("$APPDATA/**"), and resolving
// it needs app_data_dir(), which on Android is a JNI round trip serviced by the
// Android main thread. Tauri takes the PluginStore lock for the whole of that.
//
// Meanwhile the main thread, on page load, runs wry's onPageLoaded ->
// prepare_pending_webview, which wants that same PluginStore lock.
//
// So if an fs call is still resolving the scope when onPageFinished dispatches:
//
//   JavaBridge : holds PluginStore lock -> blocked in recv(), waiting on the
//                main thread to answer its JNI call
//   main thread: blocked on Mutex<PluginStore>::lock, so it never answers
//
// Neither side can move. The webview never finishes loading, React's scheduled
// initial render never runs, and the launch stays on the boot background
// forever. Confirmed from a native stack dump of a wedged process, and
// measured: 6/20 clean installs blanked with this call at module scope, 0/20
// with it deferred to `load`.
//
// Deferring costs nothing. Every store entry point already awaits this same
// memoized promise before its first read, so ordering is unchanged — only the
// start moves past the window where it can collide with page load.
function startLegacyRootMigration(): void {
  // A macrotask after `load` — `load` alone still overlaps the native
  // onPageFinished dispatch on some launches.
  setTimeout(() => void migrateLegacyRoot(), 0);
}

if (document.readyState === "complete") {
  startLegacyRootMigration();
} else {
  window.addEventListener("load", startLegacyRootMigration, { once: true });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Breadcrumb 3 of 4: React has been handed the tree. If the next launch
// finds this mark present and `mounted` absent, the tree was handed over
// and no frame ever reached the screen — which is the blank launch.
markBoot("render");
