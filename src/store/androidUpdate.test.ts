// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => unknown>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    Promise.resolve().then(() => h.invoke(cmd, args)),
}));

import * as store from "./androidUpdate";

type Native = {
  state: string;
  version?: string;
  bytes?: number;
  total?: number;
  error?: string | null;
};

/** A fake native side, routed on the command name. Each field is what the
 *  next call of that command answers; tests change them mid-flight. */
function fakeNative(over: Partial<Fake> = {}) {
  const f: Fake = {
    status: { state: "idle" },
    installer: "",
    storeInstalled: false,
    sourceFails: false,
    sourceJson: undefined,
    metered: false,
    canInstall: true,
    startedState: "downloading",
    ignoreStart: false,
    apkGate: undefined,
    holdStatus: undefined,
    ...over,
  };
  h.invoke.mockImplementation((cmd, args) => {
    switch (cmd) {
      case "install_source":
        if (f.sourceFails) throw new Error("lookup failed");
        return (
          f.sourceJson ??
          JSON.stringify({
            installer: f.installer,
            label: "Orion Store",
            storeInstalled: f.storeInstalled,
          })
        );
      case "android_update_status": {
        const json = JSON.stringify({
          bytes: 0,
          total: 0,
          error: null,
          ...f.status,
        });
        // A slow status read: answers what was true when it was asked.
        const hold = f.holdStatus;
        f.holdStatus = undefined;
        return hold ? hold.then(() => json) : json;
      }
      case "fetch_release_notes":
        return { notes: null };
      case "fetch_apk_details": {
        const details = {
          url: "https://x/app.apk",
          sha256: "ab".repeat(32),
          size: 19e6,
        };
        return f.apkGate ? f.apkGate.then(() => details) : details;
      }
      case "android_network_metered":
        return f.metered;
      case "android_update_can_install":
        return f.canInstall;
      case "android_update_start":
        // AppUpdater.start is ignored while a worker is busy.
        if (
          f.ignoreStart ||
          f.status.state === "downloading" ||
          f.status.state === "verifying"
        ) {
          return null;
        }
        f.status = {
          state:
            args?.waitForUnmetered && f.metered ? "waiting" : f.startedState,
          version: args?.version as string,
          bytes: 0,
          total: 100,
        };
        return null;
      case "android_update_cancel":
        f.status = { state: "idle" };
        return null;
      default:
        return null;
    }
  });
  return f;
}
interface Fake {
  status: Native;
  installer: string;
  storeInstalled: boolean;
  sourceFails: boolean;
  sourceJson: string | undefined;
  metered: boolean;
  canInstall: boolean;
  startedState: string;
  ignoreStart: boolean;
  /** While set, fetch_apk_details waits for it (a slow network round trip). */
  apkGate: Promise<void> | undefined;
  /** The NEXT status read waits for this, then answers what it saw. */
  holdStatus: Promise<void> | undefined;
}

function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => {
    open = r;
  });
  return { p, open };
}

const calls = (cmd: string) =>
  h.invoke.mock.calls.filter(([c]) => c === cmd).map(([, a]) => a);
const order = () => h.invoke.mock.calls.map(([c]) => c);

let visibility: DocumentVisibilityState = "visible";
function setVisible(v: DocumentVisibilityState) {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
}

