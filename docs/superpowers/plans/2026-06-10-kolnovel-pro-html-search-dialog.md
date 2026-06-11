# KolNovel Pro — HTML chapters + live search + dialog back — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make KolNovel Pro read chapters from page HTML (PDF kept as a fallback), drive search off the site's live autocomplete API, and add a "Back to novel" action to the chapter-load error dialog.

**Architecture:** Lift the free source's chapter-body extractor into the shared theme module (`parseChapterContent`, parameterized by base URL, with `.epcontent` added to the root preference) so both sources share it. Pro's `getChapterContent` tries HTML first and falls back to the existing PDF token flow only when the HTML body is empty. Pro's `search`/`searchSuggest` call `admin-ajax.php?action=ts_ac_do_search` (JSON). A secondary button in `ChapterErrorOverlay` calls the reader's `onClose`, which reveals the novel detail page underneath.

**Tech Stack:** TypeScript, the in-repo Sources subsystem (`SourceHost` HTTP bridge, `parseHtmlDocument`), React. Spec: `docs/superpowers/specs/2026-06-10-kolnovel-pro-html-search-dialog-design.md`.

**Testing note:** This repo has no unit-test runner (none in `package.json`; existing sources verify manually). Every task's automated gate is `npx tsc --noEmit`. Integration is verified manually with `npm run tauri dev`, exactly as the existing sources are. Endpoints + DOM structure were already validated live via Playwright (see spec recon).

**Task order** (each type-checks independently): 1 shared `parseChapterContent` → 2 free source uses it → 3 pro HTML-first chapters → 4 pro live search → 5 dialog "Back to novel" → 6 build + manual verification.

---

## Task 1: Add shared `parseChapterContent` to the theme module

**Files:**
- Modify: `src/sources/extensions/kolnovel-theme.ts`

- [ ] **Step 1: Import `SourceLine`**

In `kolnovel-theme.ts`, the type import block currently lists
`NovelCard, SourceChapter, SourceNovel, SourceNovelMeta, SourceSearchResult, SourceSection, SourceVolume`.
Add `SourceLine`:

```ts
import type {
  NovelCard,
  SourceChapter,
  SourceLine,
  SourceNovel,
  SourceNovelMeta,
  SourceSearchResult,
  SourceSection,
  SourceVolume,
} from "../types";
```

- [ ] **Step 2: Update the file header comment**

Replace the existing header note that says chapter-body extraction is NOT here:

```ts
// Shared KolNovel WordPress-theme parsers. Both the free source
// (free.kolnovel.com) and the pro source (kolnovel.com) render their browse,
// search, novel, AND chapter pages with the same theme, so the DOM→data
// parsing lives here once and is parameterized by base URL. `parseChapterContent`
// handles chapter bodies for both (free = always HTML; pro = HTML-first with a
// PDF fallback owned by kolnovel-pro.ts).
```

- [ ] **Step 3: Append the extractor + helpers at the end of the file**

Add this block at the end of `kolnovel-theme.ts` (moved verbatim from `kolnovel.ts`, with two changes: `absoluteImageSrc` now takes `baseUrl`, and the root preference adds `.epcontent`):

