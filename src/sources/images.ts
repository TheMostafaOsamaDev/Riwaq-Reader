// Image URL helpers shared across the Sources subsystem.
//
// The big win here is `optimizedCoverUrl` — WordPress (the platform every
// source we ship for so far is built on) auto-generates resized variants
// for every image upload, named `<basename>-<W>x<H>.<ext>`. Cards display
// at ~140px wide, so feeding them the original 1500×2000 file is 30–50×
// more bandwidth + decode cost than necessary. We rewrite the URL to a
// thumbnail variant and rely on the caller's image error-handler to fall
// back to the original when the specific size wasn't generated.

/**
 * Try to derive a thumbnail URL for a WordPress-served image. Returns
 * the original URL untouched when:
 *   - it already looks like a thumbnail (filename ends with `-WxH.<ext>`)
 *   - the URL pattern doesn't match a WordPress upload
 *   - the file extension is one where resizing is unlikely (e.g. .svg)
 *
 * `targetHeight` is a *hint* — WordPress's default cover sizes for
 * 2:3 aspect-ratio uploads land at heights of 200, 300, 400. The most
 * commonly generated variant for novel covers on the sites we scrape is
 * 225×300, so the default is 300. Pass a larger value (e.g. 600) for
 * the novel detail page where the cover renders larger.
 */
export function optimizedCoverUrl(
  originalUrl: string,
  targetHeight: number = 300,
): string {
  if (!isResizableImage(originalUrl)) return originalUrl;
  if (alreadyHasThumbnailSuffix(originalUrl)) return originalUrl;
  // We don't know the source aspect ratio, so we can't compute the
  // exact width WordPress used. The common variants are:
  //   targetHeight = 300  → ~200×300 to ~225×300 depending on aspect
  //   targetHeight = 400  → ~300×400
  //   targetHeight = 600  → ~450×600
  // Pick the height-anchored variant for portrait covers — width is
  // ignored because WordPress derives both dimensions from the original
  // aspect ratio. The string we produce is *suffix matching* against
  // what WordPress generated.
  const width = Math.round(targetHeight * 0.75); // 3:4 default
  return rewriteWithThumbnailSuffix(originalUrl, width, targetHeight);
}

function isResizableImage(url: string): boolean {
  const lower = url.toLowerCase().split("?")[0];
  return /\.(jpe?g|png|webp)$/i.test(lower);
}

function alreadyHasThumbnailSuffix(url: string): boolean {
  const base = url.split("?")[0];
  return /-\d{2,4}x\d{2,4}\.[a-z0-9]+$/i.test(base);
}

function rewriteWithThumbnailSuffix(
  url: string,
  width: number,
  height: number,
): string {
  // Operate on path only — keep query string and hash intact so caching
  // / CDN signatures continue to work.
  const m = url.match(/^([^?#]+)(\?[^#]*)?(#.*)?$/);
  if (!m) return url;
  const [, path, query = "", hash = ""] = m;
  const dot = path.lastIndexOf(".");
  if (dot < 0) return url;
  const base = path.slice(0, dot);
  const ext = path.slice(dot);
  return `${base}-${width}x${height}${ext}${query}${hash}`;
}

/**
 * Detect whether a loaded image is actually KolNovel's "Could not get
 * image!" placeholder. The site responds with HTTP 200 for nonexistent
 * thumbnail sizes and serves a 600×330 landscape JPEG instead — so the
 * `onError` handler never fires, and a naive caller would show the
 * placeholder permanently. Real novel covers are always portrait
 * (height > width), so a clearly-landscape image where one was expected
 * is a strong signal that the thumbnail variant wasn't generated.
 *
 * Pass the image element after `onLoad` fires. Returns true when the
 * image is suspected of being a placeholder.
 */
export function looksLikeMissingPlaceholder(img: HTMLImageElement): boolean {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w === 0 || h === 0) return false;
  // Aspect-ratio threshold of 1.2 catches the 600×330 placeholder
  // (1.82:1) comfortably without flagging any real cover, including
  // wide-aspect manga panels (typically 1.5:1 portrait at the most
  // landscape-y).
  return w / h > 1.2;
}
