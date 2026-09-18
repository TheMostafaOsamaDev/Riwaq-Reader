// ensureExtensions(): the memoised "somebody has loaded the registry" path.
//
// initExtensions() is the explicit refresh and re-lists the disk on every
// call — right for the Store's mount and for the Extensions manager after a
// mutation, wrong for the four consumers that only need the registry to be
// populated (a novel page, the streaming reader, the search overlay, a
// library card's source badge). Before this existed, none of them loaded it
// at all and all four silently answered "nothing is installed" for the whole
// of any session in which the Store was never opened.
//
// Each case takes a fresh module graph, because "has it been loaded yet" is
// module-level state and a shared one would make these pass on file order.
import { beforeEach, describe, expect, it, vi } from "vitest";

let installedIds: string[] = ["alpha"];
let listCalls = 0;
let listThrows: Error | null = null;

vi.mock("../extensions/storage", () => ({
  listInstalled: async () => {
    listCalls++;
    if (listThrows) throw listThrows;
    return installedIds.map((id) => ({
      manifest: {
        id,
        name: id.toUpperCase(),
        version: "1.0.0",
        apiVersion: 1,
        language: "en",
        baseUrl: `https://${id}.test`,
      },
      origin: {
        repoUrl: "https://repo.test/index.min.json",
        sha256: "a".repeat(64),
        installedAt: "2026-01-01T00:00:00.000Z",
      },
    }));
  },
  readBundleSource: async () => "export default () => ({});",
  iconPath: (id: string) => `riwaq/extensions/installed/${id}/icon.png`,
}));

vi.mock("../extensions/loader", () => ({
  loadExtension: async (manifest: { id: string }) => ({
    ok: true,
    source: { id: manifest.id, canHandle: () => false },
  }),
}));

vi.mock("./host", () => ({ createHost: () => ({}) }));
vi.mock("../extensions/repos", () => ({
  listRepos: async () => [],
  saveRepos: async () => {},
  fetchRepoIndex: async () => {
    throw new Error("unused");
  },
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/appdata",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  invoke: async () => {
    throw new Error("no tauri in tests");
  },
}));

type Registry = typeof import("./registry");
async function fresh(): Promise<Registry> {
  vi.resetModules();
  return import("./registry");
}

beforeEach(() => {
  installedIds = ["alpha"];
  listCalls = 0;
  listThrows = null;
});

describe("ensureExtensions", () => {
  it("populates a registry nobody else has loaded", async () => {
    const reg = await fresh();
    expect(reg.getSource("alpha")).toBeNull();
    expect(reg.getExtensionStatus("alpha")).toBe("missing");

    await reg.ensureExtensions();

    expect(reg.getExtensionStatus("alpha")).toBe("ok");
    expect(reg.getSource("alpha")).not.toBeNull();
  });

  it("lists the disk once however many consumers ask", async () => {
    // Four views can mount within a frame of each other. Each calling the
    // refresh path directly would be four directory walks and four
    // overlapping loads racing the generation guard for no reason.
    const reg = await fresh();
    await Promise.all([
      reg.ensureExtensions(),
      reg.ensureExtensions(),
      reg.ensureExtensions(),
    ]);
    await reg.ensureExtensions();

    expect(listCalls).toBe(1);
  });

  it("does not stand in the way of an explicit refresh", async () => {
    // initExtensions() keeps meaning "re-list now" — it is what the Store's
    // mount and every Extensions-manager mutation call, and memoising that
    // away would stop a newly installed source from ever appearing.
    const reg = await fresh();
    await reg.ensureExtensions();
    installedIds = ["alpha", "beta"];

    await reg.initExtensions();

    expect(listCalls).toBe(2);
    expect(reg.listSources().map((m) => m.id)).toEqual(["alpha", "beta"]);
  });

  it("retries after a load that could not read the disk", async () => {
    // initExtensions swallows an unreadable extensions directory and leaves
    // the registry uninitialised. Keeping the memo would then pin one
    // transient FS error for the rest of the process — every later view
    // inheriting an empty registry from a fault that has since cleared.
    const reg = await fresh();
    listThrows = new Error("EACCES");
    await reg.ensureExtensions();
    expect(reg.getExtensionStatus("alpha")).toBe("missing");

    listThrows = null;
    await reg.ensureExtensions();

    expect(listCalls).toBe(2);
    expect(reg.getExtensionStatus("alpha")).toBe("ok");
  });

  it("tells subscribers when the table it commits changes", async () => {
    // A view that read an accessor before the load has no other way to
    // learn the answer changed: the accessors are synchronous by contract
    // and nothing re-renders on its own.
    const reg = await fresh();
    const seen: number[] = [];
    const unsubscribe = reg.subscribeExtensions(() =>
      seen.push(reg.extensionsRevision()),
    );

    await reg.ensureExtensions();
    expect(seen).toEqual([1]);

    installedIds = ["alpha", "beta"];
    await reg.initExtensions();
    expect(seen).toEqual([1, 2]);

    unsubscribe();
    await reg.initExtensions();
    expect(seen).toEqual([1, 2]);
  });

  it("does not notify for a load that commits nothing", async () => {
    // The failure arm returns before the swap, so nothing changed and no
    // consumer should be re-rendered into reading the same empty table.
    const reg = await fresh();
    let notified = 0;
    reg.subscribeExtensions(() => notified++);

    listThrows = new Error("EACCES");
    await reg.ensureExtensions();

    expect(notified).toBe(0);
    expect(reg.extensionsRevision()).toBe(0);
  });
});
