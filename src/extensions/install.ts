// Download → verify → write. Verification happens before anything touches
// the installed/ directory, so a tampered or truncated bundle never lands
// on disk at all, let alone gets evaluated.
//
// That is about the BUNDLE. The icon is fetched and written unverified,
// because the repo index format carries no hash for it — there is nothing
// to check it against. It is treated as what it is: a cosmetic file that is
// never executed, whose fetch failure is swallowed, and which is rendered
// through `asset://` as an image. See the icon block below.

import { invoke } from "@tauri-apps/api/core";
import {
  MAX_BUNDLE_BYTES,
  resolveAssetUrl,
  type RepoIndexEntry,
} from "./repos";
import { removeInstalled, writeInstalled } from "./storage";

/** An extension icon is a small square PNG. Same reasoning as
 *  MAX_BUNDLE_BYTES, one order of magnitude down. */
const MAX_ICON_BYTES = 512 * 1024;

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
  // No cast: Uint8Array's constructor already handles both arms of
  // ArrayBuffer | number[] correctly (buffer view vs. element copy from an
  // array-like) — see the identical convention/comment in
  // src/sources/host.ts's fetchBytes. Casting to ArrayBuffer here would
  // assert something that's false for the number[] arm.
  return new Uint8Array(buf);
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
  // Checked against what was actually downloaded, not only against the
  // `size` the index declared: the index is a remote document, so its size
  // is a claim. Checked BEFORE hashing, so a hostile body is dropped rather
  // than digested.
  if (codeBytes.byteLength > MAX_BUNDLE_BYTES) {
    throw new Error(
      `"${entry.name}" downloaded ${codeBytes.byteLength} bytes, over the ` +
        `${MAX_BUNDLE_BYTES}-byte limit for an extension bundle. Nothing was installed.`,
    );
  }
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
    // Unverified, and deliberately so: the index format carries no icon
    // hash, so there is nothing to verify it against. It is never
    // evaluated — it is written to icon.png and rendered as an <img> via
    // `asset://` — and a missing or oversized one is cosmetic, so it is
    // dropped rather than failing an otherwise-verified install. If the
    // index ever grows an icon hash, check it here.
    try {
      const bytes = await fetchBytes(resolveAssetUrl(repoUrl, entry.icon));
      icon = bytes.byteLength <= MAX_ICON_BYTES ? bytes : undefined;
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
      // Keyed on whether the icon bytes were actually fetched (`icon`),
      // not on whether the index declared one (`entry.icon`) — a failed
      // icon fetch is swallowed above as cosmetic, and the manifest must
      // not then claim a file that was never written to disk.
      icon: icon ? "icon.png" : undefined,
    },
    icon,
    origin: { repoUrl, sha256: actual, installedAt: new Date().toISOString() },
  });
}

export async function uninstallExtension(id: string): Promise<void> {
  await removeInstalled(id);
}
