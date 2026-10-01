import { parseReleaseNotes, type ReleaseNotes } from "./releaseNotes";

type Invoke = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

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
