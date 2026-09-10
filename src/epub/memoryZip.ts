// An in-memory (JSZip-backed) view of an EPUB zip.
//
// This lives in its own module for one reason: JSZip is ~132 kB and no
// production code imports it. Every real import path stages the archive to disk
// first and reads it through `openNativeZip`, which is Rust-backed and needs no
// zip library in JS at all. While this function shared a file with that one,
// bundling `openNativeZip` dragged JSZip into the startup chunk to serve a
// function only tests call — ~6 ms of eager parse for dead weight.
//
// Keep it that way: import this module from tests only. `src/bundleSplit.test.ts`
// fails if JSZip reappears in the entry chunk.

import JSZip from "jszip";
import type { ZipSource } from "./zipSource";

/**
 * Wrap a zip that only exists as bytes in JS. Used by tests; the app's own
 * import paths stage to disk first so they can use `openNativeZip` instead.
 */
export async function openMemoryZip(
  bytes: ArrayBuffer | Uint8Array,
  writeBytes?: (dest: string, data: Uint8Array) => Promise<void>,
): Promise<ZipSource> {
  const zip = await JSZip.loadAsync(bytes);
  const present = new Set<string>();
  zip.forEach((relPath, file) => {
    if (!file.dir) present.add(relPath);
  });

  return {
    has: (p) => present.has(p),

    async readText(p) {
      const f = zip.file(p);
      if (!f) return null;
      try {
        return await f.async("string");
      } catch {
        return null;
      }
    },

    async readBytes(p) {
      const f = zip.file(p);
      if (!f) return null;
      try {
        return await f.async("uint8array");
      } catch {
        return null;
      }
    },

    async prefetchText() {
      // Entries are already decompressed on demand from a local buffer;
      // there's no round trip to batch away.
    },

    async extract(items) {
      if (!writeBytes) {
        throw new Error("in-memory zip source cannot extract without a writer");
      }
      const out: boolean[] = [];
      for (const item of items) {
        const f = zip.file(item.entry);
        if (!f) {
          out.push(false);
          continue;
        }
        try {
          // One at a time, and the reference is dropped straight after the
          // write, so peak memory stays at a single entry rather than the
          // whole image set.
          await writeBytes(item.dest, await f.async("uint8array"));
          out.push(true);
        } catch {
          out.push(false);
        }
      }
      return out;
    },

    dispose() {
      present.clear();
    },
  };
}
