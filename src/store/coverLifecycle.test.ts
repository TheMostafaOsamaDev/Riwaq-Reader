// Cover files across replacement and deletion.
//
// Covers are named after their source extension, so swapping a .jpg cover for
// a .png writes a NEW file and repoints the index entry. Nothing removed the
// old one, so it sat on disk for the life of the book — invisible to the UI
// and to the user, who had just been told the cover changed.
import { beforeEach, describe, expect, it, vi } from "vitest";

let files: Record<string, Uint8Array | string> = {};
const dirs = new Set<string>();
let picked: string | null = null;

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => p in files || dirs.has(p),
  mkdir: async (p: string) => {
    dirs.add(p);
  },
  readTextFile: async (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return String(v);
  },
  writeTextFile: async (p: string, data: string) => {
    files[p] = data;
  },
  readFile: async (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v instanceof Uint8Array ? v : new TextEncoder().encode(String(v));
  },
  writeFile: async (p: string, data: Uint8Array) => {
    files[p] = data;
  },
  remove: async (p: string, opts?: { recursive?: boolean }) => {
    if (opts?.recursive) {
      for (const k of Object.keys(files)) {
        if (k === p || k.startsWith(`${p}/`)) delete files[k];
      }
      for (const d of [...dirs])
        if (d === p || d.startsWith(`${p}/`)) dirs.delete(d);
      return;
    }
    if (!(p in files)) throw new Error(`ENOENT ${p}`);
    delete files[p];
  },
  rename: async () => {},
  readDir: async () => [],
  copyFile: async () => {},
  stat: async () => ({ size: 0 }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => picked }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/app",
  join: async (...p: string[]) => p.join("/"),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  invoke: async () => null,
}));
vi.mock("./legacyRoot", () => ({ migrateLegacyRoot: async () => {} }));

import { deleteBook, setCoverFromFile, type BookIndexEntry } from "./library";
import { bookDir, INDEX } from "./paths";

const ID = "book-1";

function seed(coverFile: string) {
  const entry: BookIndexEntry = {
    id: ID,
    title: "A book",
    author: "",
    language: "en",
    chapterCount: 1,
    addedAt: 1,
    progress: 0,
    coverFile,
  };
  files = {
    [INDEX]: JSON.stringify({ version: 1, books: [entry] }),
    [`${bookDir(ID)}/${coverFile}`]: new Uint8Array([1, 2, 3]),
    [`${bookDir(ID)}/book.json`]: "{}",
  };
  dirs.clear();
}

const bookFiles = () =>
  Object.keys(files).filter((f) => f.startsWith(`${bookDir(ID)}/`));

describe("replacing a cover", () => {
  beforeEach(() => {
    picked = null;
  });

  it("deletes the previous file when the new cover has another extension", async () => {
    seed("cover.jpg");
    picked = "/somewhere/new-art.png";
    files["/somewhere/new-art.png"] = new Uint8Array([9, 9, 9]);

    await setCoverFromFile(ID);

    expect(bookFiles()).toContain(`${bookDir(ID)}/cover.png`);
    expect(bookFiles()).not.toContain(`${bookDir(ID)}/cover.jpg`);
  });

  it("keeps the cover when the replacement overwrites it in place", async () => {
    // Same extension means the write already replaced the bytes. Deleting
    // "the old file" here would delete the new one.
    seed("cover.png");
    picked = "/somewhere/other-art.png";
    files["/somewhere/other-art.png"] = new Uint8Array([9, 9, 9]);

    await setCoverFromFile(ID);

    expect(bookFiles()).toContain(`${bookDir(ID)}/cover.png`);
    expect(files[`${bookDir(ID)}/cover.png`]).toEqual(
      new Uint8Array([9, 9, 9]),
    );
  });

  it("points the index at the new cover", async () => {
    seed("cover.jpg");
    picked = "/somewhere/new-art.webp";
    files["/somewhere/new-art.webp"] = new Uint8Array([9]);

    const entry = await setCoverFromFile(ID);

    expect(entry?.coverFile).toBe("cover.webp");
    expect(JSON.parse(String(files[INDEX])).books[0].coverFile).toBe(
      "cover.webp",
    );
  });
});

describe("removing a book", () => {
  it("takes every cover file with it", async () => {
    // The thumbnail lives inside the book directory precisely so that the
    // recursive remove already covers it — this is the regression guard for
    // anyone tempted to store derived images somewhere shared.
    seed("cover.jpg");
    files[`${bookDir(ID)}/cover-thumb.webp`] = new Uint8Array([5]);
    files[`${bookDir(ID)}/images/img-001.jpg`] = new Uint8Array([6]);

    await deleteBook(ID);

    expect(bookFiles()).toEqual([]);
  });

  it("drops the entry from the index", async () => {
    seed("cover.jpg");
    await deleteBook(ID);
    expect(JSON.parse(String(files[INDEX])).books).toEqual([]);
  });
});
