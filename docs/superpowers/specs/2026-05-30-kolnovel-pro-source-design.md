# KolNovel Pro source — PDF-chapter scraping

Status: design approved, ready for implementation plan
Owner: Mostafa Osama
Scope: new `src/sources/extensions/kolnovel-pro.ts`; extract shared theme
parsers from `kolnovel.ts` into `kolnovel-theme.ts`; one additive change to
the `Source` interface + `importer.ts` image step; a pdf.js wrapper module;
register in `registry.ts`; new dependency `pdfjs-dist`.

## Problem / motivation

`free.kolnovel.com` (the existing `kolnovel` source) serves readable HTML
chapters. The **pro** site on the apex domain `kolnovel.com` puts the HTML
reading view behind a paid membership and instead exposes each chapter as a
downloadable **PDF that contains the translated text *plus* the official
illustrations** — the value the free site lacks.

We want a new source that imports these PDF chapters into the library as
normal reflowable EPUBs (extracted text + inline illustrations), fully
offline, with **anonymous access only** (no login).

## Reconnaissance findings (the facts this design rests on)

Verified live against `https://kolnovel.com/series/rezero-starting-life-in-another-world/`
and its chapters via Playwright:

1. **Discovery pages use the same WordPress theme as free KolNovel** —
   `.sertobig` header, `.serl` metadata rows, `.sertogenre` tags, cover at
   `.sertothumb img`, and `.ts-chl-collapsible` volume headers whose chapter
   rows are `.eplister li[data-id]`, reachable by the existing `ul li a` walk.
2. Each chapter row carries `data-id` = WordPress `post_id`, and the chapter
   URL ends with `-<post_id>/` (e.g. `…z435ggye-275085/` → `275085`).
3. **PDF download flow (anonymous, no login):**
   - `POST https://kolnovel.com/wp-admin/admin-ajax.php`
     (`application/x-www-form-urlencoded`), body
     `action=ts_ln_dl_url&post_id=<id>` → JSON
     `{"error":0,"url":".../pdf/?tspdftoken=<token>"}`.
   - `GET` that tokenized URL → `application/pdf`
     (`Content-Disposition: attachment`). The token is server-issued **per
     request**; the bare `…/pdf/` URL (no token) returns only a tiny JS loader
     page, so the token is required for the real bytes.
4. **PDF content:** real, extractable text (not scanned). Arabic comes out in
   Unicode **Presentation Forms-B** (`ﻟﺤﻴﺎة` instead of `لحياة`) and drops some
   final-yaa / alef-maqsura glyphs. NFKC normalization folds the presentation
   forms back to base letters; residual artifacts are accepted (the chosen
   output mode is text + images, knowing this).
