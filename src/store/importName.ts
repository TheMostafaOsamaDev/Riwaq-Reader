import { invoke } from "@tauri-apps/api/core";

/** Pull a reasonable display title out of a file path: drop the directory
 *  portion and the .docx extension, then collapse underscores/dashes to
 *  spaces. Used when the doc has no leading heading we can borrow. Empty
 *  (not "Untitled") when the stem strips to nothing — a blank title
 *  persists as "" so the display-time fallback (`common.untitled`)
 *  localizes it wherever the book is rendered, instead of freezing an
 *  English (or whatever-locale-was-active) literal into the book's own
 *  stored title. */
export function filenameTitle(path: string): string {
  // Android's picker returns a Storage Access Framework URI, and the name we
  // want is inside it, percent-encoded:
  //
  //   …/document/primary%3ADownload%2Fbook.pdf  ->  primary:Download/book.pdf
  //
  // so decoding first turns most of them back into something with a filename
  // on the end. The ones that genuinely carry no name — `document%3A19`, a
  // provider row id — fall out at the end as "not a name" rather than being
  // rejected up front, which is what used to drop the readable ones too.
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A lone `%` is not valid encoding. The raw string still has a usable
    // name on the end, so carry on with it.
  }

  // `:` splits too, for the `primary:Download/book.pdf` shape a SAF path
  // decodes to.
  const base = decoded.split(/[\\/:]/).pop() ?? decoded;

  // Any trailing extension, not just the three formats the app parses: the
  // format is sniffed from the bytes (see bookFormat.ts), so the extension
  // can be absent, wrong, or something like `.epub3`.
  const stem = base.replace(/\.[a-z0-9]{1,5}$/i, "");

  const cleaned = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  // A name has to contain a letter somewhere. `19`, `12345` and `` are row
  // ids or nothing at all; returning "" lets the display-time
  // `common.untitled` fallback localize instead of showing a number.
  return /\p{L}/u.test(cleaned) ? cleaned : "";
}

/**
 * The title to import a picked file under, asking Android for the name when
 * the path itself has none.
 *
 * [`filenameTitle`] answers for every desktop path and for the SAF URIs that
 * still spell out a folder and filename. What it cannot answer for is the
 * picker's **Recent** list — the screen it opens on, so the usual way a file
 * gets picked — which identifies the file by provider row instead:
 *
 *     content://com.android.providers.media.documents/document/document%3A32
 *
 * Nothing in that string is the name. Only the provider knows it, and the
 * `display_name` command is what asks (see src-tauri/src/display_name.rs).
 *
 * Empty string, never a throw: a missing title is cosmetic and the book still
 * imports, so no failure here may take the import down with it.
 */
export async function importName(path: string): Promise<string> {
  // Free for every path that carries its own name, which is all of desktop.
  // Checking first is also what keeps a multi-file drop from paying an IPC
  // round trip per file.
  const fromPath = filenameTitle(path);
  if (fromPath) return fromPath;

  try {
    const name = await invoke<string | null>("display_name", { path });
    // The provider returns a filename — extension, underscores and all — so
    // it needs the same cleanup a path does. That also re-applies the
    // "must contain a letter" rule, for a provider whose display name is
    // itself the row id.
    return name ? filenameTitle(name) : "";
  } catch {
    // Not Android, no such provider, permission revoked since the pick.
    return "";
  }
}
