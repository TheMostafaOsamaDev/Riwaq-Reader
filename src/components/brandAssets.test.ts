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

/** The only two components that name a brand file. */
const SOURCES = ["./BrandMark.tsx", "./LibrarySidebar.tsx"].map((rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"),
);

const IMAGE_EXT = /\.(webp|png|jpg|jpeg|avif|svg)$/i;

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
