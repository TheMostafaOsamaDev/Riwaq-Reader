// On-disk layout for installed extensions, under the app-data root the
// rest of the app already uses:
//
//   riwaq/extensions/
//   ├── repos.json
//   ├── index-cache/<hash>.json
//   └── installed/<id>/{index.js,manifest.json,icon.png,.origin.json}
//
// Writes land in a sibling `.tmp-<id>` directory and are renamed into
// place, so an interrupted install can never leave a half-written bundle
// that loader.ts would then try to evaluate.

import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { migrateLegacyRoot } from "../store/legacyRoot";

const BASE = BaseDirectory.AppData;
export const EXTENSIONS_DIR = "riwaq/extensions";
const INSTALLED_DIR = `${EXTENSIONS_DIR}/installed`;

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  language: string;
  baseUrl: string;
  description?: Record<string, string>;
  author?: string;
  icon?: string;
}

export interface OriginRecord {
  repoUrl: string;
  sha256: string;
  installedAt: string;
}

export interface InstalledRecord {
  manifest: ExtensionManifest;
  origin: OriginRecord;
}

const dirOf = (id: string) => `${INSTALLED_DIR}/${id}`;
export const iconPath = (id: string) => `${dirOf(id)}/icon.png`;

async function ensureDir(path: string): Promise<void> {
  if (!(await exists(path, { baseDir: BASE }))) {
    await mkdir(path, { baseDir: BASE, recursive: true });
  }
}

// Every fs entry point below awaits this memoized promise FIRST, before its
// own first fs call — mirroring store/library.ts's ensureRoot(), which does
// the same for every store/* module that touches the filesystem.
//
// This is not stylistic. Writing anything under `riwaq/extensions` creates
// the `riwaq/` root, and migrateLegacyRoot() moves a pre-rename `leaflet/`
// root across only while `riwaq/` does not exist yet. An extensions write
// that gets there first makes the migration decline to move, stranding an
// upgrading user's entire library under `leaflet/` — see legacyRoot.ts's
// header, which states the rule and the consequence, and
// storageMigrationOrder.test.ts, which pins the ordering by asserting
// position 0 rather than membership.
//
// Add this to any new fs-touching export in this file, or it silently
// reopens that hazard for that one function.
async function ensureMigrated(): Promise<void> {
  await migrateLegacyRoot();
}

export async function listInstalled(): Promise<InstalledRecord[]> {
  await ensureMigrated();
  if (!(await exists(INSTALLED_DIR, { baseDir: BASE }))) return [];
  const entries = await readDir(INSTALLED_DIR, { baseDir: BASE });
  const out: InstalledRecord[] = [];
  for (const entry of entries) {
    if (
      !entry.isDirectory ||
      entry.name.startsWith(".tmp-") ||
      entry.name.startsWith(".old-")
    ) {
      continue;
    }
    try {
      const manifest = JSON.parse(
        await readTextFile(`${dirOf(entry.name)}/manifest.json`, {
          baseDir: BASE,
        }),
      ) as ExtensionManifest;
      const origin = JSON.parse(
        await readTextFile(`${dirOf(entry.name)}/.origin.json`, {
          baseDir: BASE,
        }),
      ) as OriginRecord;
      out.push({ manifest, origin });
    } catch {
      // One unreadable extension must not blank the whole list — the Store
      // still has to render, and catalog.ts surfaces the gap as "broken".
    }
  }
  return out.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export async function readBundleSource(id: string): Promise<string> {
  await ensureMigrated();
  return readTextFile(`${dirOf(id)}/index.js`, { baseDir: BASE });
}

export async function writeInstalled(
  id: string,
  files: {
    source: string;
    manifest: ExtensionManifest;
    icon?: Uint8Array;
    origin: OriginRecord;
  },
): Promise<void> {
  await ensureMigrated();
  // The directory name (`id`) is the identity every other function in this
  // module keys on — readBundleSource, iconPath, removeInstalled all take
  // it, not a value read out of manifest.json. A manifest that disagrees
  // with the id it's being installed under is a real inconsistency that
  // catalog.ts (a consumer of InstalledRecord) must never silently see —
  // fail loudly rather than coerce or persist the mismatch.
  if (files.manifest.id !== id) {
    throw new Error(
      `Extension id mismatch: manifest declares "${files.manifest.id}" but it is being installed as "${id}".`,
    );
  }

  const target = dirOf(id);
  const staging = `${INSTALLED_DIR}/.tmp-${id}`;
  const aside = `${INSTALLED_DIR}/.old-${id}`;

  // Recovery: if an earlier call died between "move the old bundle aside"
  // and "delete the old bundle" below, `.old-<id>` is left holding the
  // previous install with nothing at `target`. Put it back before doing
  // anything else, so this call starts from a consistent state instead of
  // compounding an already-interrupted swap.
  if (
    !(await exists(target, { baseDir: BASE })) &&
    (await exists(aside, { baseDir: BASE }))
  ) {
    await rename(aside, target, {
      oldPathBaseDir: BASE,
      newPathBaseDir: BASE,
    });
  }

  // Clear staging left behind by an earlier crashed attempt: icon.png is
  // only written below when an icon is supplied, so a stale one from a
  // previous attempt must not survive into an install that has none.
  if (await exists(staging, { baseDir: BASE })) {
    await remove(staging, { baseDir: BASE, recursive: true });
  }
  await ensureDir(staging);
  await writeTextFile(`${staging}/index.js`, files.source, { baseDir: BASE });
  await writeTextFile(
    `${staging}/manifest.json`,
    JSON.stringify(files.manifest, null, 2),
    { baseDir: BASE },
  );
  await writeTextFile(
    `${staging}/.origin.json`,
    JSON.stringify(files.origin, null, 2),
    { baseDir: BASE },
  );
  if (files.icon) {
    await writeFile(`${staging}/icon.png`, files.icon, { baseDir: BASE });
  }

  // Swap the new bundle in with no window where neither the old nor the new
  // bundle occupies `target`: move the old one aside, bring the new one in,
  // delete the old one last. Dying between the first two renames is exactly
  // what the recovery block above undoes on the next call; dying after both
  // renames just leaves a harmless `.old-<id>` for the next call to clean up
  // (cleared here too, in case one is already sitting from that case).
  if (await exists(aside, { baseDir: BASE })) {
    await remove(aside, { baseDir: BASE, recursive: true });
  }
  if (await exists(target, { baseDir: BASE })) {
    await rename(target, aside, {
      oldPathBaseDir: BASE,
      newPathBaseDir: BASE,
    });
  }
  await rename(staging, target, {
    oldPathBaseDir: BASE,
    newPathBaseDir: BASE,
  });
  if (await exists(aside, { baseDir: BASE })) {
    await remove(aside, { baseDir: BASE, recursive: true });
  }
}

export async function removeInstalled(id: string): Promise<void> {
  await ensureMigrated();
  if (await exists(dirOf(id), { baseDir: BASE })) {
    await remove(dirOf(id), { baseDir: BASE, recursive: true });
  }
}
