// sweepStaleStaging: the copies a killed import left in riwaq/staging.
//
// The rule under test is the one that makes the sweep safe to run while the
// app is importing: only entries last written BEFORE this process started go.
import { beforeEach, describe, expect, it, vi } from "vitest";

/** name -> mtime (ms), or null for "no mtime reported". */
let entries: Record<string, number | null> = {};
let stagingExists = true;
let statThrowsFor: string | null = null;
const removed: string[] = [];

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async () => stagingExists,
  readDir: async () => {
    if (!stagingExists) throw new Error("ENOENT staging");
    return Object.keys(entries).map((name) => ({ name }));
  },
  stat: async (p: string) => {
    if (statThrowsFor && p.endsWith(statThrowsFor)) throw new Error("EIO");
    const name = p.split("/").pop() as string;
    const t = entries[name];
    return { mtime: t === null ? null : new Date(t) };
  },
  remove: async (p: string) => {
    removed.push(p);
  },
  mkdir: async () => {},
  readFile: async () => new Uint8Array(),
  readTextFile: async () => "",
  writeFile: async () => {},
  writeTextFile: async () => {},
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/data",
  join: async (...p: string[]) => p.join("/"),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => p,
  invoke: async () => null,
}));
vi.mock("./legacyRoot", () => ({ migrateLegacyRoot: async () => {} }));

const { sweepStaleStaging } = await import("./library");

const START = 1_000_000;

beforeEach(() => {
  entries = {};
  stagingExists = true;
  statThrowsFor = null;
  removed.length = 0;
});

describe("sweepStaleStaging", () => {
  it("removes what an earlier process left, keeps what this one wrote", async () => {
    entries = {
      orphan: START - 60_000,
      live: START + 5,
      startedSameMs: START,
    };
    expect(await sweepStaleStaging(START)).toBe(1);
    expect(removed).toEqual(["riwaq/staging/orphan"]);
  });

  it("leaves an entry alone when the filesystem reports no mtime", async () => {
    entries = { unknown: null };
    await sweepStaleStaging(START);
    expect(removed).toEqual([]);
  });

  it("keeps going past an entry it can't stat", async () => {
    entries = { bad: START - 1, alsoOld: START - 1 };
    statThrowsFor = "bad";
    expect(await sweepStaleStaging(START)).toBe(1);
    expect(removed).toEqual(["riwaq/staging/alsoOld"]);
  });

  it("is a no-op without a staging folder", async () => {
    stagingExists = false;
    entries = { ghost: START - 1 };
    expect(await sweepStaleStaging(START)).toBe(0);
    expect(removed).toEqual([]);
  });
});
