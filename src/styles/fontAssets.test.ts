import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Every face the app renders is self-hosted under /public/fonts and declared
 * in global.css. Nothing verifies that pairing at runtime: a wrong path in an
 * @font-face doesn't throw, it silently falls through to the next family in
 * the stack, so a typo ships as "the Arabic looks slightly off" and nobody
 * catches it. These tests are that check.
 *
 * They also hold the WOFF2 line. The fonts were TrueType until they were
 * converted with `woff2_compress`; at 5.7 MB they were the largest single
 * thing in the bundle, and a .ttf dropped back into public/fonts is both dead
 * weight and, unreferenced, invisible.
 */

const FONT_DIR = fileURLToPath(new URL("../../public/fonts", import.meta.url));
const CSS = readFileSync(
  fileURLToPath(new URL("./global.css", import.meta.url)),
  "utf8",
);

/** Font binaries only — the OFL licence texts sit alongside them and ship too. */
const FONT_EXT = /\.(woff2?|ttf|otf)$/i;

/** Paths as they appear in the CSS, e.g. "/fonts/reading/Cairo-Variable.woff2". */
function declaredFontUrls(): string[] {
  const urls = [...CSS.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map((m) => m[1]);
  if (urls.length === 0) throw new Error("no /fonts urls found in global.css");
  return [...new Set(urls)];
}

/** Same shape, walked off disk, so the two lists can be compared directly. */
function bundledFontFiles(dir = FONT_DIR, prefix = "/fonts"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? bundledFontFiles(`${dir}/${entry.name}`, `${prefix}/${entry.name}`)
      : FONT_EXT.test(entry.name)
        ? [`${prefix}/${entry.name}`]
        : [],
  );
}

describe("bundled font assets", () => {
  const declared = declaredFontUrls();
  const bundled = bundledFontFiles();

  it.each(declared)("%s exists on disk", (url) => {
    expect(bundled).toContain(url);
  });

  it.each(declared)("%s ships as WOFF2", (url) => {
    expect(url.endsWith(".woff2")).toBe(true);
  });

  it("declares every font file it bundles", () => {
    const orphans = bundled.filter((file) => !declared.includes(file));
    expect(orphans).toEqual([]);
  });
});
