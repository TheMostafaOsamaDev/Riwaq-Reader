// On-disk layout for installed extensions, under the app-data root the
// rest of the app already uses:
//
//   riwaq/extensions/
//   ├── repos.json
//   ├── index-cache/<hash>.json
//   ├── staging/<id>/    — a write in progress
//   ├── trash/<id>/      — the previous install, mid-swap
//   └── installed/<id>/{index.js,manifest.json,icon.png,origin.json}
//
// Writes land in `staging/<id>` and are renamed into place, so an
// interrupted install can never leave a half-written bundle that loader.ts
// would then try to evaluate.
//
// NOTHING HERE MAY BE DOT-PREFIXED. These were `.tmp-<id>`, `.old-<id>` and
// `.origin.json` — hidden, and sitting inside `installed/`, which is why
// listInstalled had to filter them out by prefix. Tauri's fs scope refuses
// them: tauri-plugin-fs resolves `require_literal_leading_dot` as
// `.unwrap_or(cfg!(unix))`, so on macOS, Linux AND Android a `$APPDATA/**`
// scope does not match any path component starting with a dot, and every
// call against one fails with "forbidden path". Windows defaults the other
// way, so this breaks on three platforms and passes on the one where a glob
// test would most likely be written.
//
// Keeping staging and trash OUTSIDE `installed/` also means listInstalled
// needs no prefix filter at all: every directory in there is a real
// install, and no extension id can ever collide with a staging name.

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
const STAGING_DIR = `${EXTENSIONS_DIR}/staging`;
const TRASH_DIR = `${EXTENSIONS_DIR}/trash`;

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

/** The shape an extension id is allowed to take.
 *
 *  This is a security boundary, not tidiness. The id IS a path component
 *  here — `installed/<id>`, `staging/<id>`, `trash/<id>` — and it arrives
 *  from a repository index, which is to say from the network. A repo
 *  publishing `"id": "../../../evil"` would otherwise have every write
 *  below land wherever it liked, the moment the user pressed Install.
 *
 *  The fs scope does NOT reliably stop that, so this cannot be left to it:
 *  tauri-plugin-fs resolves `require_literal_leading_dot` as
 *  `.unwrap_or(cfg!(unix))`, and Tauri's scope canonicalises only a path
 *  that ALREADY EXISTS. For a mkdir or a write to a path that does not
 *  exist yet, the literal `..` components are glob-matched — which unix
 *  rejects and Windows does not, so there `$APPDATA/**` matches
 *  `…/installed/../../../evil/index.js` and the write goes through.
 *
 *  And even on unix a merely nested id like `a/b` installs into a directory
 *  that listInstalled then skips: the install reports success and the
 *  extension never appears.
 *
 *  Checked at two layers on purpose. repos.ts drops an index entry whose id
 *  does not match this, so a bad id never reaches an install; these two
 *  writers re-assert it so the guard still holds for any future caller that
 *  does not come through a repo index. */
const EXTENSION_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function isValidExtensionId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  // Redundant with the leading-character rule, and spelled out anyway
  // because these two are the entire reason the rule exists.
  if (id === "." || id === "..") return false;
  return EXTENSION_ID_RE.test(id);
}

export function assertValidExtensionId(id: string): void {
  if (!isValidExtensionId(id)) {
    throw new Error(
      `Unusable extension id ${JSON.stringify(id)}. An id is a directory ` +
        `name on disk: it must start with a letter or digit and may then ` +
        `contain letters, digits, ".", "_" and "-", up to 64 characters.`,
    );
  }
}

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
// reopens that hazard for that one function. Exported because repos.ts
// writes under the same root (`riwaq/extensions/repos.json` and the index
// cache) and needs the identical guarantee from its own entry points —
// sharing this is what keeps the two files from drifting into two
// different answers about when the migration has run.
export async function ensureMigrated(): Promise<void> {
  await migrateLegacyRoot();
}

export async function listInstalled(): Promise<InstalledRecord[]> {
  await ensureMigrated();
  if (!(await exists(INSTALLED_DIR, { baseDir: BASE }))) return [];
  const entries = await readDir(INSTALLED_DIR, { baseDir: BASE });
  const out: InstalledRecord[] = [];
  for (const entry of entries) {
    // No prefix filter: staging and trash live outside this directory, so
    // everything here is a real install.
    if (!entry.isDirectory) continue;
    try {
      const manifest = JSON.parse(
        await readTextFile(`${dirOf(entry.name)}/manifest.json`, {
          baseDir: BASE,
        }),
      ) as ExtensionManifest;
      const origin = JSON.parse(
        await readTextFile(`${dirOf(entry.name)}/origin.json`, {
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
  // Before anything builds a path out of it. See EXTENSION_ID_RE.
  assertValidExtensionId(id);
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
  const staging = `${STAGING_DIR}/${id}`;
  const aside = `${TRASH_DIR}/${id}`;

  // Recovery: if an earlier call died between "move the old bundle aside"
  // and "delete the old bundle" below, `trash/<id>` is left holding the
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
    `${staging}/origin.json`,
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
  // renames just leaves a harmless `trash/<id>` for the next call to clean up
  // (cleared here too, in case one is already sitting from that case).
  if (await exists(aside, { baseDir: BASE })) {
    await remove(aside, { baseDir: BASE, recursive: true });
  }
  // Both rename destinations need their parent to exist. This used to come
  // for free: staging lived at `installed/.tmp-<id>`, so creating it also
  // created `installed/`. Now that staging and trash sit outside, nothing
  // else does — and a rename into a missing directory fails.
  if (await exists(target, { baseDir: BASE })) {
    await ensureDir(TRASH_DIR);
    await rename(target, aside, {
      oldPathBaseDir: BASE,
      newPathBaseDir: BASE,
    });
  }
  await ensureDir(INSTALLED_DIR);
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
  // A remove takes the same id from the same places a write does, and
  // `remove(..., { recursive: true })` on a traversed path is the more
  // destructive of the two. See EXTENSION_ID_RE.
  assertValidExtensionId(id);
  if (await exists(dirOf(id), { baseDir: BASE })) {
    await remove(dirOf(id), { baseDir: BASE, recursive: true });
  }
}
