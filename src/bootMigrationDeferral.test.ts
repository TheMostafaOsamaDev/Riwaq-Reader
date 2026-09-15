// @vitest-environment happy-dom
//
// Regression cover for the Android blank launch — the deadlock version.
//
// main.tsx used to start the app-data migration during module evaluation:
//
//     void migrateLegacyRoot();
//
// That call's first act is an fs-plugin call, and the FIRST fs call in a
// process makes Tauri resolve the plugin's scope. Resolving it calls
// app_data_dir(), which on Android is a JNI round trip serviced by the Android
// main thread — and Tauri holds the PluginStore lock across the whole thing.
//
// The main thread, on page load, runs wry's onPageLoaded ->
// prepare_pending_webview, which wants that same lock. So an fs call still in
// flight when onPageFinished dispatches deadlocks the two against each other:
// the JavaBridge thread holds the lock and waits for the main thread; the main
// thread waits for the lock. Neither moves, React's scheduled initial render
// never runs, and the app sits on the boot background forever.
//
// Taken from a native stack dump of a wedged process, and measured across
// clean installs on an Android 16 emulator: 6/20 blanked with the call at
// module scope, 0/20 with it deferred past `load`.
//
// What this test pins is the one property that fix depends on: NOTHING may
// start the migration while the document is still loading. It cannot reproduce
// a native deadlock, but it fails the moment someone moves the call back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const render = vi.fn();
const createRoot = vi.fn(() => ({ render, unmount: vi.fn() }));
vi.mock("react-dom/client", () => ({
  default: { createRoot },
  createRoot,
}));
vi.mock("./App", () => ({ default: () => null }));
vi.mock("./styles/global.css", () => ({}));

const migrateLegacyRoot = vi.fn(() => Promise.resolve());
vi.mock("./store/legacyRoot", () => ({ migrateLegacyRoot }));

/** happy-dom reports "complete" by default; the real cold launch does not. */
function setReadyState(value: DocumentReadyState): void {
  Object.defineProperty(document, "readyState", {
    value,
    configurable: true,
  });
}

describe("app-data migration is kept out of the page-load window", () => {
  // `vi.resetModules()` gives each test a fresh main.tsx, but happy-dom's
  // `window` outlives them — so every import leaves its `load` listener
  // behind, and one dispatch would fire all of them. Track and unbind.
  let bound: EventListenerOrEventListenerObject[] = [];
  const realAdd = window.addEventListener.bind(window);

  beforeEach(() => {
    vi.useRealTimers();
    render.mockClear();
    createRoot.mockClear();
    migrateLegacyRoot.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    bound = [];
    vi.spyOn(window, "addEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "load" && listener) bound.push(listener);
      realAdd(type as keyof WindowEventMap, listener, options);
    }) as typeof window.addEventListener);
    vi.resetModules();
  });

  afterEach(() => {
    for (const l of bound) window.removeEventListener("load", l);
    vi.restoreAllMocks();
  });

  it("does not start the migration while the document is still loading", async () => {
    setReadyState("loading");
    await import("./main");
    await Promise.resolve();

    // The deadlock window. An fs call started here can collide with the
    // native onPageFinished dispatch.
    expect(migrateLegacyRoot).not.toHaveBeenCalled();
  });

  it("still mounts React immediately — deferring must not gate first paint", async () => {
    setReadyState("loading");
    await import("./main");
    await Promise.resolve();

    expect(render).toHaveBeenCalledTimes(1);
  });

  it("starts the migration once the page has loaded", async () => {
    vi.useFakeTimers();
    setReadyState("loading");
    await import("./main");

    window.dispatchEvent(new Event("load"));
    // Deferred one macrotask past `load` — `load` alone still overlaps the
    // native dispatch on some launches.
    expect(migrateLegacyRoot).not.toHaveBeenCalled();
    vi.runAllTimers();

    expect(migrateLegacyRoot).toHaveBeenCalledTimes(1);
  });

  it("starts it anyway when the document was already complete", async () => {
    vi.useFakeTimers();
    setReadyState("complete");
    await import("./main");
    vi.runAllTimers();

    // A reload, or any path where `load` has already fired, must not strand
    // the migration waiting for an event that will never come again.
    expect(migrateLegacyRoot).toHaveBeenCalledTimes(1);
  });

  it("starts it exactly once even if `load` somehow fires twice", async () => {
    vi.useFakeTimers();
    setReadyState("loading");
    await import("./main");

    window.dispatchEvent(new Event("load"));
    window.dispatchEvent(new Event("load"));
    vi.runAllTimers();

    expect(migrateLegacyRoot).toHaveBeenCalledTimes(1);
  });
});
