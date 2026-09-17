// Download → verify → write. Verification happens before anything touches
// the installed/ directory, so a tampered or truncated bundle never lands
// on disk at all, let alone gets evaluated.

import { invoke } from "@tauri-apps/api/core";
import { resolveAssetUrl, type RepoIndexEntry } from "./repos";
import { removeInstalled, writeInstalled } from "./storage";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function defaultFetchBytes(url: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer | number[]>("source_fetch_bytes", {
    url,
    options: null,
  });
  return new Uint8Array(buf as ArrayBuffer);
}

export interface InstallDeps {
  fetchBytes?: (url: string) => Promise<Uint8Array>;
}

export async function installExtension(
  repoUrl: string,
  entry: RepoIndexEntry,
  deps: InstallDeps = {},
): Promise<void> {
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;

  const codeBytes = await fetchBytes(resolveAssetUrl(repoUrl, entry.code));
  const actual = await sha256Hex(codeBytes);
  if (actual !== entry.sha256.toLowerCase()) {
    throw new Error(
      `Checksum mismatch for "${entry.name}". The repo lists ` +
        `${entry.sha256.slice(0, 12)}… but the downloaded bundle hashes to ` +
        `${actual.slice(0, 12)}…. Nothing was installed.`,
    );
  }

  let icon: Uint8Array | undefined;
  if (entry.icon) {
    // A missing icon is cosmetic — never fail an otherwise-verified install.
    try {
      icon = await fetchBytes(resolveAssetUrl(repoUrl, entry.icon));
    } catch {
      icon = undefined;
    }
  }

  await writeInstalled(entry.id, {
    source: new TextDecoder().decode(codeBytes),
    manifest: {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      apiVersion: entry.apiVersion,
      language: entry.language,
      baseUrl: entry.baseUrl,
      description: entry.description,
      author: entry.author,
      icon: entry.icon ? "icon.png" : undefined,
    },
    icon,
    origin: { repoUrl, sha256: actual, installedAt: new Date().toISOString() },
  });
}

export async function uninstallExtension(id: string): Promise<void> {
  await removeInstalled(id);
}
