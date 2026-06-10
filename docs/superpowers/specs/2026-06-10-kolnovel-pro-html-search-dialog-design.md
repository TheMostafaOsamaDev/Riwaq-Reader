# KolNovel Pro — HTML chapters, live search, and a "Back to novel" dialog action

Status: design approved, ready for implementation plan
Owner: Mostafa Osama
Scope: three KolNovel Pro (`kolnovel.com`) improvements —
(1) chapter reading switches from PDF extraction to **HTML-first** (the pro site
now serves readable HTML chapters with illustrations), keeping the PDF flow as a
**fallback**; (2) **search** is rewired from the broken `?s=` results page to the
site's live autocomplete API (`ts_ac_do_search`), driving both the as-you-type
dropdown and the submit grid; (3) the chapter-load **error dialog** gains a
"Back to novel" action. Touches `kolnovel-theme.ts`, `kolnovel.ts`,
`kolnovel-pro.ts`, and `SourceStreamReader.tsx`. No dependency changes
(`pdfjs-dist` is retained for the fallback).

## Problem / motivation

1. **Chapters fail to load.** Pro `getChapterContent` only does the PDF flow
   (`POST admin-ajax.php action=ts_ln_dl_url` → tokenized PDF → pdf.js). Chapters
   without a downloadable PDF return `{error:0}` from that endpoint and surface as
   "PDF not available for post N (members-only or removed)" — even though the
   chapter's text + illustrations are fully present in the page HTML. (Reported
   against post 238214.)
2. **Search returns nothing.** Pro `search` hits `?s=<query>`, which on
   `kolnovel.com` returns a WordPress **error** page (title "ووردبريس › خطأ"),
   not results. The site's actual search is a live autocomplete dropdown.
3. **No escape from a failed chapter.** The chapter-error overlay offers only
   "Retry"; a user stuck on a genuinely-unavailable chapter has no in-dialog way
   back to the novel page.

## Recon findings (verified live via Playwright + HTTP, 2026-06-10)

- **Chapter HTML.** `GET` a pro chapter (e.g.
  `.../shaag24rezero-...-243262/`) returns server-rendered HTML (no JS needed).
  The body is a single `<div class="epcontent entry-content">` (exactly one
  `.entry-content`; no `#kol_content`). The example chapter yields **639 clean
  text paragraphs + 3 illustration `<img>`** (absolute `kolnovel.com/wp-content/`
  URLs, classes like `alignnone size-medium wp-image-NNNN`); the reported failing
  chapter (238214) yields **501 paragraphs + 2 images**. No decoy/hidden-class
  anti-scrape styling (`hasDecoyStyle === false`). A `.dlpdf` link exists but
  sits **outside** `.epcontent`.
- **Free vs pro extractor.** The free source's private `extractChapterLines`
  (root `#kol_content ?? .entry-content`, walk `<p>/<img>`, drop empties +
  decoys, dedup) produces correct output on pro when `.epcontent` is added to the
  root preference — simulated live: 642 lines, clean first/mid/last text.
- **Live search API.** The `lightnovel` theme's `search.js` posts
  `action: 'ts_ac_do_search', ts_ac_query: <input>` to `admin-ajax.php`. It must
  be **`POST`** (with `X-Requested-With: XMLHttpRequest`): the live menu fires a
  GET *and* a POST, but the **GET is served from the page cache and returns
  stale, query-agnostic results** (verified — GET for "ري زيرو" returned recent
  unrelated novels), while the **POST runs the real query** (returned the three
  Re:Zero series). Both return **200** with a JSON body (content-type `text/html`):
  ```json
  { "series": [ { "all": [
      { "ID": 161525, "post_title": "Re:Zero - If Story",
        "post_link": "https://kolnovel.com/series/…/",
        "post_image": "https://kolnovel.com/wp-content/uploads/…-213x300.png",
        "post_genres": "خيالي, …", "post_status": "Ongoing", "post_type": "…" } ] } ] }
  ```
  ~10 results, no pagination. "ري زيرو" returns Re:Zero entries.
- **Blast radius.** `pdfChapter.ts` / `extractPdfLines` / `pdfjs-dist` are used
  **only** by `kolnovel-pro.ts`. `resolveImage` is implemented only by pro;
  consumers (importer, SourceStreamReader, downloadQueue, storeConversion) call it
  via `?.` and fall back to URL fetch. `extractChapterLines` is file-private in
  `kolnovel.ts` (cenele keeps its own copy) — safe to lift into the shared file.
- **Dialog routing.** The stream reader's `onClose` closes the overlay, revealing
  the `NovelDetailView` that remained mounted underneath — i.e. `onClose` already
  *is* "back to the novel page".

## Design

### 1. Chapter reading — HTML-first, PDF-fallback