5. **Illustrations** are embedded as discrete raster image XObjects (the
   prologue's page 2 is an 819×1024 plate), extractable via pdf.js → canvas →
   bytes. They are **sparse** — many chapters have none. Page 1 of each PDF
   carries a boilerplate header (novel title + the chapter URL) to strip.
6. pdf.js loads and runs in the page context with no CSP issue; image bitmaps
   render to a canvas and export to JPEG/PNG cleanly.

## Goals / non-goals

**Goals**
- A "KolNovel Pro" source producing reflowable EPUBs with extracted text +
  inline illustrations, readable fully offline.
- Reuse the free-KolNovel discovery code; keep both sources working and
  routed to the correct domain.
- Anonymous access only.

**Non-goals**
- Login / paid-membership handling.
- Page-image rendering or OCR modes.
- Perfect Arabic text fidelity (best-effort normalization only).
- Scraping the paywalled HTML reading view on `kolnovel.com`.

## Architecture overview

A source stays a TS module running in the webview; all networking goes through
the `host` bridge (Rust/reqwest, no CORS); **PDF parsing runs in the webview
via pdf.js**, which has the DOM + canvas that text and image extraction need.
The Rust side stays the thin HTTP bridge it is today. This works on desktop
and Android (it is JS + `host.fetchBytes`, not the desktop-only
`renderAndExtract`).

```
getChapterContent(chapter)
  chapter.url → post_id → ts_ln_dl_url AJAX → tokenized PDF
    → host.fetchBytes → PDF bytes → pdf.js → SourceLine[] (text + image)
```

PDF-extracted image **bytes** reach the EPUB through a new optional
`Source.resolveImage(ref)` hook that the importer consults before falling back
to `host.fetchBytes`.

## Detailed design

### 1. Shared theme parsers — `src/sources/extensions/kolnovel-theme.ts`

The pure DOM→data parsers currently private in `kolnovel.ts`
(`parseHomeSections`, `parseSearchResults`, `parseNovelPage`, `parseVolumes`
and their helpers: `parseSectionElement`, `parseTrendArea`, `parseHomeHot`,
`parseCardsInListupd`, `parseUtaoCard`, `parseBsCard`, `pickImageSrc`,
`cleanTitle`, `sanitizeTitle`, `extractDescriptionText`) move into a new
module. Each parser that today closes over the module-const `BASE_URL` takes
the **base URL as a parameter** instead.

- `kolnovel.ts` becomes: `meta` + `canHandle` + `getHomeSections` / `search` /
  `getNovel` delegating to the theme module with
  `baseUrl = "https://free.kolnovel.com"`, plus its existing HTML-path
  `getChapterContent` (and its decoy-class / ignore-pattern helpers, which are
  chapter-body specific and stay in `kolnovel.ts`).
- `parseVolumes` additionally captures `li[data-id]` when present, exposed in a
  forward-compatible way. The pro source derives `post_id` from the chapter URL
  (below), so this is convenience, not a hard dependency.

**Rationale:** avoids copy-paste drift between two near-identical sources — the
"improve the code you're working in" case, directly in service of this feature.

**Risk & mitigation:** this refactors a working source. The extraction is
behavior-preserving; the verification plan re-imports a known
`free.kolnovel.com` novel to confirm no regression.

**Alternative considered:** export the helpers directly from `kolnovel.ts` and
import them into the pro source. Rejected — it leaves `kolnovel.ts` owning
shared code and still requires threading `baseUrl`; a dedicated module is the
cleaner boundary.

### 2. `canHandle` disambiguation (targeted fix)

Today `kolnovel.ts` `canHandle` matches `/(^|\.)kolnovel\.com$/i`, which
matches **both** `free.kolnovel.com` and `kolnovel.com`. With a second source
on the apex domain, `findSourceForUrl` (`registry.ts:80`) would hand a
`kolnovel.com` URL to whichever source sorts first.

Fix: make the predicates precise.
- `kolnovel` (free): host `=== "free.kolnovel.com"`.
- `kolnovel-pro`: host `=== "kolnovel.com"` or `"www.kolnovel.com"` (and **not**
  the `free.` subdomain).

Registry order stays alphabetical; precise predicates make ordering irrelevant
to routing.

### 3. New source — `src/sources/extensions/kolnovel-pro.ts`

```ts
export function createKolNovelProSource(host: SourceHost): Source
```

- `meta`: `id: "kolnovel-pro"`, `name: "KolNovel Pro"`,
  `baseUrl: "https://kolnovel.com"`, `language: "ar"`, `version: "0.1.0"`,
  description noting "PDF chapters with official illustrations".
- `canHandle`: apex/www `kolnovel.com` (§2).
- `getHomeSections` / `search` / `getNovel`: delegate to `kolnovel-theme` with
  `baseUrl = "https://kolnovel.com"`.
- `getChapterContent(chapter)`: the PDF pipeline (§4).
- `resolveImage(ref)`: returns bytes for refs minted during
  `getChapterContent` (§6). Backed by a per-instance
  `Map<ref, { bytes, mimeType, extension }>` populated during chapter parsing.

### 4. `getChapterContent` — PDF pipeline

1. `postId` = `chapter.url` matched against `/-(\d+)\/?(?:[?#]|$)/`. Missing →
   throw a clear error.
2. **Token:** `host.fetch` `POST .../wp-admin/admin-ajax.php` with header
   `Content-Type: application/x-www-form-urlencoded; charset=UTF-8` and body
   `action=ts_ln_dl_url&post_id=<id>`. Parse JSON; require `error === 0` and a
   non-empty `url`. Any deviation (non-JSON, `error !== 0`, missing `url`) →
   throw.
3. **Bytes:** `host.fetchBytes(tokenUrl)`. Validate the leading bytes are
   `%PDF`; if the response is HTML (loader page / members-only) → throw a
   descriptive error so the chapter stub explains why.
4. `lines = await extractPdfLines(bytes, { chapterUrl, mintImageRef })` (§5).
   Return `lines`.

All networking goes through `host` (Rust/reqwest) — avoids CORS, matches every
other source, works on mobile.

### 5. PDF parsing — pdf.js wrapper (`src/sources/pdf/pdfChapter.ts`)

**Dependency:** `pdfjs-dist` (v4.x, ESM — matches the repo's `"type":
"module"` + Vite 8). The worker is bundled locally (no CDN, keeps the app
offline-capable and CSP-clean):

```ts
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
```

pdf.js is **lazy-imported** from inside the pro source so it is not loaded at
app start, only when importing from this source. `getDocument({ data: bytes })`
parses the already-downloaded bytes; pdf.js performs no network of its own.

**Text extraction.** Per page, `getTextContent()`; reconstruct paragraphs from
text-item geometry (vertical-position deltas, using `hasEOL` when present) —
best-effort segmentation. NFKC-normalize each string
(`str.normalize("NFKC")`) to fold presentation forms; collapse whitespace.
Strip the page-1 boilerplate header: drop lines that contain the chapter URL
and the leading novel-title line (the importer re-adds the title in
`buildChapterHtml` from `SourceChapter.title`, so keeping it would duplicate).
Emit `SourceLine{ type: "text" }` per paragraph; drop empties.

**Image extraction.** Per page, `getOperatorList()`; in op order find
`paintImageXObject` / `paintImageMaskXObject`; resolve each image object via
`page.objs` (after an offscreen page render that populates them); draw
`obj.bitmap` (or build `ImageData` from `obj.data`/`obj.kind`) onto a canvas
and export bytes. Format: JPEG (q≈0.85) for opaque illustrations, PNG when
alpha is present. Mint a ref via the `mintImageRef` callback
(`kolpro:img:<postId>:<n>`), store `{ bytes, mimeType, extension }` in the
source's map, and emit `SourceLine{ type: "image", content: ref }` at the op's
position so text and images interleave in reading order. Per-image failures
skip that image and log — they never fail the chapter.

`extractPdfLines` is a mostly-pure function (bytes + callbacks →
`SourceLine[]`), so it is inspectable in isolation.

### 6. `Source.resolveImage(ref)` hook + importer integration

`types.ts` — add to the `Source` interface:

```ts
/** Optional. When a source emits image SourceLines whose `content` is NOT a
 *  host-fetchable URL (e.g. images extracted from a downloaded PDF), the
 *  importer calls resolveImage(content) to obtain the bytes out-of-band
 *  instead of host.fetchBytes. Return null to fall back to URL fetch. */
resolveImage?(
  ref: string,
): Promise<{ bytes: Uint8Array; mimeType: string; extension: string } | null>;
```

`importer.ts` `downloadInlineImages` — accept the `source`, and per unique
image-line content try `await source.resolveImage?.(content)` first; if it
returns bytes, register them directly (`images/img-NNN.<ext>` +
`EpubBuildImage`); otherwise `await downloadImage(content, host)` exactly as
today. Dedup stays keyed by the content string; `imageMap` maps the ref →
local href; `renderLine` is unchanged.

This is the **only** change to generic/shared code. `cenele` and `kolnovel`
don't implement `resolveImage`, so their behavior is byte-for-byte identical.

### 7. Registration — `registry.ts`

Import `createKolNovelProSource`; add a `BUILTINS` entry
(`meta` as in §3, `factory: (host) => createKolNovelProSource(host)`),
alphabetized after `kolnovel`.

## Data flow

```
series page (HTML)
  → kolnovel-theme parsers (baseUrl = kolnovel.com)
  → SourceNovel { volumes → chapter stubs (url, our id) }

per chapter (importer fan-out, getChapterContent):
  chapter.url → post_id
    → POST admin-ajax (ts_ln_dl_url) → tokenized /pdf/ URL
      → host.fetchBytes → PDF bytes
        → pdf.js getDocument({data})
            per page: getTextContent → NFKC + paragraph rebuild + strip header → text lines
                      getOperatorList + render → image XObjects → bytes
                                              → source map[ref] = bytes;  image line (ref)
        → SourceLine[]

importer:
  downloadInlineImages:
     resolveImage(ref) → bytes   (PDF illustrations)
     host.fetchBytes(url) → bytes (cover, any real-URL images)
  buildEpub → <img src="images/img-NNN.jpg"> baked into book.epub
  importEpubBytes → library (self-contained, offline)
```

## Offline guarantee

Illustrations are extracted from the **already-downloaded PDF** during the
chapter fetch and written as real files inside the `.epub` zip. There is no
runtime or second-pass network fetch for images (unlike URL-based sources). If
a chapter's PDF downloaded, its illustrations are in the book; the saved book
reads — text and images — with zero network.

## Error handling

- Missing `post_id` in URL → throw → chapter stub line (`importer.ts:281-292`),
  import continues.
- AJAX non-JSON / `error !== 0` / no `url` → throw → stub.
- Tokenized response not a PDF (HTML loader / members-only) → throw descriptive
  → stub (the user sees *why* in the chapter body).
- pdf.js parse failure → throw → stub. One bad chapter never sinks the import.
- Per-image extraction failure → skip that image, keep the chapter's text.
- Theme-parser refactor: empty/unknown DOM degrades exactly as today (empty
  sections / volumes), no new failure modes.

## New dependency

`pdfjs-dist` (v4.x). Lazy-imported inside the pro source so it is excluded
from the initial app bundle and only loaded when importing from this source.
Worker bundled locally via Vite's `?url` import (no CDN).

## Out of scope

- Login / paid-membership downloads (anonymous only).
- Page-image and OCR output modes.
- Using a PDF page-1 illustration as the book cover (the series-page cover is
  used, fetched as a normal URL).
- Adding a test runner (none exists in this repo).
- Any other source.

## Verification plan (manual — no test runner in repo)

1. `npm run tauri dev`. Store tab → **KolNovel Pro** → open the Re:Zero series
   (`kolnovel.com/series/rezero-starting-life-in-another-world/`). Confirm
   metadata renders: title, author "Nagatsuki Tappei", status, 9 volumes,
   chapter list.
2. Import the prologue (`المقدمة`, post `147059`) or a small chapter range.
   Confirm the chapter text reads coherently (NFKC-normalized, no
   title/URL boilerplate line) **and** the 819×1024 illustration appears
   inline.
3. Disable the network and open the imported book — text + image still render
   (offline guarantee).
4. Import a no-image chapter (e.g. epilogue 59.2, post `275085`) — text only,
   no errors.
5. **Routing:** paste a `kolnovel.com` series URL in the import dialog → routes
   to KolNovel Pro; paste a `free.kolnovel.com` URL → routes to KolNovel
   (free). **Regression:** import a known `free.kolnovel.com` novel to confirm
   the theme-parser extraction still works after the refactor.
6. (Optional) Save a sample PDF as a fixture and run `extractPdfLines` from a
   scratch script for ad-hoc inspection of paragraph/image output.

## Open questions / risks

- **Paragraph reconstruction** from PDF text geometry is the main quality risk;
  iterate on a handful of sample chapters during implementation.
- **Coverage:** whether anonymous PDF access holds for every novel/chapter
  (some may be members-only even for the PDF). Out of scope to solve — such
  chapters degrade to a stub line.
- **pdf.js worker on Android:** validate the bundled worker loads in the mobile
  webview, not just desktop.
