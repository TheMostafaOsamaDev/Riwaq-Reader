# KolNovel Pro Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "KolNovel Pro" source that imports `kolnovel.com`'s per-chapter PDFs (translated text + official illustrations) into the library as reflowable, fully-offline EPUBs.

**Architecture:** A new TS source (`kolnovel-pro`) reuses the existing KolNovel WordPress-theme discovery code (extracted into a shared `kolnovel-theme.ts`). Its `getChapterContent` resolves each chapter's PDF via the site's `ts_ln_dl_url` token flow, downloads it through the Rust HTTP bridge, and parses it in the webview with pdf.js into `SourceLine[]` (NFKC-normalized text + extracted illustration bytes). A new optional `Source.resolveImage(ref)` hook lets the importer bake the PDF-extracted image bytes into the EPUB.

**Tech Stack:** TypeScript, React 19, Vite 8, Tauri 2 (reqwest HTTP bridge), `pdfjs-dist` (new), `jszip` (existing EPUB builder).

**Spec:** `docs/superpowers/specs/2026-05-30-kolnovel-pro-source-design.md`

**Testing note:** This repo has no unit-test runner (none in `package.json`; the prior KolNovel spec verifies manually). Adding one is out of scope per the spec. Every task's automated gate is therefore `npx tsc --noEmit` (type-check; the repo's `build` script is `tsc && vite build`). Integration is verified manually with `npm run tauri dev` + devtools, exactly as the existing sources are.

---

## File Structure

**New files**
- `src/sources/extensions/kolnovel-theme.ts` — shared WordPress-theme DOM parsers (home, search, novel, volumes) lifted out of `kolnovel.ts`, each parameterized by base URL. One responsibility: turn KolNovel-theme HTML into `Source*` data.
- `src/sources/pdf/pdfChapter.ts` — pdf.js wrapper. One responsibility: turn PDF bytes into `SourceLine[]` (text + image refs), lazy-loading pdf.js + its worker.
- `src/sources/extensions/kolnovel-pro.ts` — the new `Source`. One responsibility: wire theme discovery + the PDF chapter pipeline + image resolution for `kolnovel.com`.

**Modified files**
- `src/sources/types.ts` — add the optional `resolveImage?` method to `Source`.
- `src/sources/importer.ts` — `downloadInlineImages` consults `source.resolveImage` before `host.fetchBytes`.
- `src/sources/extensions/kolnovel.ts` — delegate discovery to `kolnovel-theme.ts`; tighten `canHandle` to `free.kolnovel.com`.
- `src/sources/registry.ts` — register `kolnovel-pro`.
- `package.json` / lockfile — add `pdfjs-dist`.

**Task order** (each builds on the last): 1 dependency → 2 `resolveImage` hook → 3 theme refactor → 4 pdf.js wrapper → 5 the source + registration → 6 end-to-end manual verification.

---

## Task 1: Add the pdf.js dependency

**Files:**
- Modify: `package.json` (+ lockfile, auto)

- [ ] **Step 1: Install pdfjs-dist**

Run:
```bash
npm install pdfjs-dist@^4.7.76
```
Expected: `package.json` `dependencies` gains `"pdfjs-dist": "^4.7.76"`; lockfile updates. (Any `4.x` is fine; pin whatever resolves.)

- [ ] **Step 2: Verify the worker entry exists in the installed package**

Run:
```bash
ls node_modules/pdfjs-dist/build/pdf.worker.min.mjs && node -e "console.log(require('pdfjs-dist/package.json').version)"
```
Expected: the path prints (file exists) and a `4.x` version prints. If the filename differs (e.g. no `.min`), note the actual name — it's used verbatim in Task 4 Step 1.

