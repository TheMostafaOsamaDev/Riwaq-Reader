// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Ev =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

const h = vi.hoisted(() => ({
  calls: [] as string[],
  check: vi.fn(),
  relaunch: vi.fn(async () => {}),
  openUrl: vi.fn(async (_url: string) => {}),
  invoke: vi.fn(async (_cmd: string, _args?: unknown) => ({ notes: null })),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: h.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: h.relaunch }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: h.openUrl }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));

import * as store from "./desktopUpdate";
import { RELEASES_PAGE_URL } from "./updates";

/** A fake plugin Update. `download` replays `events`, then waits on `gate`
 *  when one is given, so a test can look at the state mid-download. */
function fakeUpdate(
  o: {
    events?: Ev[];
    gate?: Promise<void>;
    downloadFails?: boolean;
    installFails?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const u = {
    version: "0.6.0",
    calls,
    download: vi.fn(async (onEvent?: (e: Ev) => void) => {
      calls.push("download");
      for (const e of o.events ?? []) onEvent?.(e);
      if (o.gate) await o.gate;
      if (o.downloadFails) throw new Error("network");
    }),
    install: vi.fn(async () => {
      calls.push("install");
      if (o.installFails) throw new Error("install");
    }),
    downloadAndInstall: vi.fn(async () => {
      calls.push("downloadAndInstall");
    }),
    close: vi.fn(async () => {}),
  };
  return u;
}

const saved: (string | undefined)[] = [];
function setup(over: { skipped?: string; running?: string } = {}) {
  store.configure({
    running: over.running ?? "0.5.4",
    skipped: over.skipped,
    saveSkipped: (v) => saved.push(v),
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A Restart now press that comes after the arming delay, as a person's
 *  would: the store ignores restart() within ARM_MS of becoming ready. */
async function deliberateRestart() {
  vi.setSystemTime(Date.now() + 1100);
  await store.restart();
}

beforeEach(() => {
  // Only the clock is faked (restart()'s guard reads Date.now()); timers
  // and promises run for real.
  vi.useFakeTimers({ toFake: ["Date"] });
  store.__resetForTests();
  saved.length = 0;
  h.check.mockReset();
  h.relaunch.mockClear();
  h.openUrl.mockClear();
  h.relaunch.mockImplementation(async () => {
    h.calls.push("relaunch");
  });
  h.calls = [];
});
afterEach(() => {
  store.__resetForTests();
  vi.useRealTimers();
});

describe("desktop update store: card and dot", () => {
  it("offers a card for a newer version; nothing for Flatpak (no info)", async () => {
    setup();
    expect(store.cardFor(store.getState())).toBeNull();
    await store.offer(null);
    expect(store.cardFor(store.getState())).toBeNull();
    await store.offer({ version: "0.6.0", channel: "auto" });
    expect(store.cardFor(store.getState())).toEqual({ kind: "available" });
  });

  it("no card once the running version is at the offer", async () => {
    setup({ running: "0.6.0" });
    await store.offer({ version: "0.6.0", channel: "auto" });
    expect(store.cardFor(store.getState())).toBeNull();
  });

  it("Later hides the card, shows the dot, and toasts", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    expect(store.dotFor(store.getState())).toBe(false);
    store.later();
    const s = store.getState();
    expect(store.cardFor(s)).toBeNull();
    expect(store.dotFor(s)).toBe(true);
    expect(s.toast).toBe("later");
  });

  it("Skip hides the card, sets the tweak, no dot; Undo puts it back", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    store.skip();
    const s = store.getState();
    expect(store.cardFor(s)).toBeNull();
    expect(store.dotFor(s)).toBe(false);
    expect(saved).toEqual(["0.6.0"]);
    expect(s.toast).toBe("skipped");
    store.undoSkip();
    expect(saved).toEqual(["0.6.0", undefined]);
    expect(store.cardFor(store.getState())).toEqual({ kind: "available" });
  });

  it("a stored skip of an older version is cleared once something newer is offered", async () => {
    setup({ skipped: "0.5.9" });
    await store.offer({ version: "0.6.0", channel: "auto" });
    expect(saved).toEqual([undefined]);
    expect(store.cardFor(store.getState())).toEqual({ kind: "available" });
  });
});

describe("desktop update store: auto channel", () => {
  it("sums progress from Started.contentLength and Progress.chunkLength", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    let open!: () => void;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    h.check.mockResolvedValue(
      fakeUpdate({
        gate,
        events: [
          { event: "Started", data: { contentLength: 12_000_000 } },
          { event: "Progress", data: { chunkLength: 3_000_000 } },
          { event: "Progress", data: { chunkLength: 2_000_000 } },
        ],
      }),
    );
    const p = store.update();
    await flush();
    const s = store.getState();
    expect(s.phase).toBe("downloading");
    expect(s.bytes).toBe(5_000_000);
    expect(s.total).toBe(12_000_000);
    expect(store.cardFor(s)).toEqual({
      kind: "downloading",
      bytes: 5_000_000,
      total: 12_000_000,
    });
    open();
    await p;
  });

  it("is ready only after download resolves", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    let open!: () => void;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    h.check.mockResolvedValue(fakeUpdate({ gate }));
    const p = store.update();
    await flush();
    expect(store.getState().phase).toBe("downloading");
    open();
    await p;
    expect(store.getState().phase).toBe("ready");
    expect(store.cardFor(store.getState())).toEqual({ kind: "ready" });
    expect(h.relaunch).not.toHaveBeenCalled();
  });

  it("a second Update while downloading does not start another", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    let open!: () => void;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    h.check.mockResolvedValue(fakeUpdate({ gate }));
    const p = store.update();
    await flush();
    await store.update();
    expect(h.check).toHaveBeenCalledTimes(1);
    open();
    await p;
  });

  it("Restart now installs, then relaunches", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    const u = fakeUpdate();
    h.check.mockResolvedValue(u);
    await store.update();
    await deliberateRestart();
    expect(u.install).toHaveBeenCalledTimes(1);
    expect(h.relaunch).toHaveBeenCalledTimes(1);
    expect(u.install.mock.invocationCallOrder[0]).toBeLessThan(
      h.relaunch.mock.invocationCallOrder[0],
    );
    // No second check: the downloaded Update was kept.
    expect(h.check).toHaveBeenCalledTimes(1);
  });

  it("Restart now with the Update lost re-checks and downloads-and-installs", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    const u = fakeUpdate();
    h.check.mockResolvedValue(u);
    store.__setReadyWithoutUpdateForTests();
    await deliberateRestart();
    expect(h.check).toHaveBeenCalledTimes(1);
    expect(u.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(h.relaunch).toHaveBeenCalledTimes(1);
  });

  it("a failed download shows the failed card; never relaunches", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    h.check.mockResolvedValue(fakeUpdate({ downloadFails: true }));
    await store.update();
    expect(store.cardFor(store.getState())).toEqual({ kind: "failed" });
    expect(h.relaunch).not.toHaveBeenCalled();
  });

  it("check() finding nothing is a failure, not a silent no-op", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    h.check.mockResolvedValue(null);
    await store.update();
    expect(store.getState().phase).toBe("failed");
  });

  it("a failed install fails, and does not relaunch", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    h.check.mockResolvedValue(fakeUpdate({ installFails: true }));
    await store.update();
    await deliberateRestart();
    expect(store.getState().phase).toBe("failed");
    expect(h.relaunch).not.toHaveBeenCalled();
  });

  it("opening the progress dialog after Update", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    store.openDialog("notes");
    let open!: () => void;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    h.check.mockResolvedValue(fakeUpdate({ gate }));
    const p = store.update();
    await flush();
    expect(store.getState().dialog).toBe("progress");
    open();
    await p;
    // Done: the progress dialog has nothing left to show.
    expect(store.getState().dialog).toBe("closed");
  });
});

