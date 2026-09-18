// The Store's Extensions view is a merge of two lists: what is on disk and
// what the repos offer. An extension can appear in either, both, or — when
// its repo has been removed — only on disk.

import type { RepoIndexEntry } from "./repos";
import type { InstalledRecord } from "./storage";

/** Numeric-segment compare. "1.10.0" is newer than "1.9.0"; a lexical
 *  compare gets that backwards, which would silently skip updates. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export interface CatalogEntry {
  id: string;
  name: string;
  /** The newest version known for this id: the repo entry's version when
   *  one is listed and it's the newer of the two, otherwise the installed
   *  version — so the Store can render `installedVersion → version`. */
  version: string;
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
  repoUrl?: string;
  entry?: RepoIndexEntry;
  record?: InstalledRecord;
}

export interface RepoContents {
  repoUrl: string;
  entries: RepoIndexEntry[];
}

export function buildCatalog(
  installed: InstalledRecord[],
  repos: RepoContents[],
): CatalogEntry[] {
  const byId = new Map<string, CatalogEntry>();

  for (const record of installed) {
    byId.set(record.manifest.id, {
      id: record.manifest.id,
      name: record.manifest.name,
      version: record.manifest.version,
      installed: true,
      installedVersion: record.manifest.version,
      updateAvailable: false,
      repoUrl: record.origin.repoUrl,
      record,
    });
  }

  for (const { repoUrl, entries } of repos) {
    for (const entry of entries) {
      const existing = byId.get(entry.id);
      if (!existing) {
        byId.set(entry.id, {
          id: entry.id,
          name: entry.name,
          version: entry.version,
          installed: false,
          updateAvailable: false,
          repoUrl,
          entry,
        });
        continue;
      }
      if (existing.record) {
        // Installed: only the repo it was installed from may offer an
        // update. `entry`, `repoUrl`, `updateAvailable` and `version` move
        // together as one unit — installExtension() resolves entry.code
        // and entry.icon as relative to repoUrl, so a mismatched pair
        // would resolve one repo's paths against another repo's baseUrl.
        if (existing.record.origin.repoUrl !== repoUrl) continue;
        // Not a fallback: `installedVersion` is set on every entry the
        // installed loop above created, and `record` is set by that same
        // loop and nothing else — so inside this branch it is always
        // there. The `?? "0"` and `?? existing.version` that used to guard
        // the two uses below could not run, and read as if the installed
        // version were sometimes unknown here.
        const installedVersion = existing.installedVersion as string;
        const hasUpdate = compareVersions(entry.version, installedVersion) > 0;
        existing.entry = entry;
        existing.repoUrl = repoUrl;
        existing.updateAvailable = hasUpdate;
        existing.version = hasUpdate ? entry.version : installedVersion;
      }

      // Not installed: the first configured repo to list this id wins.
      // Repos are in user-configured order (the official repo pre-added),
      // so "first" is deterministic — a repo added later cannot capture an
      // id already claimed by an earlier one just by publishing a bigger
      // version number. A later repo's entry for the same id is ignored
      // outright; entry/repoUrl/version/updateAvailable are untouched.
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