- [ ] **Step 3: Verify the project still type-checks and builds**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both succeed (adding a dependency changes no source yet).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(sources): add pdfjs-dist for PDF chapter parsing"
```

---

## Task 2: Add the `resolveImage` hook to the Source contract + importer

This is additive and independent — existing sources don't implement `resolveImage`, so their behavior is unchanged. Do it before the new source so the integration point exists.

**Files:**
- Modify: `src/sources/types.ts:283` (inside the `Source` interface, after `getChapterContent`)
- Modify: `src/sources/importer.ts:158-164` (call site) and `src/sources/importer.ts:312-349` (`downloadInlineImages`)

- [ ] **Step 1: Add the optional method to the `Source` interface**

In `src/sources/types.ts`, immediately after the `getChapterContent(chapter: SourceChapter): Promise<SourceLine[]>;` line (the last member of `Source`), add:

```ts
  /** Populate `lines` for one chapter. */
  getChapterContent(chapter: SourceChapter): Promise<SourceLine[]>;

  /** Optional. When a source emits image SourceLines whose `content` is NOT
   *  a host-fetchable URL (e.g. images extracted from a downloaded PDF), the
   *  importer calls resolveImage(content) to obtain the bytes out-of-band
   *  instead of host.fetchBytes. Return null to fall back to URL fetch.
   *  The returned shape matches the importer's internal DownloadedImage. */
  resolveImage?(
    ref: string,
  ): Promise<{ bytes: Uint8Array; mimeType: string; extension: string } | null>;
