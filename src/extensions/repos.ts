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

// Cache file name for a given repo URL. Not cryptographic — just enough to
// give each distinct repo URL its own stable slot under CACHE_DIR.
const cacheName = (url: string) =>
  `${CACHE_DIR}/${[...url]
    .reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7)
    .toString(36)
    .replace("-", "n")}.json`;

export async function listRepos(): Promise<RepoEntry[]> {
  try {
    return JSON.parse(
      await readTextFile(REPOS_FILE, { baseDir: BASE }),
    ) as RepoEntry[];
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

async function saveRepos(repos: RepoEntry[]): Promise<void> {
  await ensureExtDir(EXTENSIONS_DIR);
  await writeTextFile(REPOS_FILE, JSON.stringify(repos, null, 2), {
    baseDir: BASE,
  });
}

export async function addRepo(url: string): Promise<RepoEntry> {
  const repos = await listRepos();
  if (repos.some((r) => r.url === url)) {
    throw new Error("That repo has already been added.");
  }
  const { index } = await fetchRepoIndex(url);
  const entry: RepoEntry = {
    url,
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
}

interface TauriFetchResponse {
  status: number;
  text: string;
  headers: Record<string, string>;
}

export async function fetchRepoIndex(
  url: string,
): Promise<{ index: RepoIndex; cached: boolean; fetchedAt: string }> {
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
    await writeTextFile(cacheName(url), JSON.stringify({ index, fetchedAt }), {
      baseDir: BASE,
    });
    return { index, cached: false, fetchedAt };
  } catch (e) {
    try {
      const cached = JSON.parse(
        await readTextFile(cacheName(url), { baseDir: BASE }),
      ) as { index: RepoIndex; fetchedAt: string };
      return { index: cached.index, cached: true, fetchedAt: cached.fetchedAt };
    } catch {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
}
