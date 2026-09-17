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
      // Only the repo an extension was installed from may offer it an
      // update. Otherwise any repo publishing the same id could hijack it.
      if (existing.record && existing.record.origin.repoUrl !== repoUrl)
        continue;
      existing.entry = entry;
      existing.updateAvailable =
        compareVersions(entry.version, existing.installedVersion ?? "0") > 0;
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
