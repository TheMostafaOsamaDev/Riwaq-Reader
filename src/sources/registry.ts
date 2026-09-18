// Source registry, now backed by installed extensions rather than a
// compiled-in list.
//
// The five public accessors keep their exact previous signatures, so all
// nine existing call sites are untouched. Loading is async once via
// initExtensions(); every accessor stays synchronous afterwards.

import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { buildCatalog } from "../extensions/catalog";
import { loadExtension } from "../extensions/loader";
import {
  fetchRepoIndex,
  listRepos,
  type RepoEntry,
  saveRepos,
} from "../extensions/repos";
import {
  type ExtensionManifest,
  iconPath,
  type InstalledRecord,
  listInstalled,
  type OriginRecord,
  readBundleSource,
} from "../extensions/storage";
import { createHost } from "./host";
import type { Source, SourceMetadata } from "./types";

/** Ids that have been renamed upstream. Library books persist `sourceId`,
 *  so a rename must not orphan them. App-side by design — an extension
 *  cannot declare an alias and claim another extension's id. */
const ID_ALIASES: Record<string, string> = { "kolnovel-pro": "kolnovel" };

/** The installed id an `id` should be served by.
 *
 *  A literally-installed id always wins over the alias table, so the alias
 *  is strictly a fallback for orphaned library rows — which is all it was
 *  ever for. Resolving unconditionally would let the table shadow a real
 *  extension: a repo shipping one genuinely named "kolnovel-pro" would be
 *  listed under that id by `listSources` (which reports each entry's own
 *  `meta.id`) while `getSource` handed back kolnovel's instance, or null
 *  when kolnovel is not installed — a card with `status: "ok"` that cannot
 *  be opened and whose metadata lookup answers null. */
