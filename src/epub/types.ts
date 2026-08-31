/** A block-level item within a chapter — either a text paragraph or an
 *  image. Discriminated by field presence rather than an explicit `kind` so
 *  existing book.json files (which only ever stored `{ text }`) continue
 *  to load correctly without a migration pass. */
export type ChapterItem = TextItem | ImageItem;

export interface TextItem {
  /** Plain text, with inline HTML already stripped and whitespace
   *  collapsed by the parser. */
  text: string;
}

export interface ImageItem {
  /** Path relative to the book's storage directory (`books/<id>/`). The
   *  reader resolves this through Tauri's asset:// protocol. The shape
   *  matches what's on disk so image src + image file path stay in sync. */
  src: string;
  /** Optional alt text from the original `<img alt>`. */
  alt?: string;
}

/** True when the item points at an image rather than a text run. Existing
 *  book.json files store only `{ text }` — those return false here. */
export function isImageItem(item: ChapterItem): item is ImageItem {
  return "src" in item;
}

export interface EpubChapter {
  /** Unique id within the book — matches the manifest idref from the spine. */
  id: string;
  /** Relative href from the manifest, used as a cache key when following links. */
  href: string;
  /** Best-effort chapter title (from nav TOC if available, else first heading). */
  title: string;
  /** Block-level items in document order. Mostly text paragraphs; image
   *  items appear at the position they originally rendered in the source
   *  XHTML. Highlights anchor by the item's index here, so this list must
   *  not be re-indexed after the book is saved. */
  paragraphs: ChapterItem[];
  /** 0-based position in the spine. */
  order: number;
}

export interface EpubBook {
  /** Generated id for local storage. */
  id: string;
  title: string;
  author: string;
  /** BCP-47 tag from OPF `<dc:language>`. Used to auto-enable RTL for ar/he/fa/ur. */
  language: string;
  chapters: EpubChapter[];
}

/** Where the cover lives inside the archive, plus how to name it on disk.
 *
 *  A *reference*, not bytes: a cover can be several MB, and on Android any
 *  byte array that crosses the JS IPC is expanded to one JSON array element
 *  per byte. The importer hands this straight to `ZipSource.extract`, so the
 *  image goes archive → disk without passing through the webview. */
export interface EpubCoverRef {
  /** Entry name inside the EPUB zip. */
  entry: string;
  /** Canonical MIME type from the OPF manifest (e.g. `image/jpeg`). */
  mimeType: string;
  /** File extension to use on disk, lowercase, without the dot. */
  extension: string;
}

/** An in-flow image referenced by chapter content. Same reasoning as
 *  `EpubCoverRef` — the parser records *where* the image is and what it
 *  should be called, and the importer has the archive copy it to
 *  `books/<id>/<href>` natively. */
export interface EpubImageRef {
  /** Storage-relative path. Matches the `src` in the chapter's image item. */
  href: string;
  /** Entry name inside the EPUB zip. */
  entry: string;
  mimeType: string;
}

/** What `parseEpubFromSource` returns — the book plus references to the
 *  cover and in-flow images, ready to be extracted to disk. */
export interface ParsedEpub {
  book: EpubBook;
  cover?: EpubCoverRef;
  /** Images referenced from chapter content. May be empty. */
  images: EpubImageRef[];
}
