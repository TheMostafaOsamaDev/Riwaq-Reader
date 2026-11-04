// The progress a library card shows, as written to library.json.
//
// It was `(chapter + 1) / count`: a whole chapter ahead of the reader, so a
// book just opened at chapter 1 of 3 read 33%, and any book read 100% the
// moment its last chapter opened. It is now the shared scale of
// reader/bookProgress.ts — a chapter change records where that chapter
// STARTS, and the reader's measured progress inside it is written as the
// reader saves its position.
import { beforeEach, describe, expect, it, vi } from "vitest";

let files: Record<string, string> = {};

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => p in files,
  mkdir: async () => {},
  readTextFile: async (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  },
  writeTextFile: async (p: string, data: string) => {
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
  updateBookProgress,
  updateReadingPosition,
  updateSourceReadingPosition,
} from "./library";
import { INDEX } from "./paths";

const progressOf = (id: string): number =>
  JSON.parse(files[INDEX]).books.find((b: { id: string }) => b.id === id)
    .progress;

describe("library progress", () => {
  beforeEach(() => {
    files = {
      [INDEX]: JSON.stringify({
        version: 1,
        books: [
          {
            id: "book",
            title: "b",
            author: "",
            language: "en",
            chapterCount: 3,
            addedAt: 1,
            progress: 0,
          },
          {
            id: "novel",
            title: "n",
            author: "",
            language: "ar",
            chapterCount: 10,
            addedAt: 1,
            progress: 0,
          },
        ],
      }),
    };
  });

  it("records where a chapter starts when the reader turns to it", async () => {
    await updateReadingPosition("book", 0, 3);
    expect(progressOf("book")).toBe(0);
    await updateReadingPosition("book", 2, 3);
    expect(progressOf("book")).toBeCloseTo(2 / 3, 9);
  });

  it("does the same for a web novel's entry", async () => {
    await updateSourceReadingPosition("novel", 9, 10);
    expect(progressOf("novel")).toBeCloseTo(0.9, 9);
  });

  it("writes the progress the reader measured", async () => {
    await updateBookProgress("novel", 0.453);
    expect(progressOf("novel")).toBeCloseTo(0.453, 9);
  });

  it("keeps a measured progress inside 0..1", async () => {
    await updateBookProgress("novel", 1.4);
    expect(progressOf("novel")).toBe(1);
  });
});
