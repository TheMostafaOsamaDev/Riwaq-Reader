// readState rebuilds BookState field by field rather than trusting the parsed
// JSON. That is deliberate — state on disk can be older than the code — but it
// means a field added to the type is silently DROPPED on read until it is also
// added here. readingMode shipped that way: setDocxReadingMode wrote "flow" to
// disk, every read threw it away, and the toggle appeared to do nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";

const files: Record<string, string> = {};

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => p in files,
  mkdir: async () => {},
  readTextFile: async (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  },
  writeTextFile: async (p: string, v: string) => {
    files[p] = v;
  },
  readFile: async () => new Uint8Array(),
  writeFile: async () => {},
  remove: async () => {},
  rename: async () => {},
  readDir: async () => [],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => null,
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/app",
  join: async (...p: string[]) => p.join("/"),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));

import { setDocxReadingMode, loadFixedBook } from "./library";

const ID = "docx-1";
const DIR = `riwaq/books/${ID}`;

beforeEach(() => {
  for (const k of Object.keys(files)) delete files[k];
  files[`${DIR}/book.json`] = JSON.stringify({
    id: ID,
    kind: "docx",
    title: "T",
    author: "",
    dir: "ltr",
    outline: [],
  });
  files[`${DIR}/state.json`] = JSON.stringify({
    bookId: ID,
    currentChapter: 0,
    paragraphIndex: 0,
    highlights: [],
  });
});

describe("readingMode survives a write/read round trip", () => {
  it("comes back as flow after being set", async () => {
    await setDocxReadingMode(ID, "flow", [[0, 1, 2]]);
    const { state } = await loadFixedBook(ID);
    expect(state.readingMode).toBe("flow");
  });

  it("comes back as pages after being set back", async () => {
    await setDocxReadingMode(ID, "flow", [[0, 1, 2]]);
    await setDocxReadingMode(ID, "pages", [[0, 1, 2]]);
    const { state } = await loadFixedBook(ID);
    expect(state.readingMode).toBe("pages");
  });

  it("is absent for a book that never switched", async () => {
    const { state } = await loadFixedBook(ID);
    expect(state.readingMode).toBeUndefined();
  });

  it("ignores a junk value on disk rather than trusting it", async () => {
    files[`${DIR}/state.json`] = JSON.stringify({
      bookId: ID,
      currentChapter: 0,
      paragraphIndex: 0,
      readingMode: "sideways",
      highlights: [],
    });
    const { state } = await loadFixedBook(ID);
    expect(state.readingMode).toBeUndefined();
  });

  it("keeps the position fields the switch wrote", async () => {
    await setDocxReadingMode(ID, "pages", [[0, 1, 2]]);
    const { state } = await loadFixedBook(ID);
    expect(state.fixedAnchor).toEqual({ blockId: "b0", frac: 0 });
  });
});
