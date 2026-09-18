// Source registry, now backed by installed extensions rather than a
// compiled-in list.
//
// The five public accessors keep their exact previous signatures, so all
// nine existing call sites are untouched. Loading is async once via
// initExtensions(); every accessor stays synchronous afterwards.

import { convertFileSrc } from "@tauri-apps/api/core";
import { buildCatalog } from "../extensions/catalog";
import { loadExtension } from "../extensions/loader";
import {
  fetchRepoIndex,
  listRepos,
  type RepoEntry,
  saveRepos,
} from "../extensions/repos";
import {
  iconPath,
  listInstalled,
  readBundleSource,
} from "../extensions/storage";
import { createHost } from "./host";
import type { Source, SourceMetadata } from "./types";

/** Ids that have been renamed upstream. Library books persist `sourceId`,
 *  so a rename must not orphan them. App-side by design — an extension
 *  cannot declare an alias and claim another extension's id. */
const ID_ALIASES: Record<string, string> = { "kolnovel-pro": "kolnovel" };

export function resolveSourceId(id: string): string {
  return ID_ALIASES[id] ?? id;
}

type Status = "ok" | "broken" | "api-version" | "missing";

interface Entry {
  meta: SourceMetadata;
  source: Source | null;
  status: Status;
  error?: string;
}

let entries = new Map<string, Entry>();
let initialized = false;

/**
 * Load every installed extension. Safe to call again after an install or
 * uninstall.
 *
 * Deliberately NOT awaited before React mounts — see main.tsx on the
 * Android blank launch. Every accessor below returns an empty/null answer
 * until this resolves, which the Store already renders as "no sources".
 *
 * The new table is built in a local map and swapped in at the end rather
 * than mutating the live one. A refresh therefore never exposes a window
 * in which the registry is empty or half-populated, which a `clear()` up
 * front would, for as long as the bundles take to evaluate.
 */
export async function initExtensions(): Promise<void> {
  const next = new Map<string, Entry>();
  const installed = await listInstalled();

  for (const record of installed) {
    const { manifest, origin } = record;
    const meta: SourceMetadata = {
      id: manifest.id,
      name: manifest.name,
      baseUrl: manifest.baseUrl,
      language: manifest.language,
      description: manifest.description,
      iconUrl: manifest.icon
        ? convertFileSrc(iconPath(manifest.id))
        : undefined,
      version: manifest.version,
      installedFrom: origin.repoUrl,
    };

    try {
      const result = await loadExtension(
        manifest,
        await readBundleSource(manifest.id),
        createHost(manifest.id),
      );
      next.set(
        manifest.id,
        result.ok
          ? { meta, source: result.source, status: "ok" }
          : {
              meta,
              source: null,
              status:
                result.reason === "api-version" ? "api-version" : "broken",
              error: result.message,
            },
      );
    } catch (e) {
      // loadExtension returns its own failures; this arm is for everything
      // around it — readBundleSource on a bundle that vanished, mainly.
      next.set(manifest.id, {
        meta,
        source: null,
        status: "broken",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  entries = next;
  initialized = true;
}

export function isInitialized(): boolean {
  return initialized;
}

/** List metadata for every source that loaded successfully. Broken and
 *  contract-mismatched extensions are excluded — they cannot be browsed,
 *  and the Extensions manager surfaces them separately via
 *  getExtensionStatus. */
export function listSources(): SourceMetadata[] {
  return [...entries.values()]
    .filter((e) => e.status === "ok")
    .map((e) => e.meta);
}

/** Catalog metadata for a single source by id, or null when not installed. */
export function getSourceMeta(id: string): SourceMetadata | null {
  return entries.get(resolveSourceId(id))?.meta ?? null;
}

/** The constructed Source for an id, or null when it is not installed or
 *  failed to load. */
export function getSource(id: string): Source | null {
  return entries.get(resolveSourceId(id))?.source ?? null;
}

export function getExtensionStatus(id: string): Status {
  return entries.get(resolveSourceId(id))?.status ?? "missing";
}

export function getExtensionError(id: string): string | undefined {
  return entries.get(resolveSourceId(id))?.error;
}

/** Find the first loaded source whose `canHandle(url)` returns true. Used
 *  by the import dialog to auto-pick a source from a pasted URL. */
export function findSourceForUrl(url: string): Source | null {
  for (const entry of entries.values()) {
    if (entry.source?.canHandle(url)) return entry.source;
  }
  return null;
}

/** Installed + available, for the Extensions manager. */
export async function loadCatalog() {
  const repos = await listRepos();
  const contents = await Promise.all(
    repos.map(async (repo) => {
      try {
        const { index, cached, fetchedAt } = await fetchRepoIndex(repo.url);
        return {
          repoUrl: repo.url,
          entries: index.extensions,
          cached,
          fetchedAt,
          error: undefined as string | undefined,
        };
      } catch (e) {
        return {
          repoUrl: repo.url,
          entries: [],
          cached: false,
          fetchedAt: undefined as string | undefined,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  // Stamp the repos we actually reached. `cached: true` means the network
  // failed and the last good index was replayed, so it is NOT a fetch and
  // must not refresh the timestamp — otherwise a permanently unreachable
  // repo reads as freshly checked every time the Store opens.
  //
  // This lives here rather than in fetchRepoIndex on purpose: repos.json is
  // this function's business, and fetchRepoIndex is also called from paths
  // (addRepo) that must not rewrite the list mid-update.
  let changed = false;
  const stamped: RepoEntry[] = repos.map((repo, i) => {
    const c = contents[i];
    if (c.error || c.cached || repo.lastFetchedAt === c.fetchedAt) return repo;
    changed = true;
    return { ...repo, lastFetchedAt: c.fetchedAt };
  });
  if (changed) await saveRepos(stamped);

  return {
    repos: stamped,
    contents,
    catalog: buildCatalog(await listInstalled(), contents),
  };
}