```ts
// ── chapter-body extraction (static HTML) ───────────────────────────────────
//
// Shared by the free and pro sources. KolNovel chapter pages carry rotating
// per-load hex class names that mark decoy paragraphs (duplicated text + the
// kolnovel.com ad string); the discovery + filtering below handle them. On the
// pro site the body is clean, so the decoy filter is simply a no-op there.

const IGNORED_PATTERNS = [
  "*إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات ko*lno*vel ko*lno*vel. com",
];
const IGNORED_REGEXES = IGNORED_PATTERNS.map(toIgnoreRegex);

function toIgnoreRegex(pattern: string): RegExp {
  const trimmed = pattern.replace(/^\*+|\*+$/g, "");
  const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*?");
  return new RegExp(`\\s*\\*?\\s*${withWildcards}\\s*\\*?\\s*`, "gi");
}

function extractHiddenClassesFromCss(cssText: string): Set<string> {
  const out = new Set<string>();
  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRegex.exec(cssText)) !== null) {
    const selectors = m[1];
    const body = m[2].toLowerCase();
    if (
      !body.includes("0.1px") ||
      !body.includes("-99999px") ||
      !/opacity\s*:\s*0\b/.test(body)
    ) {
      continue;
    }
    const classMatches = selectors.match(/\.([a-f0-9]{20,})/g) || [];
    for (const c of classMatches) out.add(c.slice(1));
  }
  return out;
}

function collectHiddenClasses(doc: Document): Set<string> {
  const out = new Set<string>();
  for (const styleEl of Array.from(doc.querySelectorAll("style"))) {
    const css = styleEl.textContent || "";
    if (!css) continue;
    for (const c of extractHiddenClassesFromCss(css)) out.add(c);
  }
  return out;
}

function hasHiddenClass(p: Element, hidden: Set<string>): boolean {
  if (hidden.size === 0) return false;
  const cls = (p.getAttribute("class") || "").trim();
  if (!cls) return false;
  for (const c of cls.split(/\s+/)) {
    if (hidden.has(c)) return true;
  }
  return false;
}

function isDecorativeImage(img: HTMLImageElement): boolean {
  const cls = (img.getAttribute("class") || "").toLowerCase();
  if (cls.includes("wp-post-image")) return true;
  if (cls.includes("attachment-post-thumbnail")) return true;
  if (cls.includes("avatar")) return true;
  if (cls.includes("emoji")) return true;
  const src = (img.getAttribute("src") || "").toLowerCase();
  if (src.includes("/ads/") || src.includes("doubleclick")) return true;
  return false;
}

function absoluteImageSrc(img: HTMLImageElement, baseUrl: string): string | null {
  const raw =
    img.getAttribute("src") ||
    img.getAttribute("data-src") ||
    img.getAttribute("data-lazy-src");
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

function isHiddenInline(p: Element): boolean {
  const style = (p.getAttribute("style") || "").toLowerCase();
  if (!style) return false;
  return (
    style.includes("0.1px") &&
    style.includes("position") &&
    style.includes("fixed") &&
    style.includes("opacity") &&
    style.includes("text-indent")
  );
}

function paragraphText(p: Element): string {
  const clone = p.cloneNode(true) as Element;
  clone.querySelectorAll("script, noscript, style").forEach((n) => n.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function stripIgnored(line: string): string {
  let out = line;
  for (const r of IGNORED_REGEXES) out = out.replace(r, " ");
  return out.replace(/\s+/g, " ").trim();
}

/** Parse a KolNovel chapter page's body into SourceLines (text + image).
 *  Root preference: `#kol_content` (free theme), `.epcontent` (pro theme),
 *  then `.entry-content`, then body. `baseUrl` absolutizes relative image
 *  srcs. Drops decoy paragraphs (rotating hidden hex classes / inline hide
 *  style), strips the ad string, and dedups repeated text/images. */
