// Getting a book's bytes onto disk without routing them through the webview.
//
// Background: Android disables Tauri's custom-protocol IPC (the webview
// can't read a request body), so every invoke — `plugin:fs|write_file`
// included — is JSON-serialized and handed to `window.ipc.postMessage`.
// Tauri's serializer expands a `Uint8Array` payload with `Array.from(bytes)`,
// one JS array element per byte, which means:
//
//   * files at/over ~128 MB throw `RangeError: Invalid array length`
//     (V8's `FixedArray::kMaxLength` is 134_217_725) before anything is
//     written — the 206 MB EPUB failure;
//   * everything smaller pays a ~4x JSON blow-up plus a serde parse, per
//     file, which is where "some books take forever" came from.
//
// `stageImportFile` sidesteps both by never reading the file in JS at all:
// Rust opens the picked path (a `content://` SAF URI on Android, a plain
// path on desktop) and streams it into app-data.
//
// `writeBytesChunked` is the fallback for bytes the app itself produced in
// memory (Sources downloads, DOCX→EPUB conversion). Those still have to
// cross the bridge, but in bounded slices, so the ceiling never applies.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BookFormat } from "./bookFormat";

/**
 * Slice size for `writeBytesChunked`. Bounded so the transient base64 string
 * stays a few MB no matter how large the book is.
 */
const CHUNK = 4 * 1024 * 1024;

/** Sub-slice for base64 encoding. `String.fromCharCode(...bytes)` is applied
 *  per sub-slice; spreading a whole 4 MB chunk would overflow the argument
 *  stack. */
const B64_STRIDE = 32 * 1024;

export interface StagedFile {
  size: number;
  format: BookFormat;
  /** Lowercase hex SHA-256 of the file's bytes, computed by Rust during the
   *  copy. Used to recognise a book the library already holds. */
  hash: string;
}

export interface StageProgress {
  /** "copy" while the file is being written, "extract" while entries are
   *  being unpacked. */
  phase: "copy" | "extract";
  /** 0..1 within the phase. */
  ratio: number;
}

/** Opaque id correlating Rust's progress events with one import. */
export function newStagingToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Subscribe to staging progress for one token. Returns an unsubscribe
 * function; call it when the import finishes so the listener doesn't leak.
 */
export async function onStageProgress(
  token: string,
  cb: (p: StageProgress) => void,
): Promise<() => void> {
  const unlisten = await listen<{
    token: string;
    phase: string;
    ratio: number;
  }>("import://progress", (event) => {
    if (event.payload.token !== token) return;
    const phase = event.payload.phase === "extract" ? "extract" : "copy";
    cb({ phase, ratio: event.payload.ratio });
  });
  return unlisten;
}

/**
 * Stream a picked file into `dest` (app-data-relative) and report what
 * format its bytes say it is. The bytes never enter JS.
 */
export async function stageImportFile(
  src: string,
  dest: string,
  token: string,
): Promise<StagedFile> {
  const staged = await invoke<{ size: number; format: string; hash: string }>(
    "stage_import_file",
    { src, dest, token },
  );
  return {
    size: staged.size,
    format: staged.format as BookFormat,
    hash: staged.hash,
  };
}

/** Base64-encode a slice without spreading it all onto the argument stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += B64_STRIDE) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + B64_STRIDE, bytes.length)),
    );
  }
  return btoa(binary);
}

/**
 * Write an in-memory buffer to `dest` in bounded slices.
 *
 * Used only for archives the app built itself — a Sources download, a DOCX
 * conversion. Anything the user picked goes through `stageImportFile`
 * instead and never crosses the bridge at all.
 *
 * Each slice travels as base64 rather than as a `Uint8Array`. That matters
 * only on Android, but it matters a lot there: Tauri's IPC serializer turns a
 * `Uint8Array` payload into one JSON array element per byte, so the same
 * 10 MB costs ~7s as bytes versus well under a second as a string — and the
 * byte path additionally dies past ~128 MB on V8's array-length limit.
 */
export async function writeBytesChunked(
  dest: string,
  bytes: Uint8Array,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
    await invoke("write_chunk_b64", {
      path: dest,
      data: toBase64(slice),
      // The first slice truncates, so a retry after a failure can't append
      // onto a partial earlier attempt.
      append: offset > 0,
    });
    onProgress?.(Math.min(1, (offset + slice.length) / bytes.length));
  }
  // An empty buffer still has to produce an (empty) file.
  if (bytes.length === 0) {
    await invoke("write_chunk_b64", { path: dest, data: "", append: false });
  }
  onProgress?.(1);
}

/** Move a staged file to its final name. Cheap — same filesystem. */
export async function renameStaged(from: string, to: string): Promise<void> {
  await invoke("rename_staged", { from, to });
}

/** Best-effort cleanup of a staged file or directory. Never throws. */
export async function deleteStaged(path: string): Promise<void> {
  try {
    await invoke("delete_staged", { path });
  } catch {
    // The caller is already on an error path; a failed cleanup shouldn't
    // replace the real error with a filesystem one.
  }
}
