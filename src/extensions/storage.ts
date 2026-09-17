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

export async function listInstalled(): Promise<InstalledRecord[]> {
  // No up-front `exists` guard: on a fresh install INSTALLED_DIR's parents
  // may exist without INSTALLED_DIR itself ever having been created as its
  // own directory entry (mkdir(recursive) only guarantees the leaf path is
  // reachable). Treating a failed readDir as "nothing installed yet" covers
  // both a missing directory and an empty one with one code path.
  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(INSTALLED_DIR, { baseDir: BASE });
  } catch {
    return [];
  }
  const out: InstalledRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory || entry.name.startsWith(".tmp-")) continue;
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
  const staging = `${INSTALLED_DIR}/.tmp-${id}`;
  await ensureDir(staging);
  await writeTextFile(`${staging}/index.js`, files.source, { baseDir: BASE });
  // The directory name (`id`) is the identity every other function in this
  // module keys on — readBundleSource, iconPath, removeInstalled all take
  // it, not a value read back out of manifest.json. Force manifest.id to
  // match it so the two can never drift apart on disk.
  await writeTextFile(
    `${staging}/manifest.json`,
    JSON.stringify({ ...files.manifest, id }, null, 2),
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

  if (await exists(dirOf(id), { baseDir: BASE })) {
    await remove(dirOf(id), { baseDir: BASE, recursive: true });
  }
  await rename(staging, dirOf(id), {
    oldPathBaseDir: BASE,
    newPathBaseDir: BASE,
  });
}

export async function removeInstalled(id: string): Promise<void> {
  if (await exists(dirOf(id), { baseDir: BASE })) {
    await remove(dirOf(id), { baseDir: BASE, recursive: true });
  }
}
