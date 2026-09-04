// In-flow images, pulled from the archive when a chapter first needs them.
//
// The import used to copy every image out of the EPUB onto disk. For an
// illustrated book that is the whole book written twice: the 206 MB test
// case spent ~206 MB on the staged copy and another ~206 MB on images, so
// it occupied ~412 MB of storage for a 206 MB book and paid for a second
// full pass over the archive before the import could finish.
//
// `books/<id>/book.epub` is kept forever anyway — it is what lets us
// re-extract a cover later — so the archive is always there to read from.
// The import therefore records *where* each image lives (`images.json`, a
// straight serialization of the parser's own EpubImageRef list) and the
// reader extracts a chapter's images the first time it renders them.
//
// Books imported before this existed have no manifest and their images
// already on disk, so `ensureEpubImages` returns immediately for them.
// That is the whole migration story.

import { invoke } from "@tauri-apps/api/core";
import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { EpubImageRef } from "../epub/types";
import { bookDir } from "./paths";

const BASE = BaseDirectory.AppData;

export const IMAGE_MANIFEST = "images.json";

interface ImageManifest {
  version: 1;
  /** Stored href (`images/img-001.png`) → entry name inside book.epub. */
  entries: Record<string, string>;
}

/** Per-book manifest, or null when the book has none. A missing key means
 *  "not looked up yet". */
const manifests = new Map<string, ImageManifest | null>();
/** Hrefs known to be on disk, per book — so revisiting a chapter is free. */
const present = new Map<string, Set<string>>();

/** Test seam. */
export function __resetImageManifestCache(): void {
  manifests.clear();
  present.clear();
}

export async function writeImageManifest(
  bookId: string,
  images: EpubImageRef[],
): Promise<void> {
  const entries: Record<string, string> = {};
  for (const img of images) entries[img.href] = img.entry;
  const manifest: ImageManifest = { version: 1, entries };
  await writeTextFile(
    `${bookDir(bookId)}/${IMAGE_MANIFEST}`,
    JSON.stringify(manifest),
    { baseDir: BASE },
  );
  manifests.set(bookId, manifest);
}

async function loadManifest(bookId: string): Promise<ImageManifest | null> {
  const cached = manifests.get(bookId);
  if (cached !== undefined) return cached;
  let manifest: ImageManifest | null = null;
  try {
    const raw = await readTextFile(`${bookDir(bookId)}/${IMAGE_MANIFEST}`, {
      baseDir: BASE,
    });
    const parsed = JSON.parse(raw) as ImageManifest;
    // A manifest we can't understand is treated as absent: the images are
    // either already on disk or genuinely unavailable, and throwing here
    // would blank the chapter over a metadata problem.
    manifest =
      parsed && typeof parsed.entries === "object" && parsed.entries !== null
        ? parsed
        : null;
  } catch {
    manifest = null;
  }
  manifests.set(bookId, manifest);
  return manifest;
}

/**
 * Make sure every src in `srcs` that this book's manifest knows about exists
 * on disk. Srcs the manifest doesn't list are left alone: remote URLs from
 * the streaming reader, DOCX images, and books imported before the manifest
 * existed all fall into that bucket.
 *
 * Never throws — a failed extraction should degrade to a missing image, not
 * take the chapter down with it.
 */
export async function ensureEpubImages(
  bookId: string,
  srcs: string[],
): Promise<void> {
  if (srcs.length === 0) return;
  const manifest = await loadManifest(bookId);
  if (!manifest) return;

  const dir = bookDir(bookId);
  let onDisk = present.get(bookId);
  if (!onDisk) {
    onDisk = new Set();
    present.set(bookId, onDisk);
  }

  const wanted = srcs.filter((s) => manifest.entries[s] && !onDisk.has(s));
  if (wanted.length === 0) return;

  const missing: { entry: string; dest: string }[] = [];
  await Promise.all(
    wanted.map(async (href) => {
      const dest = `${dir}/${href}`;
      try {
        if (await exists(dest, { baseDir: BASE })) {
          onDisk.add(href);
          return;
        }
      } catch {
        // Fall through and try to extract it.
      }
      missing.push({ entry: manifest.entries[href], dest });
    }),
  );
  if (missing.length === 0) return;

  try {
    await invoke<boolean[]>("zip_extract", {
      path: `${dir}/book.epub`,
      items: missing,
      // zip_extract emits progress under this token. Nothing listens for a
      // read-time extraction, and an unmatched token is ignored.
      token: `read-${bookId}`,
    });
    for (const href of wanted) onDisk.add(href);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[epubImages] extraction failed:", e);
  }
}
