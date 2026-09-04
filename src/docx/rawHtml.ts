// The worker-safe half of the DOCX pipeline: unzip, detect direction, run
// mammoth. No DOM here — the sanitize/outline pass needs DOMParser and stays
// on the main thread (see toFixedDoc.ts).
//
// Measured on a real 8.9 MB Arabic document with 109 images: 24 ms to unzip
// and sniff direction, 111 ms in mammoth, against 3 ms for the DOM pass. On a
// phone that ~135 ms becomes something closer to half a second of frozen UI,
// which is why this half is worth moving off the main thread.

import JSZip from "jszip";
import { detectDocDirection, type Dir } from "./detectDirection";

export interface RawDocx {
  /** mammoth's HTML, unsanitized. */
  html: string;
  images: { href: string; bytes: Uint8Array }[];
  dir: Dir;
}

// Mammoth's browser bundle is ~700KB — lazy-load it so it doesn't ship on app
// start (Vite code-splits at the dynamic import; first .docx import pays the
// one-time webview-cached cost).
async function loadMammoth() {
  const m = await import("mammoth/mammoth.browser");
  return m.default;
}

function extensionFromMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/bmp":
      return "bmp";
    case "image/tiff":
      return "tiff";
    default:
      return "bin";
  }
}

export async function docxToRawHtml(fileBytes: Uint8Array): Promise<RawDocx> {
  // JSZip wants the underlying buffer; Tauri's readFile may hand back a view
  // over a larger buffer, so slice cleanly when it isn't exact.
  const arrayBuffer =
    fileBytes.byteOffset === 0 &&
    fileBytes.byteLength === fileBytes.buffer.byteLength
      ? (fileBytes.buffer as ArrayBuffer)
      : (fileBytes.slice().buffer as ArrayBuffer);

  const zip = await JSZip.loadAsync(arrayBuffer);
  const { dir } = await detectDocDirection(zip);

  const mammoth = await loadMammoth();
  const images: { href: string; bytes: Uint8Array }[] = [];
  let imgN = 0;
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buffer = await image.readAsArrayBuffer();
        const bytes = new Uint8Array(buffer);
        imgN += 1;
        const href = `images/img-${String(imgN).padStart(3, "0")}.${extensionFromMime(image.contentType)}`;
        images.push({ href, bytes });
        return { src: href };
      }),
    },
  );

  return { html: result.value, images, dir };
}
