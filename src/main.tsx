import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles/global.css";
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
void migrateLegacyRoot();

// The boundary wraps App because a throw anywhere outside the two reader views
// used to unmount the whole tree, leaving the boot background and nothing else
// — no chrome, and not even the app-level spinner or error toast, since those
// are App's children too. That is pixel-identical to a book that rendered
// blank, so a screenshot of it says nothing about the cause. See
// components/AppErrorBoundary.tsx.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
