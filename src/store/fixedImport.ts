// Import fixed-layout books (PDF now; DOCX in a later task) into the local
// library. Parallels importEpubBytes in library.ts: writes the original file +
// a book.json descriptor + a cover under books/<id>/, and appends a library
// index entry. Pages are rendered lazily at read time, never all held in memory.

import {
  BaseDirectory,
  mkdir,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { openPdfDocument } from "../pdf/pdfjs";
import {
  appendIndexEntry,
  bookDir,
  ensureRoot,
  writeInitialState,
  type BookIndexEntry,
  type PdfBook,
} from "./library";

const BASE = BaseDirectory.AppData;

function newId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Convert an in-memory PDF into a library book: store the original bytes, a
 * PdfBook descriptor (title/author/outline from the doc's metadata), and a
 * page-1 cover; return the new index entry.
 */
export async function importPdfBytes(
  bytes: Uint8Array,
  fallbackTitle: string,
): Promise<BookIndexEntry> {
  await ensureRoot();
  const doc = await openPdfDocument(bytes);
  try {
    const id = newId("pdf");
    const dir = bookDir(id);
    await mkdir(dir, { baseDir: BASE, recursive: true });
    // Keep the original file so pages can be re-rendered / re-scanned later.
    await writeFile(`${dir}/book.pdf`, bytes, { baseDir: BASE });

    // Cover = page 1 rendered to a JPEG via an offscreen canvas. Best-effort;
    // the library falls back to a generated cover when this fails.
    let coverFile: string | undefined;
    try {
      const canvas = document.createElement("canvas");
      await doc.renderPage(0, canvas, 1.2);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.82),
      );
      if (blob) {
        coverFile = "cover.jpg";
        const buf = new Uint8Array(await blob.arrayBuffer());
        await writeFile(`${dir}/${coverFile}`, buf, { baseDir: BASE });
      }
    } catch {
      // no cover — non-fatal
    }

    const book: PdfBook = {
      id,
      kind: "pdf",
      title: doc.meta.title || fallbackTitle,
      author: doc.meta.author || "",
      pageCount: doc.pageCount,
      outline: doc.outline,
    };
    await writeTextFile(`${dir}/book.json`, JSON.stringify(book), {
      baseDir: BASE,
    });
    await writeInitialState(id);

    const entry: BookIndexEntry = {
      id,
      title: book.title,
      author: book.author,
      language: "",
      chapterCount: 0,
      pageCount: book.pageCount,
      kind: "pdf",
      addedAt: Date.now(),
      progress: 0,
      ...(coverFile ? { coverFile } : {}),
    };
    return appendIndexEntry(entry);
  } finally {
    doc.destroy();
  }
}
