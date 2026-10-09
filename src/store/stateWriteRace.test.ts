// Regression cover for the per-book state.json read-modify-write race.
//
// A selection across several paragraphs (or PDF pages) saves one highlight per
// part, all at once; and the debounced position save runs whenever the reader
// scrolls. Every one of those reads the whole state.json, changes a field, and
// writes the whole file back — so two that overlapped lost the first. On
// reopen, a three-part highlight came back as one part.
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
  loadFixedBook,
  saveHighlight,
  updatePagePosition,
  writeInitialState,
} from "./library";
import { bookDir } from "./library";

const part = (n: number) => ({
  chapter: 0,
  paragraphIndex: 0,
  charStart: 0,
  charEnd: 0,
  text: `part ${n}`,
  color: "yellow" as const,
  groupId: "g",
  fixed: { fmt: "pdf" as const, page: n, rects: [] },
});

describe("state.json writes are serialised per book", () => {
  beforeEach(async () => {
    files = {};
    dirs.clear();
    files[`${bookDir("b")}/book.json`] = JSON.stringify({ id: "b" });
    await writeInitialState("b");
  });

  it("keeps every part of a multi-part highlight saved at once", async () => {
    await Promise.all([1, 2, 3].map((n) => saveHighlight("b", part(n))));
    const { state } = await loadFixedBook("b");
    expect(state.highlights.map((h) => h.text).sort()).toEqual([
      "part 1",
      "part 2",
      "part 3",
    ]);
  });

  it("a position save landing mid-save does not drop the highlight", async () => {
    await Promise.all([
      saveHighlight("b", part(1)),
      updatePagePosition("b", 7, 0.5),
    ]);
    const { state } = await loadFixedBook("b");
    expect(state.highlights).toHaveLength(1);
    expect(state.currentPage).toBe(7);
  });
});