export function parseChapterContent(doc: Document, baseUrl: string): SourceLine[] {
  const hiddenClasses = collectHiddenClasses(doc);
  const root =
    doc.querySelector("#kol_content") ||
    doc.querySelector(".epcontent") ||
    doc.querySelector(".entry-content") ||
    doc.body;

  const items = root.querySelectorAll("p, img");
  const lines: SourceLine[] = [];
  const seenText = new Set<string>();
  const seenImage = new Set<string>();
  for (const el of Array.from(items)) {
    if (el.tagName === "IMG") {
      const img = el as HTMLImageElement;
      if (isDecorativeImage(img)) continue;
      const src = absoluteImageSrc(img, baseUrl);
      if (!src) continue;
      if (seenImage.has(src)) continue;
      seenImage.add(src);
      lines.push({ type: "image", content: src });
      continue;
    }
    const p = el;
    if (hasHiddenClass(p, hiddenClasses)) continue;
    if (isHiddenInline(p)) continue;
    const rawText = paragraphText(p);
    if (rawText.length === 0) continue;
    const text = stripIgnored(rawText);
    if (text.length === 0) continue;
    if (seenText.has(text)) continue;
    seenText.add(text);
    lines.push({ type: "text", content: text });
  }
  return lines;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (`parseChapterContent` is exported; `kolnovel.ts` still has its own copy — duplicate private names across files are fine. No consumer yet.)

- [ ] **Step 5: Commit**

```bash
git add src/sources/extensions/kolnovel-theme.ts
git commit -m "refactor(sources): add shared parseChapterContent to KolNovel theme"
```

---

## Task 2: Point the free source at the shared extractor

**Files:**
- Modify: `src/sources/extensions/kolnovel.ts`

- [ ] **Step 1: Import `parseChapterContent`**

In `kolnovel.ts`, add `parseChapterContent` to the existing import from `./kolnovel-theme`:

```ts
import {
  parseChapterContent,
  parseHomeSections,
  parseNovelPage,
  parseSearchResults,
} from "./kolnovel-theme";
```

- [ ] **Step 2: Use it in `getChapterContent`**

Replace the body's final line `return extractChapterLines(doc);` with:

```ts
      return parseChapterContent(doc, BASE_URL);
```

- [ ] **Step 3: Delete the now-moved private code**

Delete these from `kolnovel.ts` (all moved to the theme module in Task 1):
`IGNORED_PATTERNS`, `IGNORED_REGEXES`, `toIgnoreRegex`, `extractHiddenClassesFromCss`,
`collectHiddenClasses`, `extractChapterLines`, `hasHiddenClass`, `isDecorativeImage`,
`absoluteImageSrc`, `isHiddenInline`, `paragraphText`, `stripIgnored` — i.e. the
entire span from the `IGNORED_PATTERNS` const down to the end of `stripIgnored`
(everything below the `createKolNovelSource` function's closing brace, plus the two
top-of-file consts `IGNORED_PATTERNS`/`IGNORED_REGEXES` and `toIgnoreRegex`/
`extractHiddenClassesFromCss`/`collectHiddenClasses` defined above the factory).

- [ ] **Step 4: Remove now-unused imports**

`SourceLine` is no longer referenced in `kolnovel.ts` after the deletion. Change:

```ts
import type {
  Source,
  SourceHost,
} from "../types";
```

(Keep `Source` and `SourceHost`; drop `SourceLine`.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. If tsc reports any other unused import/const left behind by the deletion, remove it.

- [ ] **Step 6: Commit**

```bash
git add src/sources/extensions/kolnovel.ts
git commit -m "refactor(sources): KolNovel free uses shared parseChapterContent"
```

---

## Task 3: Pro chapters — HTML-first with PDF fallback

**Files:**
- Modify: `src/sources/extensions/kolnovel-pro.ts`

- [ ] **Step 1: Import `parseChapterContent`**

Add it to the `./kolnovel-theme` import (which currently imports
`parseHomeSections, parseNovelPage, parseSearchResults`):

```ts
import {
  parseChapterContent,
  parseHomeSections,
  parseNovelPage,
  parseSearchResults,
} from "./kolnovel-theme";
```

(`parseSearchResults` stays for now — Task 4 removes it.)

- [ ] **Step 2: Rewrite `getChapterContent` to try HTML first**

Replace the whole `async getChapterContent(chapter): Promise<SourceLine[]> { … }`
method body with:

```ts
    async getChapterContent(chapter): Promise<SourceLine[]> {
      host.log("debug", `getChapterContent(#${chapter.id}) ${chapter.url}`);
      // HTML-first: the pro site serves the chapter text + official
      // illustrations inline in `.epcontent`. Read that directly — no PDF
      // round-trip, no token flow.
      const resp = await host.fetch(chapter.url);
      const htmlLines = parseChapterContent(parseHtmlDocument(resp.text), BASE_URL);
      if (htmlLines.length > 0) return htmlLines;

      // Fallback: a chapter with no readable HTML body (older PDF-only posts,
      // or the site reverting to PDF delivery). Use the ts_ln_dl_url token
      // flow + pdf.js, exactly as before.
      host.log("debug", `no HTML body — falling back to PDF for ${chapter.url}`);
      const postId = extractPostId(chapter.url);
      if (!postId) {
        throw new Error(`Could not find a post id in chapter URL: ${chapter.url}`);
      }
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
```

(`imageStore`, `resolveImage`, `extractPostId`, `requestPdfUrl`, `assertPdf`,
and the `extractPdfLines`/`ExtractedImage` import all stay — they back the
fallback.)

- [ ] **Step 3: Update the source description + header**

Change `meta.description` to:

```ts
      description:
        "Arabic novels from kolnovel.com — read as HTML chapters with the official illustrations (PDF fallback for chapters without HTML).",
```

Update the top-of-file comment's first paragraph to reflect HTML-first (replace the
"each chapter is a downloadable PDF" sentence):

```ts
// KolNovel Pro source — kolnovel.com. Browse/search/novel pages reuse the
// shared KolNovel theme parsers. Chapter content is read HTML-first from the
// page's `.epcontent` body; chapters that ship only a downloadable PDF fall
// back to the site's ts_ln_dl_url token flow parsed with pdf.js.
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/extensions/kolnovel-pro.ts
git commit -m "feat(sources): KolNovel Pro reads HTML chapters (PDF fallback)"
```

---

## Task 4: Pro search — live autocomplete API

**Files:**
- Modify: `src/sources/extensions/kolnovel-pro.ts`

- [ ] **Step 1: Adjust imports**

`parseSearchResults` is no longer used. Reduce the `./kolnovel-theme` import to:

```ts
import {
  parseChapterContent,
  parseHomeSections,
  parseNovelPage,
} from "./kolnovel-theme";
```

Add `NovelCard` to the types import:

```ts
import type { NovelCard, Source, SourceHost, SourceLine } from "../types";
```

- [ ] **Step 2: Replace the `search` method and add `searchSuggest`**

Replace the existing `async search(query, page) { … }` method with both methods:

```ts
    async search(query) {
      host.log("info", `search(${query}) via ts_ac_do_search`);
      const cards = await liveSearch(host, query);
      return { cards, hasMore: false, query, page: 1 };
    },

    async searchSuggest(query) {
      host.log("info", `searchSuggest(${query})`);
      return liveSearch(host, query);
    },
```

- [ ] **Step 3: Add the live-search helper + JSON types at module scope**

Add near the other module-level helpers (e.g. just above `extractPostId`):

```ts
interface TsAcItem {
  post_title?: string;
  post_link?: string;
  post_image?: string;
  post_genres?: string;
  post_status?: string;
}
interface TsAcResponse {
  series?: Array<{ all?: TsAcItem[] }>;
}

/** Query the site's live autocomplete (the only working search on the pro
 *  site — the `?s=` results page returns a WordPress error). GET
 *  admin-ajax.php?action=ts_ac_do_search&ts_ac_query=… → JSON. Returns [] on
 *  empty query or unparseable response. */
async function liveSearch(host: SourceHost, query: string): Promise<NovelCard[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${AJAX_URL}?action=ts_ac_do_search&ts_ac_query=${encodeURIComponent(q)}`;
  const resp = await host.fetch(url, {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  let json: TsAcResponse;
  try {
    json = JSON.parse(resp.text) as TsAcResponse;
  } catch {
    return [];
  }
  return liveSearchCards(json);
}

/** Flatten the ts_ac JSON (`series[].all[]`) into NovelCards. Links + images
 *  are already absolute kolnovel.com URLs. */
function liveSearchCards(json: TsAcResponse): NovelCard[] {
  const out: NovelCard[] = [];
  for (const group of json.series ?? []) {
    for (const item of group.all ?? []) {
      const url = (item.post_link ?? "").trim();
      const title = (item.post_title ?? "").replace(/\s+/g, " ").trim();
      if (!url || !title) continue;
      const genres = (item.post_genres ?? "")
        .split(",")
        .map((g) => g.trim())
        .filter((g) => g.length > 0)
        .slice(0, 3);
      const status = (item.post_status ?? "").trim();
      const badges = [...genres];
      if (status) badges.push(status);
      out.push({
        url,
        title,
        coverUrl: item.post_image ? item.post_image.trim() : undefined,
        badges: badges.length > 0 ? badges : undefined,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (The `search(query)` signature with one param still satisfies the
optional `search?(query, page?)` interface member. `parseSearchResults` import was
removed in Step 1.)

- [ ] **Step 5: Commit**

```bash
git add src/sources/extensions/kolnovel-pro.ts
git commit -m "fix(sources): KolNovel Pro search via live ts_ac autocomplete API"
```

---

## Task 5: "Back to novel" in the chapter-error dialog

**Files:**
- Modify: `src/components/SourceStreamReader.tsx`

- [ ] **Step 1: Add `onBack` to `ChapterErrorOverlay` and render the button**

Replace the `ChapterErrorOverlay` component (currently ending with the single
"Retry" button) so it takes `onBack` and renders two buttons:

```tsx
function ChapterErrorOverlay({
  theme,
  message,
  onRetry,
  onBack,
}: {
  theme: Theme;
  message: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: `${theme.bg}f0`,
        fontFamily: FONT_STACKS.sans,
      }}
    >
      <div
        style={{
          background: theme.chrome,
          border: `0.5px solid ${theme.rule}`,
          borderRadius: 10,
          padding: 20,
          maxWidth: 480,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          Couldn't load this chapter
        </div>
        <div style={{ fontSize: 13, color: theme.muted, lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onRetry}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontFamily: "inherit",
              background: theme.ink,
              color: theme.bg,
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
          <button
            onClick={onBack}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontFamily: "inherit",
              background: "transparent",
              color: theme.ink,
              border: `0.5px solid ${theme.rule}`,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Back to novel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Pass `onBack` at the call site**

At the `<ChapterErrorOverlay … />` usage, add `onBack={onClose}`:

```tsx
        <ChapterErrorOverlay
          theme={theme}
          message={chapterError ?? ""}
          onRetry={() => {
            cacheRef.current.delete(currentChapter);
            void fetchChapter(currentChapter);
          }}
          onBack={onClose}
        />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/SourceStreamReader.tsx
git commit -m "feat(reader): add 'Back to novel' to the chapter-load error dialog"
```

---

## Task 6: Build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Build**

Run: `npx tsc --noEmit && npm run build`
Expected: both PASS (pre-existing INEFFECTIVE_DYNAMIC_IMPORT / chunk-size warnings unrelated).

- [ ] **Step 2: Manual pass with `npm run tauri dev`**

- **Pro chapter (HTML):** add/open the Re:Zero novel
  (`https://kolnovel.com/series/rezero-starting-life-in-another-world/`), open a
  chapter → clean RTL Arabic text with inline illustrations, no "PDF not available"
  error. Try the chapter that previously failed (post 238214, "… 2").
- **Pro search:** in the Store search for "ري زيرو" → the live dropdown shows
  Re:Zero entries as you type, and submitting shows the results grid. Clicking a
  result opens its novel detail page.
- **Dialog back:** open a members-only / unavailable chapter (HTML empty + PDF
  unavailable) → the error dialog shows "Retry" and "Back to novel"; clicking
  "Back to novel" returns to the novel detail page.
- **Free regression:** open a free.kolnovel.com chapter → still reads correctly
  (shared `parseChapterContent`), decoy/ad text still filtered.

- [ ] **Step 3: Final branch state**

Confirm `git status` is clean and the branch is `feat/kolnovel-pro-html-chapters`.

---

## Self-review notes (author)

- **Spec coverage:** Item 1 HTML-first + PDF fallback (Tasks 1–3) ✓; item 2 search/searchSuggest via ts_ac (Task 4) ✓; item 3 dialog back (Task 5) ✓; PDF kept (no package.json change) ✓; free unchanged except the shared-extractor swap (Task 2) ✓.
- **Type consistency:** `parseChapterContent(doc, baseUrl)` defined in Task 1, called identically in Tasks 2 & 3. `liveSearch(host, query)` / `liveSearchCards(json)` / `TsAcResponse`/`TsAcItem` consistent within Task 4. `ChapterErrorOverlay` prop set `{theme, message, onRetry, onBack}` matches the call site in Task 5.
- **No placeholders:** every code step has full code; deletions in Task 2 enumerate exact symbols; tsc is the gate with the "remove any other unused import tsc flags" escape hatch matching repo precedent.
