// @vitest-environment happy-dom
//
// The whole module is mocked at the fs boundary, because store.ts is the one
// place in this feature allowed to cross the Tauri bridge — everything it
// does has to be provable without one.
import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const mkdir = vi.fn(async () => {});
const writeTextFile = vi.fn(
  async (p: string, c: string, o?: { append?: boolean }) => {
    files.set(p, o?.append ? (files.get(p) ?? "") + c : c);
  },
);
const readTextFile = vi.fn(async (p: string) => files.get(p) ?? "");
const readDir = vi.fn(async () =>
  [...files.keys()].map((n) => ({ name: n.split("/").pop() ?? "" })),
);
const remove = vi.fn(async (p: string) => {
  files.delete(p);
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  mkdir,
  writeTextFile,
  readTextFile,
  readDir,
  remove,
}));

describe("diagnostics store", () => {
  beforeEach(() => {
    files.clear();
    vi.clearAllMocks();
    vi.resetModules();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  it("writes recorded events to the session file on flush", async () => {
    const { record } = await import("./recorder");
    const { startSession, flushNow } = await import("./store");
    await startSession();
    record("nav", { to: "library" });
    await flushNow();
    const written = [...files.values()].join("");
    expect(written).toContain('"kind":"nav"');
  });

  it("is a no-op outside Tauri rather than throwing", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const { startSession, flushNow } = await import("./store");
    await expect(startSession()).resolves.toBeUndefined();
    await expect(flushNow()).resolves.toBeUndefined();
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("survives an unwritable log rather than taking the app down", async () => {
    mkdir.mockRejectedValueOnce(new Error("read-only volume"));
    const { record } = await import("./recorder");
    const { startSession, flushNow } = await import("./store");
    await expect(startSession()).resolves.toBeUndefined();
    record("nav", { to: "library" });
    await expect(flushNow()).resolves.toBeUndefined();
  });

  it("retires the sessions past the retention cap", async () => {
    // Numbered across the 9/10 boundary on purpose: a string sort puts
    // session-10 below session-9, which would retire the NEWEST run.
    for (const n of [8, 9, 10, 11]) {
      files.set(`diagnostics/session-${n}.jsonl`, "");
    }
    const { startSession } = await import("./store");
    await startSession();
    const numbers = [...files.keys()]
      .map((k) => Number(/session-(\d+)\.jsonl$/.exec(k)?.[1]))
      .sort((a, b) => a - b);
    // Three past runs survive alongside the one just opened.
    expect(numbers).toEqual([9, 10, 11, 12]);
  });

  it("opens one file per launch however often it is called", async () => {
    // StrictMode mounts App's effect twice in development.
    const { startSession } = await import("./store");
    await startSession();
    await startSession();
    expect([...files.keys()]).toEqual(["diagnostics/session-1.jsonl"]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("lists retained sessions oldest first, one entry per line", async () => {
    files.set("diagnostics/session-2.jsonl", '{"kind":"b"}\n');
    files.set("diagnostics/session-10.jsonl", '{"kind":"c"}\n{"kind":"d"}\n');
    const { listSessions } = await import("./store");
    expect(await listSessions()).toEqual([
      { name: "session-2.jsonl", lines: ['{"kind":"b"}'] },
      { name: "session-10.jsonl", lines: ['{"kind":"c"}', '{"kind":"d"}'] },
    ]);
  });

  it("captures an unhandled error into the buffer", async () => {
    const { installErrorCapture } = await import("./store");
    const { drain } = await import("./recorder");
    const uninstall = installErrorCapture();
    window.dispatchEvent(
      new ErrorEvent("error", { message: "boom", filename: "a.js", lineno: 3 }),
    );
    const kinds = drain().map((e) => e.kind);
    expect(kinds).toContain("error");
    uninstall();
  });

  it("captures an unhandled rejection into the buffer", async () => {
    const { installErrorCapture } = await import("./store");
    const { drain } = await import("./recorder");
    const uninstall = installErrorCapture();
    // happy-dom has no PromiseRejectionEvent constructor, so the event is
    // assembled by hand — the listener only ever reads `reason`.
    const ev = new Event("unhandledrejection") as Event & { reason?: unknown };
    ev.reason = new Error("nope");
    window.dispatchEvent(ev);
    const e = drain().find((x) => x.kind === "unhandledRejection");
    expect((e?.data as Record<string, unknown>)?.message).toBe("nope");
    uninstall();
  });

  it("stops capturing after uninstall", async () => {
    const { installErrorCapture } = await import("./store");
    const { drain } = await import("./recorder");
    installErrorCapture()();
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    expect(drain().length).toBe(0);
  });
});
