// Repo bookkeeping: which catalogues we know about, and their contents.
//
// `code` and `icon` in an index are relative to the index URL itself, so a
// fork or mirror of the official repo works with no URL edits — only the
// one URL the app is told to fetch changes. A repo that cannot be reached
// falls back to its last good cached index, so the Store still lists what
// is available and can say how stale it is.
//
// Fetching goes through the existing `source_fetch` Tauri command (see
// src/sources/host.ts for the same convention) rather than
// `@tauri-apps/plugin-http`, which is not a dependency of this project.

import { invoke } from "@tauri-apps/api/core";
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { TauriFetchResponse } from "../sources/tauriFetch";
import { ensureMigrated, EXTENSIONS_DIR, isValidExtensionId } from "./storage";

const BASE = BaseDirectory.AppData;
const REPOS_FILE = `${EXTENSIONS_DIR}/repos.json`;
const CACHE_DIR = `${EXTENSIONS_DIR}/index-cache`;

export const OFFICIAL_REPO_URL =
  "https://themostafaosamadev.github.io/Riwaq-Extensions/index.min.json";

export interface RepoEntry {
  url: string;
  name: string;
  addedAt: string;
  lastFetchedAt?: string;
}

export interface RepoIndexEntry {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  language: string;
  baseUrl: string;
  description?: Record<string, string>;
  author?: string;
  code: string;
  icon?: string;
  sha256: string;
  size: number;
}

export interface RepoIndex {
  name: string;
  apiVersion: number;
  extensions: RepoIndexEntry[];
}

/** Hard ceiling on an extension bundle, enforced twice: here against the
 *  size an index DECLARES, and again in install.ts against the number of
 *  bytes actually downloaded — an index is a remote document and its `size`
 *  is a claim, not a measurement.
 *
 *  Generous by two orders of magnitude on purpose: the largest bundle the
 *  official repo has published is about 13 KB, and this is a ceiling on
 *  hostile input rather than a budget for real extensions. Without one, a
 *  repo serving a multi-gigabyte "bundle" is buffered whole before anything
 *  looks at it — worst on Android, where the process budget is small and
 *  the body then crosses the IPC bridge as JSON. */
export const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Validate a fetched index. Throws when the document itself is unusable,
 *  or when an entry cannot be verified (no valid sha256) — that rejects
 *  the WHOLE index rather than being silently dropped, because install.ts
 *  downstream refuses to write any bundle it cannot verify by hash. An
 *  entry that is merely incomplete (missing a name, say) is dropped
 *  individually so one bad extension cannot take a whole repo offline. */
export function parseRepoIndex(json: unknown): RepoIndex {
  if (!isRecord(json)) throw new Error("Repo index is not a JSON object");
  if (!Array.isArray(json.extensions)) {
    throw new Error("Repo index has no `extensions` array");
  }

  const extensions: RepoIndexEntry[] = [];
  for (const raw of json.extensions) {
    if (!isRecord(raw)) continue;
    const required = ["id", "name", "version", "baseUrl", "code"] as const;
    if (required.some((k) => typeof raw[k] !== "string" || !raw[k])) continue;
    if (!isValidExtensionId(raw.id)) {
      // The id becomes a directory name downstream (`installed/<id>`), and
      // a repo is a remote document, so `"id": "../../../evil"` is an
      // arbitrary file write the moment the user presses Install —
      // storage.ts's EXTENSION_ID_RE explains why the fs scope does not
      // stop it on Windows. Dropped like any other unusable entry rather
      // than rejecting the index, so one bad id cannot take a whole
      // repository offline; storage.ts re-asserts the same rule at the
      // write itself.
      console.warn(
        `[extensions] dropped a repo entry with an unusable id: ${JSON.stringify(raw.id)}`,
      );
      continue;
    }
    if (typeof raw.sha256 !== "string" || raw.sha256.length !== 64) {
      // A bundle we cannot verify must never reach install.ts. Say which.
      throw new Error(
        `Repo index entry "${String(raw.id)}" has no valid sha256`,
      );
    }
    if (typeof raw.size === "number" && raw.size > MAX_BUNDLE_BYTES) {
      console.warn(
        `[extensions] dropped "${String(raw.id)}": the index declares ${raw.size} bytes, over the ${MAX_BUNDLE_BYTES}-byte limit`,
      );
      continue;
    }
    extensions.push({
      id: raw.id as string,
      name: raw.name as string,
      version: raw.version as string,
      apiVersion: typeof raw.apiVersion === "number" ? raw.apiVersion : 0,
      language: typeof raw.language === "string" ? raw.language : "",
      baseUrl: raw.baseUrl as string,
      description: isRecord(raw.description)
        ? (raw.description as Record<string, string>)
        : undefined,
      author: typeof raw.author === "string" ? raw.author : undefined,
      code: raw.code as string,
      icon: typeof raw.icon === "string" ? raw.icon : undefined,
      sha256: raw.sha256,
      size: typeof raw.size === "number" ? raw.size : 0,
    });
  }

  return {
    name: typeof json.name === "string" ? json.name : "Extensions",
    apiVersion: typeof json.apiVersion === "number" ? json.apiVersion : 1,
    extensions,
  };
}

