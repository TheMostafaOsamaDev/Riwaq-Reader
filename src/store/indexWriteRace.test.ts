// Regression cover for the library-index read-modify-write race.
//
// Every index mutation in library.ts has the same three steps — readIndex(),
// mutate the array, writeIndex() — with real awaits between them. Nothing
// serialized those, so two overlapping mutations both read the SAME array and
// whichever wrote second clobbered the other's entry.
//
// The reachable path: listBooks() fires an un-awaited backfillMissingCovers()
// that read-modify-writes the index, while an import's own appendIndexEntry()
// is midway through the same three steps. The book the user just imported
// disappears from library.json with its files orphaned on disk.
import { beforeEach, describe, expect, it, vi } from "vitest";

let files: Record<string, string> = {};
const dirs = new Set<string>();

/** Every FS call suspends, the way a real one does. Without a delay here the
 *  awaits resolve on the microtask queue in lockstep and the interleave that
 *  loses a write never happens — the test would pass against the bug. */
const slow = () => new Promise((r) => setTimeout(r, 1));

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => {
    await slow();
    return p in files || dirs.has(p);
  },
  mkdir: async (p: string) => {
    dirs.add(p);
  },
  readTextFile: async (p: string) => {
    await slow();
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  },
  writeTextFile: async (p: string, data: string) => {
    await slow();
    files[p] = data;
  },
  remove: async () => {},
  rename: async () => {},
  readFile: async () => new Uint8Array(),
  writeFile: async () => {},
  readDir: async () => [],
  copyFile: async () => {},
  stat: async () => ({ size: 0 }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/app",
  join: async (...p: string[]) => p.join("/"),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  invoke: async () => null,
}));
vi.mock("./legacyRoot", () => ({ migrateLegacyRoot: async () => {} }));

import {
  appendIndexEntry,
  updateBookStatus,
  type BookIndexEntry,
} from "./library";
import { INDEX } from "./paths";

const entry = (id: string): BookIndexEntry => ({
  id,
  title: id,
  author: "",
  language: "en",
  chapterCount: 1,
  addedAt: 1,
  progress: 0,
});

function indexBooks(): string[] {
  return JSON.parse(files[INDEX]).books.map((b: { id: string }) => b.id);
}

describe("concurrent library-index mutations", () => {
  beforeEach(() => {
    files = { [INDEX]: JSON.stringify({ version: 1, books: [entry("existing")] }) };
    dirs.clear();
  });

  it("keeps an import's entry when another mutation overlaps it", async () => {
    // appendIndexEntry stands in for the import; updateBookStatus for any of
    // the fifteen other read-modify-writes that can be in flight at the same
    // time — a cover backfill, a page-progress save, a shelf change.
    await Promise.all([
      appendIndexEntry(entry("just-imported")),
      updateBookStatus("existing", "reading"),
    ]);

    expect(indexBooks()).toContain("just-imported");
    expect(indexBooks()).toContain("existing");
  });

  it("keeps every entry when several imports land at once", async () => {
    // Dropping a folder of books on the window, or "Open with" on a multi
    // selection, appends several entries without awaiting between them.
    await Promise.all([
      appendIndexEntry(entry("a")),
      appendIndexEntry(entry("b")),
      appendIndexEntry(entry("c")),
    ]);

    expect(indexBooks()).toEqual(["existing", "a", "b", "c"]);
  });

  it("applies a status change made while an import is in flight", async () => {
    await Promise.all([
      appendIndexEntry(entry("imported")),
      updateBookStatus("existing", "finished"),
    ]);

    const books = JSON.parse(files[INDEX]).books;
    expect(books.find((b: { id: string }) => b.id === "existing").status)
      .toBe("finished");
  });
});
