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
import { EXTENSIONS_DIR } from "./storage";

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
    if (typeof raw.sha256 !== "string" || raw.sha256.length !== 64) {
      // A bundle we cannot verify must never reach install.ts. Say which.
      throw new Error(
        `Repo index entry "${String(raw.id)}" has no valid sha256`,
      );
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
  await ensureExtDir(EXTENSIONS_DIR);
  await writeTextFile(REPOS_FILE, JSON.stringify(file, null, 2), {
    baseDir: BASE,
  });
}

export async function listRepos(): Promise<RepoEntry[]> {
  try {
    return (await readReposFile()).repos;
  } catch {
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
}

/** Persist the repo list. Exported so `registry.loadCatalog` can stamp
 *  `lastFetchedAt` after it reaches a repo — that write belongs to the
 *  caller that knows a fetch just succeeded, not to `fetchRepoIndex`,
 *  which is also used on paths that must not touch repos.json. */
export async function saveRepos(repos: RepoEntry[]): Promise<void> {
  // Read-then-write so a list update never drops the acknowledgement flag
  // that shares the file. The read is one small JSON file, and on the first
  // ever write there is nothing to read.
  let trustNoticeAcknowledgedAt: string | undefined;
  try {
    trustNoticeAcknowledgedAt = (await readReposFile())
      .trustNoticeAcknowledgedAt;
  } catch {
    trustNoticeAcknowledgedAt = undefined;
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

interface TauriFetchResponse {
  status: number;
  text: string;
  headers: Record<string, string>;
}

export async function fetchRepoIndex(
  url: string,
): Promise<{ index: RepoIndex; cached: boolean; fetchedAt: string }> {
  const cacheFile = await cacheName(url);
  try {
    const resp = await invoke<TauriFetchResponse>("source_fetch", {
      url,
      options: null,
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const index = parseRepoIndex(JSON.parse(resp.text));
    const fetchedAt = new Date().toISOString();
    await ensureExtDir(CACHE_DIR);
    await writeTextFile(cacheFile, JSON.stringify({ index, fetchedAt }), {
      baseDir: BASE,
    });
    return { index, cached: false, fetchedAt };
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
}
