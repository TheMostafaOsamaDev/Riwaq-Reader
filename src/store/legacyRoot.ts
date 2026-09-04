// The one-time move of the app-data root from its pre-rename name.
// The names themselves live in ./paths.ts.
//
// Everything the app persists lives under a single directory inside Tauri's
// app-data dir: library.json, books/, shelves.json, downloadQueue.json and
// staging/. The Leaflet → Riwaq rename renamed that directory, so an install
// from <= v0.1.0 has all of its data under the old name.
//
// The Tauri identifier did NOT change in the rename, so old and new names sit
// in the same app-data dir and one directory rename carries everything across.
//
// IMPORTANT: several modules create the root (or a subdirectory of it) on their
// own — downloadQueue.ts persists on every queue transition, sourceLibrary.ts
// mkdirs per-book directories — and any of them can run before the library is
// first read. Each of those paths MUST `await migrateLegacyRoot()` first,
// otherwise it creates an empty `riwaq/` and the migration below sees the
// destination already present, declines to move, and the user's books are left
// stranded under `leaflet/`.

import { BaseDirectory, exists, rename } from "@tauri-apps/plugin-fs";
import { LEGACY_ROOT, ROOT } from "./paths";

const BASE = BaseDirectory.AppData;

let migration: Promise<void> | null = null;

/** Move `leaflet/` to `riwaq/` if — and only if — the new root does not exist
 *  yet. When both exist the new one wins and the legacy directory is left
 *  alone for the user to inspect; this never merges or deletes.
 *
 *  Memoized, so the many callers below don't race one another. A failed
 *  attempt clears the memo so the next launch can retry rather than leaving
 *  the library permanently stranded. */
export function migrateLegacyRoot(): Promise<void> {
  migration ??= (async () => {
    try {
      if (await exists(ROOT, { baseDir: BASE })) return;
      if (!(await exists(LEGACY_ROOT, { baseDir: BASE }))) return;
      await rename(LEGACY_ROOT, ROOT, {
        oldPathBaseDir: BASE,
        newPathBaseDir: BASE,
      });
    } catch {
      // Best-effort, and deliberately not rethrown: callers only need "the
      // root is ready to use", and the caller that follows this will mkdir an
      // empty root anyway. Clearing the memo lets a later launch retry; the
      // legacy directory is left intact either way.
      migration = null;
    }
  })();
  return migration;
}
