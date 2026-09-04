// Feeding pdf.js a file it never holds all of.
//
// `getDocument({ data })` needs the whole PDF in JS, and openPdfDocument has
// to `slice()` that buffer because pdf.js may detach it — so a 200 MB book
// peaked at ~400 MB of webview heap, once while staging the import and again
// on every open. On Android that is enough memory pressure to make the whole
// app crawl, which is the "large files make it slow" report.
//
// pdf.js's range transport is the supported way out: it asks for byte ranges
// and we serve them from Rust, which is reading a file it already owns.

import { invoke } from "@tauri-apps/api/core";

/** Slice size we advertise to pdf.js. Small enough that one range read is a
 *  cheap invoke, large enough that a page's objects usually arrive in one. */
export const RANGE_CHUNK = 512 * 1024;

/** Read `length` bytes at `offset` from an app-data-relative path. The
 *  response is an octet-stream, so unlike the JS→Rust direction there is no
 *  JSON-array expansion to worry about. */
export async function readFileRange(
  path: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("read_file_range", {
    path,
    offset,
    length,
  });
  return new Uint8Array(buf);
}

type PdfjsModule = Pick<typeof import("pdfjs-dist"), "PDFDataRangeTransport">;
type Transport = InstanceType<
  typeof import("pdfjs-dist")["PDFDataRangeTransport"]
>;

/**
 * A `PDFDataRangeTransport` backed by a file under app-data.
 *
 * `progressiveDone: true` tells pdf.js not to wait for a progressive stream
 * that will never arrive — every byte comes through `requestDataRange`.
 */
export function createFileRangeTransport(
  pdfjs: PdfjsModule,
  path: string,
  length: number,
  initialData: Uint8Array,
): Transport {
  const transport = new pdfjs.PDFDataRangeTransport(length, initialData, true);
  transport.requestDataRange = (begin: number, end: number) => {
    void (async () => {
      try {
        transport.onDataRange(
          begin,
          await readFileRange(path, begin, end - begin),
        );
      } catch (e) {
        // There is no way to report a failed range back to pdf.js, and a
        // request that never completes hangs the document forever — so tear
        // it down and let the caller's catch deal with it.
        // eslint-disable-next-line no-console
        console.warn("[pdf] range read failed, aborting document:", e);
        transport.abort();
      }
    })();
  };
  return transport;
}
