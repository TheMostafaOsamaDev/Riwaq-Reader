import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The phoenix ships from /public/brand and is referenced by path, not by
 * import, so nothing type-checks the pairing: a wrong filename in an <img src>
 * doesn't throw, it paints a broken-image glyph where the brand should be.
 * On the sidebar that is a 34px hole next to the wordmark, which is easy to
 * miss in review and easier to miss in a screenshot. These tests are that
 * check.
 *
 * They also hold the WebP line. The four files were full-resolution PNG until
 * they were re-encoded (scripts/brand-to-webp.sh) — 1,076 KB to render a 34px
 * mark and a 56px one, a tenth of the whole dist payload. A .png dropped back
 * into public/brand is both dead weight and, unreferenced, invisible.
 */

const BRAND_DIR = fileURLToPath(new URL("../../public/brand", import.meta.url));

/** Everything that names a brand file by path. index.html is in the list
 *  because the boot splash uses the transparent marks as both its picture and
 *  its CSS mask — and being inline HTML, a typo there is checked by nothing
 *  else in the toolchain. */
const SOURCES = [
  "./BrandMark.tsx",
  "./LibrarySidebar.tsx",
  "../../index.html",
].map((rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"),
);

const IMAGE_EXT = /\.(webp|png|jpg|jpeg|avif|svg)$/i;

/** Android resources cannot reference anything outside `res/`, so the boot
 *  splash's launch-window mark is a byte copy of the web one. The copy is
 *  unavoidable; the copy drifting is not. */
const ANDROID_MARK_COPIES: [string, string][] = [
  ["mark-ink.webp", "boot_mark_ink.webp"],
  ["mark-cream.webp", "boot_mark_cream.webp"],
];

const ANDROID_DRAWABLE_DIR = fileURLToPath(
  new URL(
    "../../src-tauri/gen/android/app/src/main/res/drawable-nodpi",
    import.meta.url,
  ),
);

/** Paths as they appear in the components, e.g. "/brand/mark-ink.webp". */
function referencedBrandUrls(): string[] {
  const urls = SOURCES.flatMap((src) => [
    ...src.matchAll(/"(\/brand\/[^"]+)"/g),
  ]).map((m) => m[1]);
  if (urls.length === 0) throw new Error("no /brand urls found in components");
  return [...new Set(urls)];
}

/** Same shape, walked off disk, so the two lists can be compared directly. */
function bundledBrandFiles(): string[] {
  return readdirSync(BRAND_DIR)
    .filter((name) => IMAGE_EXT.test(name))
    .map((name) => `/brand/${name}`);
}

describe("bundled brand assets", () => {
  const referenced = referencedBrandUrls();
  const bundled = bundledBrandFiles();

  it.each(referenced)("%s exists on disk", (url) => {
    expect(bundled).toContain(url);
  });

  it.each(referenced)("%s ships as WebP", (url) => {
    expect(url.endsWith(".webp")).toBe(true);
  });

  it("references every brand file it bundles", () => {
    const orphans = bundled.filter((file) => !referenced.includes(file));
    expect(orphans).toEqual([]);
  });
});

describe("the Android launch window's copy of the mark", () => {
  it.each(ANDROID_MARK_COPIES)(
    "%s is byte-identical to its drawable %s",
    (web, android) => {
      // MainActivity draws this on the activity window for the stretch between
      // the system splash dismissing and the webview's first paint, and
      // index.html draws the web one immediately after. If they differ, the
      // phoenix visibly changes mid-launch — the exact seam the whole feature
      // exists to close.
      const fromWeb = readFileSync(`${BRAND_DIR}/${web}`);
      const fromAndroid = readFileSync(`${ANDROID_DRAWABLE_DIR}/${android}`);
      expect(fromAndroid.equals(fromWeb)).toBe(true);
    },
  );

  it("keeps them in drawable-nodpi, so they are not decoded upscaled", () => {
    // An unqualified `res/drawable/` is treated as mdpi, so a 3x device
    // decodes the 136x147 mark to ~408x441 (~720KB) and setLayerSize then
    // scales it back down — two resamples and a large allocation on the very
    // first statement of the activity lifecycle.
    expect(ANDROID_DRAWABLE_DIR.endsWith("drawable-nodpi")).toBe(true);
  });
});
