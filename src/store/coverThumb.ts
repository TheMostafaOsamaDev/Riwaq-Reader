// Grid-sized cover thumbnails.
//
// A cover is stored at whatever resolution the EPUB or the source site
// shipped — a real library holds a 1086×1448 PNG at 2.87 MB — and renders at
// 110–200 CSS px. Nothing downscaled it, so every library paint decoded the
// full image: that one PNG alone expands to ~6 MB of RGBA.
//
// The import therefore derives a small WebP once and the UI reads that. The
// original stays on disk untouched — it is what `setCoverFromFile` replaced
// and what a future export would want — but nothing in the interface loads it.
//
// The resize runs in the webview, not Rust: Cargo.toml budgets the Android
// .so size deliberately, and handing megabytes across the JS→Rust boundary is
// pathologically slow (every byte becomes a JSON array element). Canvas is
// already present in both WKWebView and the Android WebView.

import {
  BaseDirectory,
  exists,
  readFile,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { bookDir } from "./paths";

const BASE = BaseDirectory.AppData;

/** Longest edge of a generated thumbnail. The biggest a cover ever renders is
 *  the library's `lg` card at 200×296 CSS px, so 592 is that at 2× DPI — and
 *  it also covers the novel-detail hero, which renders at 152 CSS px. */
export const THUMB_BOX = 592;

/** Encodings to try, best first. WebP is materially smaller at the same
 *  quality, but canvas WebP *encoding* is not universal — WKWebView lagged
 *  Chromium by years and silently hands back a PNG instead, which for a
 *  photographic cover is often bigger than the source. JPEG is the floor:
 *  every canvas can produce it, and a 592px JPEG is still ~2% of a 2.87 MB
 *  PNG. The file is named after whichever actually came back, so the same
 *  library works if it moves between platforms. */
const ENCODINGS = [
  { type: "image/webp", ext: "webp" },
  { type: "image/jpeg", ext: "jpg" },
] as const;

/** Basename of the derived thumbnail; the extension follows the encoding. */
export const THUMB_STEM = "cover-thumb";

/** 0.82 is where these covers stop shedding visible detail at grid size
 *  while staying an order of magnitude under the source. */
const THUMB_QUALITY = 0.82;

/** Fit `w`×`h` inside a `box`×`box` square, preserving aspect ratio and never
 *  upscaling. Null for a degenerate size — a zero-dimension canvas throws, so
 *  callers skip the thumbnail and keep the original. */
export function thumbSize(
  w: number,
  h: number,
  box: number = THUMB_BOX,
): { width: number; height: number } | null {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  const scale = Math.min(box / w, box / h, 1);
  return {
    // A very tall, thin cover rounds its width to 0 without the floor.
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** Decode `bytes`, downscale to the box, and re-encode. Returns the encoded
 *  image and the extension it should be stored under, or null when the
 *  environment can't do it or the image won't decode — never throws, because
 *  a missing thumbnail is a slow cover, not a failed import. */
export async function encodeThumb(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; ext: string } | null> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof OffscreenCanvas !== "function"
  ) {
    return null;
  }
  let bitmap: ImageBitmap | null = null;
  try {
    // `bytes.buffer` may be a view into a larger buffer; slice to be exact.
    bitmap = await createImageBitmap(
      new Blob([bytes.slice().buffer as ArrayBuffer]),
    );
    const size = thumbSize(bitmap.width, bitmap.height);
    if (!size) return null;
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    for (const { type, ext } of ENCODINGS) {
      const blob = await canvas.convertToBlob({ type, quality: THUMB_QUALITY });
      // An unsupported type is not an error — the canvas just returns PNG.
      // Checking the type is the only way to tell, so fall through to the
      // next encoding rather than storing a PNG bigger than the original.
      if (blob.type !== type) continue;
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ext };
    }
    return null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/** Shared by both public entry points below so a book's directory is only
 *  ever looked up once per call, whichever one the caller used. */
async function writeThumbInDir(
  dir: string,
  bytes: Uint8Array,
): Promise<string | null> {
  try {
    const thumb = await encodeThumb(bytes);
    if (!thumb) return null;
    const name = `${THUMB_STEM}.${thumb.ext}`;
    await writeFile(`${dir}/${name}`, thumb.bytes, { baseDir: BASE });
    return name;
  } catch {
    return null;
  }
}

/** Write `cover-thumb.<ext>` for a book from cover bytes the caller already
 *  holds. Returns the thumbnail's filename, or null if the environment can't
 *  encode or the image won't decode — in which case the UI falls back to the
 *  original. Never throws: a missing thumbnail is a slow cover, not a failed
 *  import. */
export async function writeCoverThumbFromBytes(
  bookId: string,
  bytes: Uint8Array,
): Promise<string | null> {
  return writeThumbInDir(bookDir(bookId), bytes);
}

/** Derive `cover-thumb.<ext>` for a book from its stored cover file. For
 *  callers that still hold the bytes, `writeCoverThumbFromBytes` skips the
 *  read. */
export async function writeCoverThumb(
  bookId: string,
  coverFile: string,
): Promise<string | null> {
  try {
    const dir = bookDir(bookId);
    const src = `${dir}/${coverFile}`;
    if (!(await exists(src, { baseDir: BASE }))) return null;
    return await writeThumbInDir(dir, await readFile(src, { baseDir: BASE }));
  } catch {
    return null;
  }
}