export function resolveSourceId(id: string): string {
  return entries.has(id) ? id : (ID_ALIASES[id] ?? id);
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

/** Bumped once per successful commit of the table below, and the value
 *  `useExtensionsRevision` reads. Consumers that captured an answer from
 *  the accessors — a novel page's `source`, a library card's icon — have no
 *  other way to learn that the answer changed, because the accessors are
 *  synchronous by contract and nothing re-renders on its own when a load
 *  lands. Reading a NUMBER rather than a boolean also covers the refresh
 *  case: a source installed or removed while a card is on screen moves this
 *  even though `initialized` was already true. */
let revision = 0;
const listeners = new Set<() => void>();

/** Subscribe to registry commits. Returns the unsubscribe function, i.e.
 *  exactly `useSyncExternalStore`'s first argument. */
export function subscribeExtensions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function extensionsRevision(): number {
  return revision;
}

/** `convertFileSrc` wraps an ABSOLUTE path into the `asset://` URL the
 *  webview can load — it does not resolve anything itself. iconPath() is
 *  relative to AppData (that is what the fs plugin's `baseDir` wants), so
 *  it has to be joined onto the real app-data directory first, exactly as
 *  store/library.ts's coverSrcFor does for book covers. Passing the
 *  relative path produced a URL that resolved to nothing, and every
 *  installed source fell back to the globe placeholder.
 *
 *  Memoised like library.ts's copy: one IPC round trip per process. */
let cachedAppDataDir: string | null = null;
async function appDataRoot(): Promise<string> {
  if (cachedAppDataDir === null) cachedAppDataDir = await appDataDir();
  return cachedAppDataDir;
}

/** The finished `asset://` URL per extension id, so the `join` above is not
 *  a second IPC round trip per installed extension on every Store visit —
 *  it sat inside the per-extension loop below and was paid even when the
 *  bundle itself was a cache hit. The path is a pure function of the id and
 *  the app-data root, neither of which changes within a process, so an
 *  update or reinstall resolves to the same URL it did before (as it
 *  already did: nothing cache-busts an extension icon). */
const iconUrls = new Map<string, string>();
async function iconUrlFor(id: string): Promise<string> {
  let url = iconUrls.get(id);
  if (url === undefined) {
    url = convertFileSrc(await join(await appDataRoot(), iconPath(id)));
    iconUrls.set(id, url);
  }
  return url;
}

/** Generation counter for overlapping loads. Two can overlap — a Store
 *  mount racing a post-install refresh — and without this the one that
 *  FINISHED last would win, which is not necessarily the one that listed
 *  the newest state on disk. Each load claims a generation up front and
 *  commits only while it is still the newest. */
let generation = 0;

/** What each bundle's source text evaluated to, keyed by bundle identity:
 *  `id@sha256` — the extension's id plus the content hash the install
 *  recorded for its bundle.
 *
 *  The hash alone names the bytes; the id is in the key because the
 *  evaluated Source is bound to a host built for that id, so two extensions
 *  shipping byte-identical bundles must not share one instance. The
 *  manifest version is deliberately NOT in the key: it does not change what
 *  the bytes evaluate to, and every field the UI shows is rebuilt from the
 *  manifest on each load rather than cached, so a version bump is reflected
 *  whether or not the bundle itself changed.
 *
 *  Evaluating a bundle is a blob-URL dynamic import and real JS execution,
 *  and this function runs once per Store VISIT rather than once per app
 *  session — the Store genuinely unmounts on a tab switch. Re-listing the
 *  installed extensions every time is cheap (a readDir and two small reads
 *  each) and is what keeps the table honest about installs and removals;
 *  re-EVALUATING unchanged bundles is the part worth skipping.
 *
 *  Only deterministic outcomes are cached: a successful load, and the
 *  failures loadExtension itself returns (api-version mismatch, a bundle
 *  that throws or exports nothing). Those are functions of the bundle
 *  bytes, which the sha256 in the key pins. Environmental failures — the
 *  catch arm below, in practice a bundle file that could not be read — are
 *  NOT cached, so a transient FS error does not leave an extension broken
 *  for the rest of the session. */
const evaluated = new Map<string, Pick<Entry, "source" | "status" | "error">>();

const bundleKey = (manifest: ExtensionManifest, origin: OriginRecord) =>
  `${manifest.id}@${origin.sha256}`;

/**
 * Load every installed extension.
 *
 * Also the refresh path: safe, and now cheap, to call again after an
 * install, update or uninstall, so the Extensions manager can surface a
 * change without an app restart. The Store calls it from its own mount
 * effect rather than from app startup — see the comment at the top of
 * components/Store.tsx for why that placement is load-bearing.
 *
 * Every accessor below returns an empty/null answer until this resolves,
 * which the Store already renders as "no sources". It never rejects, so
 * calling it without a `.catch` is safe.
 *
 * The new table is built in a local map and swapped in at the end rather
 * than mutating the live one. A refresh therefore never exposes a window
 * in which the registry is empty or half-populated, which a `clear()` up
 * front would, for as long as the bundles take to evaluate.
 */
export async function initExtensions(): Promise<void> {
  const gen = ++generation;
  const next = new Map<string, Entry>();

  // Never rejects. The doc comment above tells callers they may invoke
  // this WITHOUT awaiting it, so a rejection here would be an unhandled
  // one — and listInstalled() sits outside the per-extension try below,
  // so an unreadable extensions directory would reject the whole promise.
  // On failure the previous table is left in place (a transient FS error
  // must not blank a registry that is already working) and `initialized`
  // stays false, so a later retry is still meaningful.
  let installed: InstalledRecord[];
  try {
    installed = await listInstalled();
  } catch (e) {
    console.error("[extensions] could not list installed extensions:", e);
    return;
  }

  const live = new Set<string>();

  for (const record of installed) {
    const { manifest, origin } = record;
    const meta: SourceMetadata = {
      id: manifest.id,
      name: manifest.name,
      baseUrl: manifest.baseUrl,
      language: manifest.language,
      description: manifest.description,
      iconUrl: manifest.icon ? await iconUrlFor(manifest.id) : undefined,
      version: manifest.version,
      installedFrom: origin.repoUrl,
    };

    const key = bundleKey(manifest, origin);
    live.add(key);
    const cached = evaluated.get(key);
    if (cached) {
      next.set(manifest.id, { meta, ...cached });
      continue;
    }

    try {
      const result = await loadExtension(
        manifest,
        await readBundleSource(manifest.id),
        createHost(manifest.id),
      );
      const outcome: Pick<Entry, "source" | "status" | "error"> = result.ok
        ? { source: result.source, status: "ok" }
        : {
            source: null,
            status: result.reason === "api-version" ? "api-version" : "broken",
            error: result.message,
          };
      evaluated.set(key, outcome);
      next.set(manifest.id, { meta, ...outcome });
    } catch (e) {
      // loadExtension returns its own failures; this arm is for everything
      // around it — readBundleSource on a bundle that vanished, mainly.
      // Deliberately not cached: see `evaluated`'s comment.
      next.set(manifest.id, {
        meta,
        source: null,
        status: "broken",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // A newer load claimed the registry while this one was evaluating, and
  // it listed the disk later than this one did. Committing here would
  // undo it.
  //
  // This guard comes BEFORE the cache prune below on purpose. `live` is
  // this load's view of the disk, so a stale load pruning by it would
  // delete the entries the newer load has just inserted for bundles this
  // one never saw — silently emptying the cache in exactly the overlapping
  // case it exists to survive, and then returning without committing
  // anything in exchange.
  if (gen !== generation) return;

  // Drop every bundle that is no longer installed at that exact identity,
  // so an uninstall or an update releases the old module instead of the
  // cache growing for the life of the process.
  for (const key of [...evaluated.keys()]) {
    if (!live.has(key)) evaluated.delete(key);
  }

  entries = next;
  initialized = true;
  revision++;
  // A copy, so a listener that unsubscribes itself while being notified
  // cannot perturb the iteration.
  for (const listener of [...listeners]) listener();
}

/** The memoised "the registry has been loaded at least once" path.
 *
 * `initExtensions()` is the explicit REFRESH: it re-lists the disk every
 * time, which is what the Store's mount and the Extensions manager want
 * after a mutation. This is what every other consumer wants — the registry
 * populated, once, without each of them paying for a re-list or racing the
 * others into overlapping loads.
 *
 * Placement matters and is the same argument the Store's own mount rests
 * on (see the header comment at components/Store.tsx): every caller of this
 * is reached by user navigation — a novel page, the streaming reader, the
 * search overlay — so the first extensions fs call lands long after the
 * page-load window in which this codebase's Android lock-ordering deadlock
 * is possible. It must NOT be called from app startup or from the Library's
 * mount; three separate attempts at starting extension loading inside that
 * window each reproduced the deadlock on device.
 *
 * Never rejects, for the same reason `initExtensions` does not.
 */
let loadedOnce: Promise<void> | null = null;

export function ensureExtensions(): Promise<void> {
  if (initialized) return Promise.resolve();
  loadedOnce ??= initExtensions().then(() => {
    // `initialized` is still false only when the load could not even list
    // the installed directory — a transient FS error, which initExtensions
    // deliberately swallows. Drop the memo so the next consumer to mount
    // retries instead of inheriting that one failure for the whole session.
    if (!initialized) loadedOnce = null;
  });
  return loadedOnce;
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
  // Listed ONCE and threaded into buildCatalog below. Re-listing after the
  // repo fetches would not just cost a second directory walk: an install
  // landing between the two reads would leave the catalogue describing a
  // different disk from the one the rest of this function reasoned about.
  const installed = await listInstalled();
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
  if (changed) {
    // Bookkeeping only. A disk-write failure here must not blank the
    // Extensions manager when every repo actually fetched fine.
    try {
      await saveRepos(stamped);
    } catch (e) {
      console.warn("[extensions] could not record repo fetch times:", e);
    }
  }

  return {
    repos: stamped,
    contents,
    catalog: buildCatalog(installed, contents),
  };
}
