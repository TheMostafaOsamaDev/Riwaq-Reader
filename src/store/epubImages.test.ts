// Lazy in-flow images: the import no longer copies every image out of the
// archive (for a 206 MB illustrated book that was the entire book, written a
// second time), so the reader has to pull a chapter's images on first view.
import { beforeEach, describe, expect, it, vi } from "vitest";

let files: Record<string, string> = {};
let existing = new Set<string>();
const extracted: { path: string; items: { entry: string; dest: string }[] }[] = [];

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => existing.has(p),
  readTextFile: async (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  },
  writeTextFile: async (p: string, data: string) => {
    files[p] = data;
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd !== "zip_extract") throw new Error(`unexpected command ${cmd}`);
    const items = args.items as { entry: string; dest: string }[];
    extracted.push({ path: args.path as string, items });
    for (const item of items) existing.add(item.dest);
    return items.map(() => true);
  },
}));

import {
  __resetImageManifestCache,
  ensureEpubImages,
  IMAGE_MANIFEST,
  writeImageManifest,
} from "./epubImages";

const DIR = "leaflet/books/b1";

beforeEach(() => {
  files = {};
  existing = new Set();
  extracted.length = 0;
  __resetImageManifestCache();
});

async function seedManifest() {
  await writeImageManifest("b1", [
    { href: "images/img-001.png", entry: "OEBPS/Images/a.png", mimeType: "image/png" },
    { href: "images/img-002.png", entry: "OEBPS/Images/b.png", mimeType: "image/png" },
  ]);
}

describe("ensureEpubImages", () => {
  it("does nothing for a book with no manifest", async () => {
    // Every book imported before this change has its images on disk already.
    await ensureEpubImages("b1", ["images/img-001.png"]);
    expect(extracted).toEqual([]);
  });

  it("extracts only the images that are missing", async () => {
    await seedManifest();
    existing.add(`${DIR}/images/img-001.png`);
    await ensureEpubImages("b1", ["images/img-001.png", "images/img-002.png"]);
    expect(extracted).toEqual([
      {
        path: `${DIR}/book.epub`,
        items: [{ entry: "OEBPS/Images/b.png", dest: `${DIR}/images/img-002.png` }],
      },
    ]);
  });

  it("does not go back to the archive for images it already pulled", async () => {
    await seedManifest();
    await ensureEpubImages("b1", ["images/img-001.png"]);
    await ensureEpubImages("b1", ["images/img-001.png"]);
    expect(extracted).toHaveLength(1);
  });

  it("ignores srcs the manifest doesn't know", async () => {
    // Streaming books reference remote URLs and have no manifest entry.
    await seedManifest();
    await ensureEpubImages("b1", ["https://example.com/x.png"]);
    expect(extracted).toEqual([]);
  });

  it("survives a corrupt manifest", async () => {
    files[`${DIR}/${IMAGE_MANIFEST}`] = "{not json";
    await expect(
      ensureEpubImages("b1", ["images/img-001.png"]),
    ).resolves.toBeUndefined();
    expect(extracted).toEqual([]);
  });
});
