import { parseReleaseNotes, type ReleaseNotes } from "./releaseNotes";

export type Invoke = (
  cmd: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Tauri's invoke, imported at call time (the desktop store and the notes
 *  dialog each had this wrapper). */
export async function lazyInvoke(cmd: string, args: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

/** The notes for one release, via the Rust command (the webview never touches
 *  the network). Never throws: no notes asset, offline, or a malformed file
 *  all come back as `notes: null` so the caller can fall back gracefully. */
export async function fetchNotes(
  invokeImpl: Invoke,
  version: string,
): Promise<{ notes: ReleaseNotes | null; highlightImage?: string }> {
  try {
    const r = (await invokeImpl("fetch_release_notes", { version })) as {
      notes?: unknown;
      highlightImage?: unknown;
    };
    const notes = parseReleaseNotes(r?.notes);
    const img =
      typeof r?.highlightImage === "string" &&
      r.highlightImage.startsWith("data:image/webp;base64,")
        ? r.highlightImage
        : undefined;
    return { notes, highlightImage: img };
  } catch {
    return { notes: null };
  }
}
