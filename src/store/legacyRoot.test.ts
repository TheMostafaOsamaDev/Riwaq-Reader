// Regression cover for the Leaflet → Riwaq app-data move.
//
// The bug this exists for lost real shelves: `listShelves()` probed
// `exists("riwaq/shelves.json")` BEFORE anything migrated, got false because
// the data was still under `leaflet/`, seeded the two default shelves, and its
// write — which did trigger the move — then landed on top of the real file the
// move had just put there. Net effect: a user's shelves silently replaced by
// "Favorites" / "To read" on the first launch after the rename.
import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory filesystem keyed by app-data-relative path. Directories are
// tracked as a set so `rename` can move a whole tree the way the real one does.
let files: Record<string, string> = {};
let dirs = new Set<string>();

function renameTree(from: string, to: string) {
  for (const d of [...dirs]) {
    if (d === from || d.startsWith(`${from}/`)) {
      dirs.delete(d);
      dirs.add(to + d.slice(from.length));
    }
  }
  for (const p of Object.keys(files)) {
    if (p === from || p.startsWith(`${from}/`)) {
      files[to + p.slice(from.length)] = files[p];
      delete files[p];
    }
  }
}

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => p in files || dirs.has(p),
  mkdir: async (p: string) => {
    dirs.add(p);
  },
  readTextFile: async (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  },
  writeTextFile: async (p: string, data: string) => {
    files[p] = data;
  },
  rename: async (from: string, to: string) => {
    if (!(from in files) && !dirs.has(from)) throw new Error(`ENOENT ${from}`);
    renameTree(from, to);
  },
}));

// listShelves() reaches library.ts for ensureRoot/removeShelfFromAllBooks;
// stub it so this test stays about ordering, not the whole library module.
vi.mock("./library", () => ({
  ensureRoot: async () => {
    const { migrateLegacyRoot } = await import("./legacyRoot");
    await migrateLegacyRoot();
    dirs.add("riwaq");
  },
  removeShelfFromAllBooks: async () => {},
}));

import { LEGACY_ROOT, ROOT } from "./paths";

beforeEach(() => {
  files = {};
  dirs = new Set();
  vi.resetModules();
});

/** Seed a pre-rename install: everything under the legacy root. */
function seedLegacyInstall(shelfName: string) {
  dirs.add(LEGACY_ROOT);
  dirs.add(`${LEGACY_ROOT}/books`);
  files[`${LEGACY_ROOT}/shelves.json`] = JSON.stringify({
    shelves: [{ id: "s1", name: shelfName, createdAt: 1, order: 0 }],
  });
  files[`${LEGACY_ROOT}/library.json`] = JSON.stringify({ version: 1, books: [] });
}

describe("migrateLegacyRoot", () => {
  it("moves a legacy root across, contents and all", async () => {
    seedLegacyInstall("A song of ice and fire");
    const { migrateLegacyRoot } = await import("./legacyRoot");

    await migrateLegacyRoot();

    expect(files[`${ROOT}/shelves.json`]).toContain("A song of ice and fire");
    expect(files[`${ROOT}/library.json`]).toBeDefined();
    expect(files[`${LEGACY_ROOT}/shelves.json`]).toBeUndefined();
    expect(dirs.has(`${ROOT}/books`)).toBe(true);
  });

  it("leaves the legacy root alone when the new root already exists", async () => {
    seedLegacyInstall("Legacy");
    dirs.add(ROOT);
    files[`${ROOT}/shelves.json`] = JSON.stringify({
      shelves: [{ id: "s2", name: "Newer", createdAt: 2, order: 0 }],
    });
    const { migrateLegacyRoot } = await import("./legacyRoot");

    await migrateLegacyRoot();

    // The post-rename file wins, and nothing is merged or deleted.
    expect(files[`${ROOT}/shelves.json`]).toContain("Newer");
    expect(files[`${LEGACY_ROOT}/shelves.json`]).toContain("Legacy");
  });

  it("is a no-op with nothing to migrate", async () => {
    const { migrateLegacyRoot } = await import("./legacyRoot");
    await expect(migrateLegacyRoot()).resolves.toBeUndefined();
    expect(files).toEqual({});
  });

  it("runs the move once across concurrent callers", async () => {
    seedLegacyInstall("Once");
    const { migrateLegacyRoot } = await import("./legacyRoot");

    // A second rename of an already-moved root would throw ENOENT.
    await Promise.all([migrateLegacyRoot(), migrateLegacyRoot(), migrateLegacyRoot()]);

    expect(files[`${ROOT}/shelves.json`]).toContain("Once");
  });
});

describe("listShelves on a pre-rename install", () => {
  it("returns the migrated shelves instead of seeding over them", async () => {
    seedLegacyInstall("A song of ice and fire");
    const { listShelves } = await import("./shelves");

    const shelves = await listShelves();

    // The bug returned the two seeded defaults here and, worse, persisted them.
    expect(shelves.map((s) => s.name)).toEqual(["A song of ice and fire"]);
    expect(files[`${ROOT}/shelves.json`]).toContain("A song of ice and fire");
    expect(files[`${ROOT}/shelves.json`]).not.toContain("Favorites");
  });
});