```

(Replace the existing single `getChapterContent` declaration with the block above so the new method sits right after it.)

- [ ] **Step 2: Thread `source` into `downloadInlineImages` and consult `resolveImage`**

In `src/sources/importer.ts`, change the `downloadInlineImages` **signature and body** (currently lines 312-349). Replace:

```ts
async function downloadInlineImages(
  chapters: FlatChapter[],
  host: SourceHost,
  onProgress: (done: number, total: number) => void,
): Promise<InlineImageResult> {
```

with:

```ts
async function downloadInlineImages(
  source: Source,
  chapters: FlatChapter[],
  host: SourceHost,
  onProgress: (done: number, total: number) => void,
): Promise<InlineImageResult> {
```

Then, inside the `for` loop over `urls`, replace this line (currently `importer.ts:336`):

```ts
      const dl = await downloadImage(url, host);
```

with:

```ts
      // PDF-style sources hold extracted image bytes in-memory and expose
      // them via resolveImage; only fall back to a network fetch when the
      // source can't resolve the ref itself.
      const dl =
        (await source.resolveImage?.(url)) ?? (await downloadImage(url, host));
```

- [ ] **Step 3: Update the call site to pass `source`**

In `src/sources/importer.ts`, the call inside `importFromSource` (currently lines 158-164). Replace:

```ts
    const { imageMap, images: epubImages } = await downloadInlineImages(
      chapters,
      host,
      (done, total) => {
        setStepLabel("images", `Downloading inline images (${done}/${total})`);
      },
    );
```

with:

```ts
    const { imageMap, images: epubImages } = await downloadInlineImages(
      source,
      chapters,
      host,
      (done, total) => {
        setStepLabel("images", `Downloading inline images (${done}/${total})`);
      },
    );
```

- [ ] **Step 4: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: PASS. (`source` is already in scope in `importFromSource`; the optional-chaining call needs no other change. `DownloadedImage` and the `resolveImage` return shape are structurally identical, so `??` type-checks.)

- [ ] **Step 5: Commit**

```bash
git add src/sources/types.ts src/sources/importer.ts
git commit -m "feat(sources): add optional Source.resolveImage hook for out-of-band image bytes"
```

---

## Task 3: Extract shared theme parsers; tighten free-KolNovel routing

A behavior-preserving refactor: move the pure DOM→data parsers out of `kolnovel.ts` into `kolnovel-theme.ts`, parameterized by base URL, so the new source can reuse them. Then make both sources' `canHandle` precise so a pasted URL routes to exactly one source.

**Files:**
- Create: `src/sources/extensions/kolnovel-theme.ts`
- Modify: `src/sources/extensions/kolnovel.ts` (remove the moved functions; delegate; tighten `canHandle`; fix imports)

- [ ] **Step 1: Create `kolnovel-theme.ts` by moving the parser functions**

Create `src/sources/extensions/kolnovel-theme.ts`. **Move** the following functions **verbatim** out of `kolnovel.ts` into this new file, keeping each body unchanged **except** for the base-URL parameterization described in Step 2:

- `parseHomeSections`, `parseSectionElement`, `parseTrendArea`, `parseHomeHot`, `parseCardsInListupd`, `parseUtaoCard`, `parseBsCard`
- `parseSearchResults`
- `parseNovelPage`, `parseVolumes`
- helpers: `cleanTitle`, `sanitizeTitle`, `pickImageSrc`, `extractDescriptionText`

Start the file with:

```ts
// Shared KolNovel WordPress-theme parsers. Both the free source
// (free.kolnovel.com) and the pro source (kolnovel.com) render their browse,
// search, and novel pages with the same theme, so the DOM→data parsing lives
// here once and is parameterized by base URL. Chapter-body extraction is NOT
// here — it differs per source (free = HTML, pro = PDF).

import { absolutizeUrl } from "../host";
import type {
  NovelCard,
  SourceChapter,
  SourceNovel,
  SourceNovelMeta,
  SourceSearchResult,
  SourceSection,
  SourceVolume,
} from "../types";
```

`export` these four entry points (the rest stay module-private):

```ts
export function parseHomeSections(doc: Document, baseUrl: string): SourceSection[]
export function parseSearchResults(doc: Document, baseUrl: string, query: string, page: number): SourceSearchResult
export function parseNovelPage(doc: Document, baseUrl: string, pageUrl: string): SourceNovel
export function parseVolumes(doc: Document, pageUrl: string): SourceVolume[]
```

- [ ] **Step 2: Parameterize base URL (the only edit to the moved bodies)**

The moved functions currently reference the module constant `BASE_URL`. Thread a `baseUrl` parameter instead, applying these **exact** signature + internal changes:

- `parseHomeSections(doc, baseUrl)` — pass `baseUrl` into every `parseSectionElement(...)` call.
- `parseSectionElement(el, id, baseUrl)` — pass `baseUrl` into `parseTrendArea`, `parseHomeHot`, `parseCardsInListupd`.
- `parseTrendArea(el, id, baseUrl)`, `parseHomeHot(el, id, baseUrl)` — replace `absolutizeUrl(href, BASE_URL)` → `absolutizeUrl(href, baseUrl)` and `pickImageSrc(img)` → `pickImageSrc(img, baseUrl)`.
- `parseCardsInListupd(listupd, baseUrl)` — pass `baseUrl` into `parseUtaoCard` / `parseBsCard`.
- `parseUtaoCard(el, baseUrl)`, `parseBsCard(el, baseUrl)` — `absolutizeUrl(href, BASE_URL)` → `absolutizeUrl(href, baseUrl)`; `pickImageSrc(img)` → `pickImageSrc(img, baseUrl)`.
- `parseSearchResults(doc, baseUrl, query, page)` — `absolutizeUrl(href, BASE_URL)` → `absolutizeUrl(href, baseUrl)`; `pickImageSrc(img)` → `pickImageSrc(img, baseUrl)`.
- `parseNovelPage(doc, baseUrl, pageUrl)` — `pickImageSrc(coverImg)` → `pickImageSrc(coverImg, baseUrl)`; `absolutizeUrl(linkEl.getAttribute("href") || "", BASE_URL)` → `absolutizeUrl(..., baseUrl)`; the `parseVolumes(doc, pageUrl)` call is unchanged (it already uses `pageUrl`).
- `parseVolumes(doc, pageUrl)` — **no change** (already uses `pageUrl` for `absolutizeUrl` and needs no base URL).
- `pickImageSrc(img: HTMLImageElement | null, baseUrl: string)` — replace both `new URL(src, BASE_URL)` occurrences with `new URL(src, baseUrl)`.
- `cleanTitle`, `sanitizeTitle`, `extractDescriptionText` — **no change**.

- [ ] **Step 3: Rewrite `kolnovel.ts` to delegate discovery and drop the moved code**

In `src/sources/extensions/kolnovel.ts`:

1. **Imports** — change the host import and add the theme import:

```ts
import { parseHtmlDocument } from "../host";
import {
  parseHomeSections,
  parseNovelPage,
  parseSearchResults,
} from "./kolnovel-theme";
```

(Remove `absolutizeUrl` from the host import — it's no longer used in this file. In the `import type { ... } from "../types";` line, keep only names still referenced after the move: `Source`, `SourceHost`, and `SourceLine` are definitely still used by `createKolNovelSource`/`extractChapterLines`; let `tsc` in Step 4 flag any others to delete.)

2. **Delete** the function definitions you moved in Step 1 (the `parse*` family, `cleanTitle`, `sanitizeTitle`, `pickImageSrc`, `extractDescriptionText`). **Keep** everything chapter-body related: `IGNORED_PATTERNS`, `IGNORED_REGEXES`, `toIgnoreRegex`, `extractHiddenClassesFromCss`, `collectHiddenClasses`, `extractChapterLines`, `hasHiddenClass`, `isDecorativeImage`, `absoluteImageSrc`, `isHiddenInline`, `paragraphText`, `stripIgnored`, and the `BASE_URL`/`SOURCE_ID` constants.

3. **Tighten `canHandle`** — replace the existing body:

```ts
    canHandle(url) {
      try {
        return new URL(url).hostname.toLowerCase() === "free.kolnovel.com";
      } catch {
        return false;
      }
    },
```

4. **Delegate the discovery methods** — replace the bodies of `getHomeSections`, `search`, and `getNovel` with:

```ts
    async getHomeSections() {
      host.log("info", "getHomeSections");
      const resp = await host.fetch(BASE_URL + "/");
      return parseHomeSections(parseHtmlDocument(resp.text), BASE_URL);
    },

    async search(query, page) {
      const pageNum = Math.max(1, page ?? 1);
      const params = new URLSearchParams({ s: query });
      if (pageNum > 1) params.set("paged", String(pageNum));
      const url = `${BASE_URL}/?${params.toString()}`;
      host.log("info", `search(${query}, page=${pageNum}) → ${url}`);
      const resp = await host.fetch(url);
      return parseSearchResults(parseHtmlDocument(resp.text), BASE_URL, query, pageNum);
    },

    async getNovel(url) {
      host.log("info", `getNovel(${url})`);
      const resp = await host.fetch(url);
      return parseNovelPage(parseHtmlDocument(resp.text), BASE_URL, url);
    },
```

Leave `getChapterContent` (and its `extractChapterLines` call) exactly as it is.

- [ ] **Step 4: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: PASS. If it reports an unused import in `kolnovel.ts`, remove that name from the `import type` list. If it reports `BASE_URL` unused in `kolnovel-theme.ts`, confirm you did not accidentally move the `BASE_URL` const (it stays in `kolnovel.ts`).

- [ ] **Step 5: Manual regression — free KolNovel still works**

Run:
```bash
npm run tauri dev
```
In the app: Store tab → KolNovel (free) → confirm the homepage sections render, search returns results, and opening a novel shows metadata + volumes/chapters. (No import needed yet — discovery is the surface this task touched.) Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add src/sources/extensions/kolnovel-theme.ts src/sources/extensions/kolnovel.ts
git commit -m "refactor(sources): extract shared KolNovel theme parsers; scope free canHandle to free.kolnovel.com"
```

---

## Task 4: PDF → SourceLine[] wrapper (pdf.js)

The core new logic. A mostly-pure module: bytes in, `SourceLine[]` out, with image bytes handed back through a `mintImageRef` callback so the caller owns storage.

**Files:**
- Create: `src/sources/pdf/pdfChapter.ts`

- [ ] **Step 1: Create the module with lazy pdf.js loading + public API**

Create `src/sources/pdf/pdfChapter.ts`:

```ts
// PDF chapter parser. Turns a downloaded chapter PDF into SourceLine[]:
// NFKC-normalized text paragraphs + extracted illustration bytes (handed back
// via mintImageRef so the caller stores them and embeds the returned ref in
// the image line). pdf.js is heavy and only needed for PDF sources, so it is
// dynamically imported on first use and its worker is bundled locally.

import type { SourceLine } from "../types";

export interface ExtractedImage {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
}

export interface ExtractPdfOptions {
  /** Chapter page URL — used to strip the page-1 boilerplate header line. */
  chapterUrl: string;
  /** Novel title, if known — lets us strip the page-1 title line so it isn't
   *  duplicated with the EPUB chapter <h1>. */
  novelTitle?: string;
  /** Persist an extracted image and return a stable ref to embed in the line. */
  mintImageRef: (img: ExtractedImage) => string;
  /** Optional debug logger. */
  log?: (msg: string) => void;
}

// Images smaller than this on either side are spacers/icons, not illustrations.
const MIN_IMAGE_DIM = 100;

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      // Vite returns the bundled worker URL via the ?url suffix (offline-safe).
      const workerUrl = (
        await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
      ).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}
```

(If Task 1 Step 2 found a different worker filename, use it in the `?url` import here.)

- [ ] **Step 2: Add the text helpers**

Append to `src/sources/pdf/pdfChapter.ts`:

```ts
interface TextItemLike {
  str: string;
  transform: number[]; // [a,b,c,d,e,f]; e = x, f = y (PDF user space)
  hasEOL?: boolean;
  height?: number;
}

/** Fold Arabic presentation forms (ﻟﺤﻴﺎة) back to base letters via NFKC and
 *  collapse whitespace. Empty string when nothing remains. */
function normalizeArabic(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** True for the page-1 header lines we don't want in the body: the printed
 *  chapter URL, and the title line (which the EPUB re-renders as <h1>). */
function isBoilerplate(text: string, chapterUrl: string, novelTitle?: string): boolean {
  if (text.includes("kolnovel.com/")) return true; // the printed URL line
  const bare = chapterUrl.replace(/^https?:\/\//, "");
  if (bare && text.includes(bare)) return true;
  if (novelTitle) {
    const t = normalizeArabic(novelTitle);
    // The header title line is "<novel title> <chapter number>"; strip a line
    // that is the title plus only trailing digits/dots/whitespace.
    if (t && text.startsWith(t) && /^[\s\d.\-:]*$/.test(text.slice(t.length))) {
      return true;
    }
  }
  return false;
}

/** Best-effort paragraph reconstruction from a single page's text items.
 *  PDFs have no paragraph markers, so we segment on vertical gaps: items on
 *  the same line share ~y; consecutive lines are joined; a gap larger than
 *  ~1.6 line-heights starts a new paragraph. Tune the multiplier in the
 *  verify step against real chapters if paragraphs merge or fragment. */
function reconstructParagraphs(items: TextItemLike[]): string[] {
  const paras: string[] = [];
  let cur = "";
  let prevY: number | null = null;
  let lineHeight = 0;
  const flush = () => {
    if (cur.trim()) paras.push(cur.trim());
    cur = "";
  };
  for (const it of items) {
    const y = it.transform?.[5] ?? 0;
    const h = it.height || 0;
    if (h) lineHeight = lineHeight ? lineHeight * 0.7 + h * 0.3 : h;
    if (prevY !== null) {
      const dy = prevY - y; // PDF y decreases going down the page
      if (dy > Math.max(lineHeight * 1.6, 1)) flush();
    }
    if (it.str) {
      if (cur && !cur.endsWith(" ") && !it.str.startsWith(" ")) cur += " ";
      cur += it.str;
    }
    if (it.hasEOL && cur && !cur.endsWith(" ")) cur += " ";
    if (it.str && it.str.trim()) prevY = y; // marked-content items have no str
  }
  flush();
  return paras;
}
```

- [ ] **Step 3: Add the image helpers**

Append to `src/sources/pdf/pdfChapter.ts`:

```ts
/** Render a page offscreen so pdf.js resolves its image XObjects into
 *  page.objs (image bytes aren't available until the page is processed). */
async function renderPageToResolveObjs(page: any): Promise<void> {
  const viewport = page.getViewport({ scale: 1.0 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas context");
  await page.render({ canvasContext: ctx, viewport }).promise;
}

/** Promisified page.objs.get — resolves null on miss/timeout instead of hanging. */
function getImageObj(page: any, name: string): Promise<any | null> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) { done = true; resolve(null); }
    }, 5000);
    try {
      page.objs.get(name, (obj: any) => {
        if (!done) { done = true; clearTimeout(t); resolve(obj); }
      });
    } catch {
      if (!done) { done = true; clearTimeout(t); resolve(null); }
    }
  });
}

/** Draw a resolved pdf.js image object to a canvas and export JPEG bytes. */
async function imageObjToBytes(img: any): Promise<ExtractedImage | null> {
  const w = img?.width | 0;
  const h = img?.height | 0;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0);
  } else if (img.data) {
    // kind: 1 = GRAYSCALE_1BPP-decoded-to-bytes, 2 = RGB_24BPP, 3 = RGBA_32BPP
    const rgba = new Uint8ClampedArray(w * h * 4);
    const d: Uint8ClampedArray | Uint8Array = img.data;
    if (img.kind === 3) {
      rgba.set(d.subarray(0, rgba.length));
    } else if (img.kind === 2) {
      for (let i = 0, k = 0; i < d.length; i += 3, k += 4) {
        rgba[k] = d[i]; rgba[k + 1] = d[i + 1]; rgba[k + 2] = d[i + 2]; rgba[k + 3] = 255;
      }
    } else {
      // Treat anything else as grayscale: one byte per pixel.
      for (let i = 0, k = 0; i < d.length && k < rgba.length; i += 1, k += 4) {
        rgba[k] = rgba[k + 1] = rgba[k + 2] = d[i]; rgba[k + 3] = 255;
      }
    }
    ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  } else {
    return null;
  }

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", 0.85),
  );
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, mimeType: "image/jpeg", extension: "jpg" };
}
```

- [ ] **Step 4: Add the `extractPdfLines` entry point**

Append to `src/sources/pdf/pdfChapter.ts`:

```ts
export async function extractPdfLines(
  bytes: Uint8Array,
  opts: ExtractPdfOptions,
): Promise<SourceLine[]> {
  const pdfjs = await loadPdfjs();
  const OPS = pdfjs.OPS;
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const lines: SourceLine[] = [];

  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);

      // Find image-draw ops first so we only pay for an offscreen render on
      // pages that actually contain illustrations.
      const opList = await page.getOperatorList();
      const imageNames: string[] = [];
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
          const name = opList.argsArray[i]?.[0];
          if (typeof name === "string") imageNames.push(name);
        }
      }

      // Text.
      const tc = await page.getTextContent();
      for (const para of reconstructParagraphs(tc.items as TextItemLike[])) {
        const norm = normalizeArabic(para);
        if (!norm) continue;
        if (isBoilerplate(norm, opts.chapterUrl, opts.novelTitle)) continue;
        lines.push({ type: "text", content: norm });
      }

      // Images (interleave after the page's text; LN illustrations are
      // full-page plates, so per-page ordering is sufficient).
      if (imageNames.length > 0) {
        await renderPageToResolveObjs(page);
        for (const name of imageNames) {
          try {
            const img = await getImageObj(page, name);
            if (!img || (img.width | 0) < MIN_IMAGE_DIM || (img.height | 0) < MIN_IMAGE_DIM) {
              continue;
            }
            const extracted = await imageObjToBytes(img);
            if (!extracted) continue;
            lines.push({ type: "image", content: opts.mintImageRef(extracted) });
          } catch (e) {
            opts.log?.(`image ${name} (page ${p}) failed: ${String(e)}`);
          }
        }
      }

      page.cleanup();
    }
  } finally {
    await doc.cleanup();
    await doc.destroy();
  }

  return lines;
}
```

- [ ] **Step 5: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: PASS. (pdf.js page/objs are accessed as `any` deliberately — pdf.js's page-level types are awkward; the public surface `extractPdfLines`/`ExtractedImage` is fully typed.) If `import("...?url")` errors on `.default`, confirm `src/vite-env.d.ts` contains `/// <reference types="vite/client" />` (it does in this repo).

- [ ] **Step 6: Commit**

```bash
git add src/sources/pdf/pdfChapter.ts
git commit -m "feat(sources): add pdf.js chapter parser (text + image extraction)"
```

---

## Task 5: The KolNovel Pro source + registration

Wire theme discovery + the PDF token flow + `resolveImage` into a `Source`, and register it.

**Files:**
- Create: `src/sources/extensions/kolnovel-pro.ts`
- Modify: `src/sources/registry.ts:16` (import) and `src/sources/registry.ts:41-51` (BUILTINS)

- [ ] **Step 1: Create the source module**

Create `src/sources/extensions/kolnovel-pro.ts`:

```ts
// KolNovel Pro source — kolnovel.com. Browse/search/novel pages reuse the
// shared KolNovel theme parsers; the difference is chapter content: each
// chapter is a downloadable PDF (translated text + official illustrations),
// fetched via the site's ts_ln_dl_url token flow and parsed with pdf.js.
//
//   token:  POST /wp-admin/admin-ajax.php  action=ts_ln_dl_url&post_id=<id>
//             → { error:0, url: ".../pdf/?tspdftoken=<token>" }
//   bytes:  GET <token url>  → application/pdf
//
// Anonymous access only; members-only chapters surface as a stub line via the
// importer's per-chapter error handling.

import { parseHtmlDocument } from "../host";
import {
  parseHomeSections,
  parseNovelPage,
  parseSearchResults,
} from "./kolnovel-theme";
import { extractPdfLines, type ExtractedImage } from "../pdf/pdfChapter";
import type { Source, SourceHost, SourceLine } from "../types";

const BASE_URL = "https://kolnovel.com";
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;

export function createKolNovelProSource(host: SourceHost): Source {
  // Images extracted from chapter PDFs during getChapterContent, keyed by the
  // ref we emit in image SourceLines. The importer reads them back via
  // resolveImage. Cleared per novel so the map doesn't grow across imports.
  const imageStore = new Map<string, ExtractedImage>();
  let lastNovelTitle: string | undefined;

  return {
    meta: {
      id: "kolnovel-pro",
      name: "KolNovel Pro",
      baseUrl: BASE_URL,
      language: "ar",
      description:
        "Arabic novels from kolnovel.com delivered as PDF chapters with the official illustrations.",
      version: "0.1.0",
    },

    canHandle(url) {
      try {
        const h = new URL(url).hostname.toLowerCase();
        return h === "kolnovel.com" || h === "www.kolnovel.com";
      } catch {
        return false;
      }
    },

    async getHomeSections() {
      host.log("info", "getHomeSections");
      const resp = await host.fetch(BASE_URL + "/");
      return parseHomeSections(parseHtmlDocument(resp.text), BASE_URL);
    },

    async search(query, page) {
      const pageNum = Math.max(1, page ?? 1);
      const params = new URLSearchParams({ s: query });
      if (pageNum > 1) params.set("paged", String(pageNum));
      const url = `${BASE_URL}/?${params.toString()}`;
      host.log("info", `search(${query}, page=${pageNum}) → ${url}`);
      const resp = await host.fetch(url);
      return parseSearchResults(parseHtmlDocument(resp.text), BASE_URL, query, pageNum);
    },

    async getNovel(url) {
      host.log("info", `getNovel(${url})`);
      imageStore.clear();
      const resp = await host.fetch(url);
      const novel = parseNovelPage(parseHtmlDocument(resp.text), BASE_URL, url);
      lastNovelTitle = novel.title;
      return novel;
    },

    async getChapterContent(chapter): Promise<SourceLine[]> {
      const postId = extractPostId(chapter.url);
      if (!postId) {
        throw new Error(`Could not find a post id in chapter URL: ${chapter.url}`);
      }
      host.log("debug", `getChapterContent(#${chapter.id}) post_id=${postId}`);
      const pdfUrl = await requestPdfUrl(host, postId);
      const bytes = await host.fetchBytes(pdfUrl);
      assertPdf(bytes);

      let counter = 0;
      return extractPdfLines(bytes, {
        chapterUrl: chapter.url,
        novelTitle: lastNovelTitle,
        log: (m) => host.log("debug", m),
        mintImageRef: (img) => {
          const ref = `kolpro:img:${postId}:${++counter}`;
          imageStore.set(ref, img);
          return ref;
        },
      });
    },

    async resolveImage(ref) {
      return imageStore.get(ref) ?? null;
    },
  };
}

/** The WordPress post id is the trailing number in the chapter permalink,
 *  e.g. ".../...z435ggye-275085/" → "275085". */
function extractPostId(url: string): string | null {
  const m = url.match(/-(\d+)\/?(?:[?#]|$)/);
  return m ? m[1] : null;
}

/** POST the ts_ln_dl_url action and return the tokenized PDF URL. */
async function requestPdfUrl(host: SourceHost, postId: string): Promise<string> {
  const body = `action=ts_ln_dl_url&post_id=${encodeURIComponent(postId)}`;
  const resp = await host.fetch(AJAX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body,
  });
  let json: { error?: number; url?: string };
  try {
    json = JSON.parse(resp.text);
  } catch {
    throw new Error(`PDF token endpoint returned non-JSON (status ${resp.status})`);
  }
  if (!json || json.error !== 0 || !json.url) {
    throw new Error(`PDF not available for post ${postId} (members-only or removed)`);
  }
  return json.url;
}

/** Guard: the tokenized endpoint returns the JS loader HTML (not a PDF) when
 *  the token is missing/invalid or the chapter is members-only. */
function assertPdf(bytes: Uint8Array): void {
  const ok =
    bytes.length > 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46; // F
  if (!ok) {
    throw new Error("Downloaded chapter was not a PDF (likely members-only).");
  }
}
```

- [ ] **Step 2: Register the source**

In `src/sources/registry.ts`, add the import after the existing source imports (line 16 area):

```ts
import { createKolNovelProSource } from "./extensions/kolnovel-pro";
```

Then add a `BUILTINS` entry immediately after the `kolnovel` entry (keeping alphabetical order — `kolnovel-pro` follows `kolnovel`):

```ts
  {
    meta: {
      id: "kolnovel-pro",
      name: "KolNovel Pro",
      baseUrl: "https://kolnovel.com",
      language: "ar",
      description:
        "Arabic novels from kolnovel.com delivered as PDF chapters with the official illustrations.",
      version: "0.1.0",
    },
    factory: (host) => createKolNovelProSource(host),
  },
```

- [ ] **Step 3: Type-check and build**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add src/sources/extensions/kolnovel-pro.ts src/sources/registry.ts
git commit -m "feat(sources): add KolNovel Pro source (PDF chapters from kolnovel.com)"
```

---

## Task 6: End-to-end manual verification

No code changes — this validates the feature against the live site and locks in the spec's verification plan. If a step fails, fix the relevant module and re-commit before continuing.

**Files:** none (verification only)

- [ ] **Step 1: Launch the app**

Run:
```bash
npm run tauri dev
```

- [ ] **Step 2: Discovery + routing**

- Store tab → confirm **KolNovel Pro** appears in the source list.
- Open KolNovel Pro home → sections render. Open the Re:Zero series (`https://kolnovel.com/series/rezero-starting-life-in-another-world/`) → title, author "Nagatsuki Tappei", status, and 9 volumes with chapters render.
- In the import-by-URL dialog: paste a `kolnovel.com` series URL → resolves to **KolNovel Pro**; paste a `free.kolnovel.com` URL → resolves to **KolNovel** (free). Expected: correct routing for both (the `canHandle` split works).

- [ ] **Step 3: Import a chapter with an illustration**

Import the prologue (`المقدمة`) or a small chapter range covering it (post id `147059`). In devtools console, watch for `[source:kolnovel-pro]` logs. Expected: import completes; opening the book shows coherent Arabic text (no `kolnovel.com/...` URL line, no duplicated title line) **and** the 819×1024 illustration rendered inline.

If paragraphs look merged or over-fragmented, tune `reconstructParagraphs`'s `1.6` gap multiplier in `src/sources/pdf/pdfChapter.ts`, rebuild, re-import. If a stray header line remains, adjust `isBoilerplate`.

- [ ] **Step 4: Offline guarantee**

Disable the machine's network, then open the imported book. Expected: text **and** illustration still render (images are baked into the `.epub`).

- [ ] **Step 5: Text-only chapter**

Import a chapter with no illustration (epilogue 59.2, post id `275085`). Expected: text imports cleanly, no errors, no missing-image placeholders.

- [ ] **Step 6: Free-source regression**

Import a known `free.kolnovel.com` novel (small range). Expected: still works exactly as before the Task 3 refactor.

- [ ] **Step 7: Stop the dev server**

Stop `npm run tauri dev`. The feature is complete.

---

## Self-Review

**Spec coverage** (each spec section → task):
- New `kolnovel-pro.ts` source → Task 5.
- Shared `kolnovel-theme.ts` + `canHandle` disambiguation → Task 3.
- `getChapterContent` token flow (post_id → ts_ln_dl_url → tokenized PDF → fetchBytes) → Task 5 (`extractPostId`, `requestPdfUrl`, `assertPdf`).
- pdf.js text (NFKC, boilerplate strip, paragraph rebuild) + image extraction → Task 4.
- `Source.resolveImage` hook + importer integration → Task 2.
- Registration → Task 5 Step 2.
- New `pdfjs-dist` dependency + local worker → Task 1 + Task 4 Step 1.
- Offline guarantee → Task 6 Step 4.
- Error handling (missing id / bad token / non-PDF / parse fail / per-image fail) → Task 4 (per-image try/catch) + Task 5 (`extractPostId`/`requestPdfUrl`/`assertPdf` throw → importer stub at `importer.ts:281-292`).
- Verification plan → Task 6.
- Out-of-scope items (login, page-image/OCR, PDF cover, test runner) → not implemented, as intended.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the Task 3 move lists exact functions + exact signature edits rather than re-printing unchanged bodies (the engineer has `kolnovel.ts` in front of them).

**Type consistency:** `ExtractedImage` (`pdfChapter.ts`) ≡ `resolveImage`'s return shape (`types.ts`) ≡ importer's `DownloadedImage` `{ bytes, mimeType, extension }` — so `(await source.resolveImage?.(url)) ?? (await downloadImage(url, host))` type-checks. `extractPdfLines(bytes, ExtractPdfOptions) → Promise<SourceLine[]>` is called with exactly `{ chapterUrl, novelTitle, log, mintImageRef }`. Theme exports `parseHomeSections(doc, baseUrl)`, `parseSearchResults(doc, baseUrl, query, page)`, `parseNovelPage(doc, baseUrl, pageUrl)` — call sites in both sources match.