/** `code`/`icon` are relative to the index URL itself (never to `baseUrl`),
 *  so a fork or mirror of a repo needs no edits to any URL inside its
 *  index — only the one URL the app is told to fetch changes. */
export function resolveAssetUrl(repoUrl: string, relative: string): string {
  return new URL(relative, repoUrl).toString();
}

async function ensureExtDir(path: string): Promise<void> {
  if (!(await exists(path, { baseDir: BASE }))) {
    await mkdir(path, { baseDir: BASE, recursive: true });
  }
}

// Cache file name for a given repo URL, keyed by a real SHA-256 of the URL
// (not a 32-bit rolling hash — that collided for two distinct URLs within
// ~1.2e5 brute-force trials, which would let an attacker register a repo
// whose URL collides with OFFICIAL_REPO_URL's cache slot and have their
// index served as the official repo's "last good" fallback). Matches the
// hex-encoding convention install.ts uses for bundle-hash verification.
async function cacheName(url: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(url) as unknown as BufferSource,
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${CACHE_DIR}/${hex}.json`;
}

/** What repos.json actually holds.
 *
 *  It used to be a bare `RepoEntry[]`, and installs from before the
 *  Extensions manager still have one on disk — `readReposFile` reads either
 *  shape and `saveRepos` writes the object one, so the upgrade happens on
 *  the next write with no migration step. */
interface ReposFile {
  repos: RepoEntry[];
  /** When the user acknowledged the "extensions run with the app's access"
   *  notice, shown once before the first repository they add themselves.
   *  It lives beside the repo list rather than in a file of its own because
   *  it is a fact ABOUT that list — one place owns what the user has been
   *  told about repositories. */
  trustNoticeAcknowledgedAt?: string;
}

async function readReposFile(): Promise<ReposFile> {
  // Reading does not create anything, but reading TOO EARLY does: a read
  // that resolves against the un-migrated root finds no repos.json, and
  // listRepos below answers that by seeding and WRITING one — which creates
  // `riwaq/` and makes the migration decline to move. See ensureMigrated's
  // comment in storage.ts, and legacyRoot.ts's header for the consequence.
  await ensureMigrated();
  const raw = JSON.parse(
    await readTextFile(REPOS_FILE, { baseDir: BASE }),
  ) as unknown;
  if (Array.isArray(raw)) return { repos: raw as RepoEntry[] };
  if (isRecord(raw) && Array.isArray(raw.repos)) {
    return {
      repos: raw.repos as RepoEntry[],
      trustNoticeAcknowledgedAt:
        typeof raw.trustNoticeAcknowledgedAt === "string"
          ? raw.trustNoticeAcknowledgedAt
          : undefined,
    };
  }
  throw new Error("repos.json is neither a repo list nor a repos file");
}

async function writeReposFile(file: ReposFile): Promise<void> {
  // `mkdir("riwaq/extensions")` creates the `riwaq/` root. Every module
  // that can do that must await the migration first or an upgrading user's
  // library is stranded under `leaflet/` — storage.ts does it for the
  // installed-extension tree, this does it for repos.json.
  await ensureMigrated();
  await ensureExtDir(EXTENSIONS_DIR);
  await writeTextFile(REPOS_FILE, JSON.stringify(file, null, 2), {
    baseDir: BASE,
  });
}

export async function listRepos(): Promise<RepoEntry[]> {
  await ensureMigrated();
  // Absent and unreadable are different things, and this used to treat them
  // as one: any failure to read seeded the official repo and WROTE it over
  // the file, so a transient read error or a half-written repos.json
  // silently replaced every repository the user had added. Seeding is for a
  // first run only — a file that is there but cannot be parsed is surfaced,
  // not overwritten.
  if (await exists(REPOS_FILE, { baseDir: BASE })) {
    return (await readReposFile()).repos;
  }
  // First run: the official repo is pre-added but not privileged — it
  // can be removed like any other.
  const seed: RepoEntry[] = [
    {
      url: OFFICIAL_REPO_URL,
      name: "Riwaq Official Extensions",
      addedAt: new Date().toISOString(),
    },
  ];
  await saveRepos(seed);
  return seed;
}

/** Persist the repo list. Exported so `registry.loadCatalog` can stamp
 *  `lastFetchedAt` after it reaches a repo — that write belongs to the
 *  caller that knows a fetch just succeeded, not to `fetchRepoIndex`,
 *  which is also used on paths that must not touch repos.json. */
export async function saveRepos(repos: RepoEntry[]): Promise<void> {
  await ensureMigrated();
  // Read-then-write so a list update never drops the acknowledgement flag
  // that shares the file. On the first ever write there is nothing to read,
  // which is the `exists` check; a file that IS there and will not parse is
  // NOT swallowed — swallowing it dropped the acknowledgement silently and
  // then wrote the loss back, re-showing a notice the user had accepted.
  let trustNoticeAcknowledgedAt: string | undefined;
  if (await exists(REPOS_FILE, { baseDir: BASE })) {
    trustNoticeAcknowledgedAt = (await readReposFile())
      .trustNoticeAcknowledgedAt;
  }
  await writeReposFile({ repos, trustNoticeAcknowledgedAt });
}

/** Has the user already been shown — and accepted — the notice that
 *  extensions run with the app's access? Shown once, before the first
 *  repository the user adds themselves. */
export async function hasAcknowledgedTrustNotice(): Promise<boolean> {
  try {
    return Boolean((await readReposFile()).trustNoticeAcknowledgedAt);
  } catch {
    return false;
  }
}

/** Record the acknowledgement. Idempotent: a second call keeps the first
 *  timestamp rather than rewriting it. */
export async function acknowledgeTrustNotice(): Promise<void> {
  let file: ReposFile;
  try {
    file = await readReposFile();
  } catch {
    file = { repos: await listRepos() };
  }
  if (file.trustNoticeAcknowledgedAt) return;
  await writeReposFile({
    repos: file.repos,
    trustNoticeAcknowledgedAt: new Date().toISOString(),
  });
}

/** The file a repo's URL is expected to point at. A repo URL IS the index
 *  file's URL — the official one ends in it — but the natural thing to
 *  paste is the origin the index is served from, and the extensions repo's
 *  own `pnpm dev-repo` documents its loop as "add http://localhost:8787".
 *  Both must work. */
const INDEX_FILE = "index.min.json";

/** Candidate index URLs for what the user typed, in the order tried: the
 *  URL as given, then the same URL with `index.min.json` appended. The
 *  fallback is only reachable when the URL does not already name a JSON
 *  file, so a genuine 404 on a real index URL is still reported as one
 *  rather than being retried against a nonsense path. */
function indexCandidates(url: string): string[] {
  if (/\.json($|\?)/i.test(url)) return [url];
  return [url, `${url.replace(/\/+$/, "")}/${INDEX_FILE}`];
}

export async function addRepo(url: string): Promise<RepoEntry> {
  const repos = await listRepos();
  const candidates = indexCandidates(url);
  if (repos.some((r) => candidates.includes(r.url))) {
    throw new Error("That repo has already been added.");
  }

  // Whichever candidate actually resolves is what gets STORED, so repos.json
  // always holds a real index URL and nothing downstream has to re-guess.
  // resolveAssetUrl in particular resolves an extension's `code` and `icon`
  // relative to this, and it would resolve them against the wrong base if we
  // saved the origin while having fetched the index from a subpath.
  let index: RepoIndex | undefined;
  let resolved = url;
  let firstError: unknown;
  for (const candidate of candidates) {
    try {
      index = (await fetchRepoIndex(candidate)).index;
      resolved = candidate;
      break;
    } catch (e) {
      firstError ??= e;
    }
  }
  // The error reported is the one for the URL the user actually typed, not
  // whatever the appended-path attempt happened to say.
  if (!index) throw firstError;

  const entry: RepoEntry = {
    url: resolved,
    name: index.name,
    addedAt: new Date().toISOString(),
  };
  await saveRepos([...repos, entry]);
  return entry;
}

export async function removeRepo(url: string): Promise<void> {
  // Deliberately does NOT uninstall that repo's extensions: they keep
  // working and keep reading, they just stop being offered updates.
  await saveRepos((await listRepos()).filter((r) => r.url !== url));

  // Drop its cached index too, so index-cache/ doesn't grow unbounded
  // across repeated add/remove cycles.
  const cacheFile = await cacheName(url);
  if (await exists(cacheFile, { baseDir: BASE })) {
    await remove(cacheFile, { baseDir: BASE });
  }
}

export async function fetchRepoIndex(
  url: string,
): Promise<{ index: RepoIndex; cached: boolean; fetchedAt: string }> {
  // Writes the index cache under `riwaq/extensions/index-cache`, which
  // creates the root the same way — and registry.loadCatalog() reaches this
  // concurrently with the Store's initExtensions(), so it can genuinely get
  // there first. Same rule as writeReposFile above.
  await ensureMigrated();
  const cacheFile = await cacheName(url);

  let index: RepoIndex;
  let fetchedAt: string;
  // Only the fetch and the parse are in here. The cache write used to be
  // too, which meant a disk error AFTER a perfectly successful fetch fell
  // into the fallback below and reported a healthy repo as stale — or, with
  // no cache to fall back to, rethrew a filesystem error as "repo
  // unreachable".
  try {
    const resp = await invoke<TauriFetchResponse>("source_fetch", {
      url,
      options: null,
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`HTTP ${resp.status}`);
    }
    index = parseRepoIndex(JSON.parse(resp.text));
    fetchedAt = new Date().toISOString();
  } catch (e) {
    try {
      const cached = JSON.parse(
        await readTextFile(cacheFile, { baseDir: BASE }),
      ) as { index: RepoIndex; fetchedAt: string };
      return { index: cached.index, cached: true, fetchedAt: cached.fetchedAt };
    } catch {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  // The repo WAS reached and its index parsed. Failing to cache that is a
  // bookkeeping problem for the next offline launch, not a fetch failure.
  try {
    await ensureExtDir(CACHE_DIR);
    await writeTextFile(cacheFile, JSON.stringify({ index, fetchedAt }), {
      baseDir: BASE,
    });
  } catch (e) {
    console.warn("[extensions] could not cache the repo index:", e);
  }
  return { index, cached: false, fetchedAt };
}