const saveSkipped = vi.fn();
function configure(over: Partial<Parameters<typeof store.configure>[0]> = {}) {
  store.configure({
    running: "0.5.3",
    skipped: undefined,
    pref: "ask",
    saveSkipped,
    ...over,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.invoke.mockReset();
  saveSkipped.mockReset();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  store.__resetForTests();
});
afterEach(() => {
  store.__resetForTests();
  vi.useRealTimers();
});

describe("androidUpdate store", () => {
  it("on mobile data with 'Ask first', opens the mobile sheet and starts nothing", async () => {
    fakeNative({ metered: true });
    configure({ pref: "ask" });
    await store.offer({ version: "0.6.0" });
    await store.startDownload({ allowMetered: false });
    expect(store.getState().sheet).toBe("mobile");
    expect(calls("android_update_start")).toHaveLength(0);
  });

  it("Update anyway fetches the APK's details and starts with that sha256 and size", async () => {
    fakeNative({ metered: true });
    configure();
    await store.offer({ version: "0.6.0" });
    h.invoke.mockClear();
    await store.startDownload({ allowMetered: true });
    expect(calls("fetch_apk_details")).toEqual([{ version: "0.6.0" }]);
    expect(calls("android_update_start")).toEqual([
      {
        version: "0.6.0",
        url: "https://x/app.apk",
        sha256: "ab".repeat(32),
        size: 19e6,
        waitForUnmetered: false,
      },
    ]);
    const o = order();
    expect(o.indexOf("fetch_apk_details")).toBeLessThan(
      o.indexOf("android_update_start"),
    );
    // The sheet closes; the pill carries the progress.
    expect(store.getState().sheet).toBe("closed");
    expect(store.getState().native.state).toBe("downloading");
  });

  it("'Wait for Wi-Fi' as a setting parks the download instead of asking", async () => {
    fakeNative({ metered: true });
    configure({ pref: "wifi" });
    await store.offer({ version: "0.6.0" });
    await store.startDownload({ allowMetered: false });
    expect(calls("android_update_start")[0]?.waitForUnmetered).toBe(true);
    expect(store.getState().native.state).toBe("waiting");
    expect(store.getState().sheet).toBe("closed");
  });

  it("the mobile sheet's Wait for Wi-Fi button parks the download", async () => {
    fakeNative({ metered: true });
    configure({ pref: "ask" });
    await store.offer({ version: "0.6.0" });
    await store.startDownload({ allowMetered: false, waitForWifi: true });
    expect(calls("android_update_start")[0]?.waitForUnmetered).toBe(true);
  });

  it("never assumes a start took: the state comes from the next status read", async () => {
    // Native ignores the start (a download is already running elsewhere).
    fakeNative({ ignoreStart: true });
    configure();
    await store.offer({ version: "0.6.0" });
    await store.startDownload({ allowMetered: true });
    expect(calls("android_update_start")).toHaveLength(1);
    expect(store.getState().native.state).toBe("idle");
  });

  it("without the install permission, install() opens the permission sheet, and returning continues automatically", async () => {
    const f = fakeNative({
      status: { state: "ready", version: "0.6.0" },
      canInstall: false,
    });
    configure();
    await store.offer({ version: "0.6.0" });
    await store.install();
    expect(store.getState().sheet).toBe("permission");
    expect(calls("android_update_install")).toHaveLength(0);

    // The user goes to Android settings and comes back without allowing it.
    setVisible("hidden");
    setVisible("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("android_update_install")).toHaveLength(0);
    expect(store.getState().sheet).toBe("permission");

    // Now they allow it.
    f.canInstall = true;
    setVisible("hidden");
    setVisible("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("android_update_install")).toHaveLength(1);
    expect(store.getState().sheet).toBe("closed");
  });

  it("install() stays callable while installing: a re-tap recovers a dialog that never appeared", async () => {
    fakeNative({ status: { state: "installing", version: "0.6.0" } });
    configure();
    await store.offer({ version: "0.6.0" });
    await store.install();
    expect(calls("android_update_install")).toHaveLength(1);
  });

  it("a store-assisted install opens that store, never the in-app download", async () => {
    fakeNative({ installer: "com.orion.store", storeInstalled: true });
    configure();
    await store.offer({ version: "0.6.0" });
    expect(store.getState().channel?.kind).toBe("store-assisted");
    await store.startDownload({ allowMetered: true });
    expect(calls("open_store")).toEqual([{ pkg: "com.orion.store" }]);
    expect(calls("android_update_start")).toHaveLength(0);
  });

  it("a failed installer lookup, or unreadable JSON, means the manual channel", async () => {
    fakeNative({ sourceFails: true });
    configure();
    await store.offer({ version: "0.6.0" });
    expect(store.getState().channel).toEqual({ kind: "manual" });

    store.__resetForTests();
    fakeNative({ sourceJson: "not json" });
    configure();
    await store.offer({ version: "0.6.0" });
    expect(store.getState().channel).toEqual({ kind: "manual" });

    store.__resetForTests();
    fakeNative({ sourceJson: JSON.stringify({ installer: 7 }) });
    configure();
    await store.offer({ version: "0.6.0" });
    expect(store.getState().channel).toEqual({ kind: "manual" });

    // The control: a readable sideload answer is in-app.
    store.__resetForTests();
    fakeNative();
    configure();
    await store.offer({ version: "0.6.0" });
    expect(store.getState().channel).toEqual({ kind: "in-app" });
  });

  it("a newer offer cancels a stale ready APK first — it deletes the file", async () => {
    fakeNative({ status: { state: "ready", version: "0.6.0" } });
    configure();
    await store.offer({ version: "0.6.1" });
    expect(calls("android_update_cancel")).toHaveLength(1);
    const o = order();
    const cancelAt = o.indexOf("android_update_cancel");
    expect(cancelAt).toBeGreaterThanOrEqual(0);
    expect(cancelAt).toBeLessThan(o.indexOf("install_source"));
    expect(cancelAt).toBeLessThan(o.indexOf("fetch_release_notes"));
    expect(store.getState().native.state).toBe("idle");
  });

  it("does not cancel the offered version's own file, nor a stale download still running", async () => {
    fakeNative({ status: { state: "ready", version: "0.6.1" } });
    configure();
    await store.offer({ version: "0.6.1" });
    expect(calls("android_update_cancel")).toHaveLength(0);

    store.__resetForTests();
    h.invoke.mockReset();
    const f = fakeNative({
      status: { state: "downloading", version: "0.6.0", bytes: 1, total: 9 },
    });
    configure();
    await store.offer({ version: "0.6.1" });
    expect(calls("android_update_cancel")).toHaveLength(0);
    // …but the moment it finishes, the superseded file goes.
    f.status = { state: "ready", version: "0.6.0" };
    await vi.advanceTimersByTimeAsync(500);
    expect(calls("android_update_cancel")).toHaveLength(1);
  });

  it("Skip cancels at once (the APK is deleted now, not next launch); Undo only restores the offer", async () => {
    fakeNative({ status: { state: "ready", version: "0.6.0" } });
    configure();
    await store.offer({ version: "0.6.0" });
    await store.skip("0.6.0");
    expect(calls("android_update_cancel")).toHaveLength(1);
    expect(saveSkipped).toHaveBeenLastCalledWith("0.6.0");
    expect(store.getState().skipped).toBe("0.6.0");
    expect(store.getState().toast).toBe("skipped");
    expect(store.getState().sheet).toBe("closed");

    h.invoke.mockClear();
    store.undoSkip();
    expect(saveSkipped).toHaveBeenLastCalledWith(undefined);
    expect(store.getState().skipped).toBeUndefined();
    expect(store.getState().toast).toBeNull();
    expect(calls("android_update_start")).toHaveLength(0);
  });

  it("Later hides the pill for the session and says where it went", async () => {
    fakeNative();
    configure();
    await store.offer({ version: "0.6.0" });
    store.openSheet("notes");
    store.later();
    const s = store.getState();
    expect(s.later).toBe(true);
    expect(s.toast).toBe("later");
    expect(s.sheet).toBe("closed");
  });

  it("clears a stored skip once something newer is offered", async () => {
    fakeNative();
    configure({ skipped: "0.6.0" });
    await store.offer({ version: "0.6.1" });
    expect(saveSkipped).toHaveBeenCalledWith(undefined);
    expect(store.getState().skipped).toBeUndefined();
  });

  it("keeps a skip for the very version that was skipped", async () => {
    fakeNative();
    configure({ skipped: "0.6.0" });
    await store.offer({ version: "0.6.0" });
    expect(saveSkipped).not.toHaveBeenCalled();
    expect(store.getState().skipped).toBe("0.6.0");
  });

  it("polls every 500 ms while downloading and visible, and stops when done", async () => {
    const f = fakeNative();
    configure();
    await store.offer({ version: "0.6.0" });
    await store.startDownload({ allowMetered: true });
    const n0 = calls("android_update_status").length;
    f.status = {
      state: "downloading",
      version: "0.6.0",
      bytes: 40,
      total: 100,
    };
    await vi.advanceTimersByTimeAsync(500);
    expect(calls("android_update_status").length).toBe(n0 + 1);
    expect(store.getState().native.bytes).toBe(40);

    f.status = { state: "ready", version: "0.6.0" };
    await vi.advanceTimersByTimeAsync(500);
    const done = calls("android_update_status").length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls("android_update_status").length).toBe(done);
    expect(store.getState().native.state).toBe("ready");
  });

  it("stops polling while hidden, and refreshes once on return", async () => {
    const f = fakeNative();
    configure();
    await store.offer({ version: "0.6.0" });
    await store.startDownload({ allowMetered: true });
    setVisible("hidden");
    await vi.advanceTimersByTimeAsync(0);
    const hidden = calls("android_update_status").length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls("android_update_status").length).toBe(hidden);

    f.status = { state: "ready", version: "0.6.0" };
    setVisible("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls("android_update_status").length).toBe(hidden + 1);
    expect(store.getState().native.state).toBe("ready");
  });

  it("never polls an idle updater", async () => {
    fakeNative();
    configure();
    await store.offer({ version: "0.6.0" });
    const n = calls("android_update_status").length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls("android_update_status").length).toBe(n);
  });

  it("passes native error codes through unchanged", async () => {
    for (const error of [
      "offline",
      "checksum",
      "signature",
      "storage",
      "install",
    ]) {
      store.__resetForTests();
      fakeNative({ status: { state: "failed", version: "0.6.0", error } });
      configure();
      await store.offer({ version: "0.6.0" });
      expect(store.getState().native.error).toBe(error);
    }
  });

  it("Retry resumes a dropped download, and retries the install after an install failure", async () => {
    const f = fakeNative({
      status: { state: "failed", version: "0.6.0", error: "offline" },
    });
    configure({ pref: "always" });
    await store.offer({ version: "0.6.0" });
    await store.retry();
    expect(calls("android_update_start")).toHaveLength(1);

    f.status = { state: "failed", version: "0.6.0", error: "install" };
    await store.refresh();
    await store.retry();
    expect(calls("android_update_install")).toHaveLength(1);
  });

  it("Cancel stops the download and deletes the file natively", async () => {
    fakeNative();
    configure();
    await store.offer({ version: "0.6.0" });
    await store.startDownload({ allowMetered: true });
    await store.cancel();
    expect(calls("android_update_cancel")).toHaveLength(1);
    expect(store.getState().native.state).toBe("idle");
  });

  it("notifies subscribers, and loads the notes once per version", async () => {
    fakeNative();
    configure();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    await store.offer({ version: "0.6.0" });
    await store.offer({ version: "0.6.0" });
    expect(fn).toHaveBeenCalled();
    expect(calls("fetch_release_notes")).toEqual([{ version: "0.6.0" }]);
    expect(store.getState().notes).toEqual({
      notes: null,
      highlightImage: undefined,
    });
    off();
  });

  it("a Skip during the APK lookup wins: the declined version never starts", async () => {
    const f = fakeNative();
    configure({ pref: "always" });
    await store.offer({ version: "0.6.0" });
    const g = gate();
    f.apkGate = g.p;
    const pending = store.startDownload({ allowMetered: true });
    await vi.advanceTimersByTimeAsync(0);
    await store.skip("0.6.0");
    g.open();
    await pending;
    expect(calls("android_update_start")).toHaveLength(0);
    expect(store.getState().native.state).toBe("idle");
  });

  it("a newer offer during the APK lookup abandons the old start", async () => {
    const f = fakeNative();
    configure({ pref: "always" });
    await store.offer({ version: "0.6.0" });
    const g = gate();
    f.apkGate = g.p;
    const pending = store.startDownload({ allowMetered: true });
    await vi.advanceTimersByTimeAsync(0);
    f.apkGate = undefined;
    await store.offer({ version: "0.6.1" });
    g.open();
    await pending;
    expect(calls("android_update_start")).toHaveLength(0);
  });

  it("a second tap while a start is pending does nothing", async () => {
    const f = fakeNative();
    configure();
    await store.offer({ version: "0.6.0" });
    const g = gate();
    f.apkGate = g.p;
    const a = store.startDownload({ allowMetered: true });
    const b = store.startDownload({ allowMetered: true });
    g.open();
    await Promise.all([a, b]);
    expect(calls("android_update_start")).toHaveLength(1);
    expect(calls("fetch_apk_details").length).toBeLessThanOrEqual(2);
  });

  it("Update on a new offer cancels a superseded download still running, then starts", async () => {
    // 0.6.0 is mid-download; 0.6.1 is offered and the user taps Update.
    // Without the cancel, native ignores the start and the old file grows.
    fakeNative({
      status: { state: "downloading", version: "0.6.0", bytes: 5, total: 9 },
    });
    configure();
    await store.offer({ version: "0.6.1" });
    expect(calls("android_update_cancel")).toHaveLength(0); // not on its own
    await store.startDownload({ allowMetered: true });
    expect(calls("android_update_cancel")).toHaveLength(1);
    const o = order();
    expect(o.lastIndexOf("android_update_cancel")).toBeLessThan(
      o.lastIndexOf("android_update_start"),
    );
    expect(calls("android_update_start")[0]?.version).toBe("0.6.1");
    expect(store.getState().native).toMatchObject({
      state: "downloading",
      version: "0.6.1",
    });
  });

  it("does not cancel the offered version's own running download on a re-tap", async () => {
    fakeNative({
      status: { state: "downloading", version: "0.6.0", bytes: 5, total: 9 },
    });
    configure();
    await store.offer({ version: "0.6.0" });
    await store.startDownload({ allowMetered: true });
    expect(calls("android_update_cancel")).toHaveLength(0);
  });

  it("drops a poll result that started before Cancel: no resurrected download", async () => {
    const f = fakeNative();
    configure();
    await store.offer({ version: "0.6.0" });
    await store.startDownload({ allowMetered: true });
    expect(store.getState().native.state).toBe("downloading");
    // The next poll's status read is slow; it saw "downloading".
    const g = gate();
    f.holdStatus = g.p;
    await vi.advanceTimersByTimeAsync(500);
    await store.cancel();
    expect(store.getState().native.state).toBe("idle");
    g.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().native.state).toBe("idle");
  });

  it("never stacks polls behind a slow status read", async () => {
    const f = fakeNative();
    configure();
    await store.offer({ version: "0.6.0" });
    await store.startDownload({ allowMetered: true });
    const n = calls("android_update_status").length;
    const g = gate();
    f.holdStatus = g.p;
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls("android_update_status").length).toBe(n + 1);
    g.open();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls("android_update_status").length).toBe(n + 2);
  });
});
