// The mechanism behind main.tsx's app-data-migration deferral — see the
// large comment above the `deferPastPageLoad(...)` call in main.tsx for the
// full story of the Android lock-ordering deadlock this exists to dodge
// (the short version: the FIRST fs/scope-resolving Tauri call in a process
// can collide with wry's onPageLoaded dispatch and wedge the main thread
// against the JavaBridge thread, permanently — measured 6/20 blank installs
// with the call at module scope, 0/20 deferred to `load` plus a macrotask).
//
// Every call site whose first act is such a call must go through this, not
// a hand-rolled copy of the same shape — main.tsx and App.tsx's
// initExtensions() both do. Duplicating the readyState check
// invites the two to drift apart and rot back into the module-scope bug in
// only one of them.
export function deferPastPageLoad(fn: () => void): void {
  const run = () => {
    // A macrotask after `load` — `load` alone still overlaps the native
    // onPageFinished dispatch on some launches.
    setTimeout(fn, 0);
  };
  if (document.readyState === "complete") {
    run();
  } else {
    window.addEventListener("load", run, { once: true });
  }
}