- **Move** `extractChapterLines` and its helpers (`collectHiddenClasses`,
  `extractHiddenClassesFromCss`, `hasHiddenClass`, `isDecorativeImage`,
  `absoluteImageSrc`, `isHiddenInline`, `paragraphText`, `stripIgnored`,
  `toIgnoreRegex`, `IGNORED_PATTERNS/REGEXES`) from `kolnovel.ts` into
  `kolnovel-theme.ts`, exported as **`parseChapterContent(doc, baseUrl)`**:
  - root preference `#kol_content ?? .epcontent ?? .entry-content ?? body`
    (adds `.epcontent` for pro);
  - `baseUrl` parameterizes image absolutization (was hardcoded to free's base).
  - The decoy-class discovery and ad-string strip stay in — a no-op on clean pro
    pages, still protective for free.
- `kolnovel.ts` `getChapterContent` → `parseChapterContent(doc, BASE_URL)`; delete
  the now-moved private functions. Update the file header (it no longer owns the
  extractor).
- `kolnovel-pro.ts` `getChapterContent(chapter)`:
  1. `GET chapter.url` → `parseChapterContent(doc, BASE_URL)`.
  2. If `lines.length > 0` → return them (HTML path; normal absolute image URLs,
     fetched by the host like any other source's images).
  3. Else → existing PDF fallback (`requestPdfUrl` → `fetchBytes` → `assertPdf` →
     `extractPdfLines` with `imageStore`/`mintImageRef`).
  4. If the PDF fallback also reports unavailable → throw the existing
     "PDF not available …" error (now reachable only when neither HTML nor PDF
     exists, e.g. members-only).
  - Keep `imageStore` + `resolveImage` (only populated by the PDF fallback).
  - `meta.description` → "Arabic novels from kolnovel.com — read as HTML chapters
    with the official illustrations (PDF fallback for chapters without HTML)."

### 2. Search — live autocomplete API

- Add **`searchSuggest(query)`** to `kolnovel-pro.ts`:
  `POST ${AJAX_URL}` body `action=ts_ac_do_search&ts_ac_query=<enc>` with headers
  `Content-Type: application/x-www-form-urlencoded` + `X-Requested-With:
  XMLHttpRequest` → `JSON.parse(resp.text)` → flatten
  `series[].all[]` → `NovelCard[]` via a `liveSearchCards(json, baseUrl)` helper:
  `title=post_title`, `url=post_link` (absolutized), `coverUrl=post_image`,
  `badges` = `post_genres` split on `,` (trimmed, first ~3) plus `post_status`.
  Non-`/series/`-ish links and entries missing a title/link are skipped. Tolerate
  missing/blank `series`/`all` (return `[]`).
- Rewrite **`search(query)`** to call the same endpoint and return
  `{ cards, hasMore: false, query, page: 1 }`. Remove the `?s=` request and the
  `parseSearchResults` import from pro (free keeps using it).

### 3. Chapter-error dialog — "Back to novel"

- `ChapterErrorOverlay` gains an `onBack: () => void` prop. Render a secondary
  button "Back to novel" next to "Retry" (chrome-style, e.g. transparent bg +
  `theme.rule` border so "Retry" stays the primary). Wire the call site
  (`<ChapterErrorOverlay … onBack={onClose} />`). `onClose` returns to the novel
  detail page. The novel-level `FullPaneError` already closes via its button — no
  change there.

## Files

- `src/sources/extensions/kolnovel-theme.ts` — add `parseChapterContent` +
  moved helpers; update header comment.
- `src/sources/extensions/kolnovel.ts` — use `parseChapterContent`; delete moved
  code + now-unused imports.
- `src/sources/extensions/kolnovel-pro.ts` — HTML-first/PDF-fallback
  `getChapterContent`; `searchSuggest` + `search` via `ts_ac_do_search`;
  `liveSearchCards` helper; meta description.
- `src/components/SourceStreamReader.tsx` — `ChapterErrorOverlay` `onBack` button.

## Testing / verification

- `npx tsc --noEmit` (gate per task) and `npm run build` green.
- Manual `npm run tauri dev`: open a pro novel → read a chapter (clean RTL text +
  inline illustrations, no PDF round-trip); search "ري زيرو" → live dropdown shows
  Re:Zero entries and submitting shows the grid; force a chapter error (e.g. a
  members-only chapter) → dialog shows "Retry" + "Back to novel", and "Back to
  novel" returns to the detail page. Free KolNovel chapters still read correctly
  (shared-extractor regression check).

## Out of scope (YAGNI)

- Changing the **free** source's search or chapter extraction (free `?s=` works;
  free keeps `#kol_content` HTML).
- Removing the PDF code or `pdfjs-dist` (kept deliberately as the fallback).
- Paginating pro search (the autocomplete API returns a single ~10-result set).
- The novel-level `FullPaneError` (already has a working close/back).
- A teaser/locked-snippet heuristic for chapter HTML. HTML-first treats **any**
  extracted content as the chapter (empty → PDF fallback). No pro chapter has
  been observed to serve a partial teaser (the reportedly "members-only" post
  238214 returned its full 501-paragraph body), and a minimum-length gate would
  wrongly divert legitimately short / image-heavy chapters to the PDF endpoint
  (which fails for HTML-only chapters). Revisit only if real teasers appear.