describe("desktop update store: manual channel", () => {
  it("Download opens the release page and never calls check()", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "manual" });
    await store.update();
    expect(h.openUrl).toHaveBeenCalledWith(RELEASES_PAGE_URL);
    expect(h.check).not.toHaveBeenCalled();
    expect(store.getState().phase).toBe("idle");
  });

  it("restart() on the manual channel does nothing", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "manual" });
    await deliberateRestart();
    expect(h.check).not.toHaveBeenCalled();
    expect(h.relaunch).not.toHaveBeenCalled();
  });
});

describe("desktop update store: fix round 1", () => {
  it("a newer offer during a download: when the old one ends, the new one is offered and Update works", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    let open!: () => void;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const a = fakeUpdate({ gate });
    h.check.mockResolvedValueOnce(a);
    const p = store.update();
    await flush();
    await store.offer({ version: "0.6.1", channel: "auto" });
    open();
    await p;
    let s = store.getState();
    expect(s.phase).toBe("idle");
    expect(s.bytes).toBe(0);
    expect(store.cardFor(s)).toEqual({ kind: "available" });
    expect(a.close).toHaveBeenCalled();
    const b = fakeUpdate();
    h.check.mockResolvedValueOnce(b);
    await store.update();
    s = store.getState();
    expect(s.phase).toBe("ready");
    await deliberateRestart();
    expect(b.install).toHaveBeenCalled();
  });

  it("a newer offer during a download that then fails: idle, not stuck", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    let open!: () => void;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    h.check.mockResolvedValueOnce(fakeUpdate({ gate, downloadFails: true }));
    const p = store.update();
    await flush();
    await store.offer({ version: "0.6.1", channel: "auto" });
    open();
    await p;
    expect(store.getState().phase).toBe("idle");
    expect(store.cardFor(store.getState())).toEqual({ kind: "available" });
  });

  it("install works but relaunch throws: installed, not failed", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    h.check.mockResolvedValue(fakeUpdate());
    await store.update();
    h.relaunch.mockImplementationOnce(async () => {
      throw new Error("no relaunch");
    });
    await deliberateRestart();
    const s = store.getState();
    expect(s.phase).toBe("installed");
    expect(store.cardFor(s)).toEqual({ kind: "installed" });
  });

  it("a failed install closes the dropped Update", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    const u = fakeUpdate({ installFails: true });
    h.check.mockResolvedValue(u);
    await store.update();
    await deliberateRestart();
    expect(u.close).toHaveBeenCalled();
  });

  it("a retry that downloads again closes the previous Update", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    const first = fakeUpdate({ installFails: true });
    h.check.mockResolvedValueOnce(first);
    await store.update();
    await deliberateRestart();
    const second = fakeUpdate();
    h.check.mockResolvedValueOnce(second);
    await store.update();
    expect(first.close).toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
    expect(store.getState().phase).toBe("ready");
  });
});

describe("desktop update store: restart guard (defence in depth)", () => {
  it("restart() within ARM_MS of ready does nothing; after it, installs and relaunches", async () => {
    setup();
    await store.offer({ version: "0.6.0", channel: "auto" });
    const u = fakeUpdate();
    h.check.mockResolvedValue(u);
    await store.update();
    expect(store.getState().phase).toBe("ready");
    vi.setSystemTime(Date.now() + 500);
    await store.restart();
    expect(u.install).not.toHaveBeenCalled();
    expect(h.relaunch).not.toHaveBeenCalled();
    expect(store.getState().phase).toBe("ready");
    vi.setSystemTime(Date.now() + 600);
    await store.restart();
    expect(u.install).toHaveBeenCalledTimes(1);
    expect(h.relaunch).toHaveBeenCalledTimes(1);
  });
});
