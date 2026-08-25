// Identify a book's format from its BYTES rather than its file extension.
//
// Android's file picker hands back a Storage Access Framework URI
// (`content://com.android.providers.media.documents/document/document%3A19`)
// which carries no extension at all, so extension sniffing routed every
// Android import into the EPUB parser: PDFs died in JSZip ("can't find end of
// central directory") and DOCX files — real zips — got as far as the missing
// `META-INF/container.xml` check. Magic numbers work identically on every
// platform and on files whose extension simply lies.

export type BookFormat = "pdf" | "docx" | "epub" | "unknown";

/** Local file header signature that opens every non-empty zip archive. */
const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];

/** EPUB requires an uncompressed `mimetype` entry first, so its payload lands
 *  at a fixed offset: 30-byte local header + the 8-byte name. */
const EPUB_MIMETYPE_OFFSET = 30;
const EPUB_MIMETYPE = "mimetypeapplication/epub+zip";

const decoder = new TextDecoder("latin1");

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return decoder.decode(bytes.subarray(offset, offset + length));
}

/** Zip stores entry names as plain bytes in both the local headers and the
 *  central directory, so a linear scan finds them without inflating anything.
 *  Only reached for archives — PDFs return on the header check above. */
function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const target = needle.charCodeAt(0);
  const limit = bytes.length - needle.length;
  for (let i = 0; i <= limit; i++) {
    if (bytes[i] !== target) continue;
    if (asciiAt(bytes, i, needle.length) === needle) return true;
  }
  return false;
}

/**
 * Best-effort format sniff. Returns "unknown" rather than guessing so the
 * caller can surface a real "unsupported file" error instead of failing deep
 * inside a parser with a message about central directories.
 */
export function detectBookFormat(bytes: Uint8Array): BookFormat {
  if (asciiAt(bytes, 0, 5) === "%PDF-") return "pdf";

  if (startsWith(bytes, ZIP_LOCAL_HEADER)) {
    if (asciiAt(bytes, EPUB_MIMETYPE_OFFSET, EPUB_MIMETYPE.length) === EPUB_MIMETYPE) {
      return "epub";
    }
    // Fall back to entry names: EPUBs that skip the `mimetype` convention are
    // still required to carry META-INF/container.xml; OOXML always has
    // word/document.xml.
    if (containsAscii(bytes, "META-INF/container.xml")) return "epub";
    if (containsAscii(bytes, "word/document.xml")) return "docx";
  }

  return "unknown";
}

/**
 * True when a picked "path" is really a URI whose last segment is an opaque
 * provider id (`content://…/document%3A19`) rather than a filename. Desktop
 * pickers return plain filesystem paths, which are never opaque.
 */
export function isOpaqueUri(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(path);
}
