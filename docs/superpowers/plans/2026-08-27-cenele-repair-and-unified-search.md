# Cenele Repair + Unified Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the Cenele extension against the site's redesigned novel page, and collapse every source onto one search interaction — type, press Enter, get a results grid.

**Architecture:** Cenele's chapter pipeline is verified working and untouched; only the novel page's config global and metadata selectors are rewritten. `Source.searchSuggest` is deleted from the interface and `Source.search` becomes required, so `SourceHomeView` loses its debounce/dropdown machinery and gains a Load-more control driven by the already-existing-but-unused `SourceSearchResult.hasMore`.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, happy-dom (added here), Tauri 2.

**Spec:** `docs/superpowers/specs/2026-08-27-riwaq-extensions-design.md`

## Global Constraints

- **Search is Enter-only.** No live-suggestion dropdowns, no debounced
  as-you-type calls. Every source implements `search(query, page)`.
- **`Source.search` is required**; `Source.searchSuggest` must not exist
  anywhere after Task 5.
- **Never emit KolNovel pagination URLs.** Both `?s=<q>&paged=<N>` and
  `/page/<N>/?s=<q>` return HTTP 500. KolNovel search always returns
  `hasMore: false`.
- **Cenele search URL form:** page 1 is
  `https://cenele.com/?s=<q>&post_type=wp-manga`; page N>1 is
  `https://cenele.com/page/<N>/?s=<q>&post_type=wp-manga`.
- **Do not touch** Cenele's `getChapterContent`, decoy filter
  (`isDecoyElement`, `hasHiddenStyle`, `looksLikePiracyDecoy`),
  `fetchVolumeChapters`, `parseChapterListHtml`, `searchChapters`, or the
  home-section parsers. All were verified working against the live site
  on 2026-08-27.
- **Test command:** `pnpm test` (runs `vitest run`). Single file:
  `pnpm vitest run <path>`.
- Parser tests need a DOM. Add `// @vitest-environment happy-dom` as the
  first line of any test file that uses `DOMParser`; the global vitest
  environment stays `node`.
- Commit after every task. Conventional-commit prefixes (`fix:`, `feat:`,
  `test:`, `refactor:`, `chore:`), matching the existing log style.

---

### Task 1: DOM test harness + Cenele `nhvNovelV2` config

Cenele replaced `var nhvMangaSingleAjax = {...}` with
`var nhvNovelV2 = {...}`, and split the nonce: the chapters AJAX now
takes `chaptersNonce` (not `nonce`) and `postId` (not `manga_id`).

**Files:**
- Modify: `package.json` (add `happy-dom` devDependency)
- Create: `src/sources/extensions/__fixtures__/cenele-novel.html`
- Modify: `src/sources/extensions/cenele.ts:403-428` (replace `NhvMangaSingleAjax` + `extractMangaSingleAjax`)
- Create: `src/sources/extensions/cenele.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `export function extractNovelConfig(html: string): NovelConfig | null`
  - `export interface NovelConfig { postId: string; chaptersNonce: string }`
  - Fixture at `src/sources/extensions/__fixtures__/cenele-novel.html`,
    reused by Tasks 2 and 3.

- [ ] **Step 1: Install the DOM test environment**

```bash
pnpm add -D happy-dom
```

- [ ] **Step 2: Create the fixture**

Create `src/sources/extensions/__fixtures__/cenele-novel.html`. This is
trimmed from the live `https://cenele.com/cont/pursuit/` page captured
2026-08-27 — real markup, irrelevant sections removed.

```html
<!doctype html>
<html lang="ar" dir="rtl">
<head><title>السعي وراء الحقيقة – فضاء الروايات</title></head>
<body>
<script id="wp-manga-js-extra">
var manga = {"ajax_url":"https://cenele.com/wp-admin/admin-ajax.php","manga_id":"32235"};
</script>
<script id="nhv-novel-single-v2-js-extra">
var nhvNovelV2 = {"ajaxurl":"https://cenele.com/wp-admin/admin-ajax.php","nonce":"0367ecdfde","postId":"32235","chaptersNonce":"6d7f45aa72","isLoggedIn":"","loading":"جارٍ التحميل…"};
</script>
<article class="nhv-novel-hero post-32235 wp-manga">
  <div class="nhv-novel-cover">
    <img width="768" height="1024"
      src="https://cenele.com/wp-content/uploads/2021/12/cover-768x1024.webp"
      class="attachment-large size-large wp-post-image" alt="السعي وراء الحقيقة"
      srcset="https://cenele.com/wp-content/uploads/2021/12/cover-768x1024.webp 768w, https://cenele.com/wp-content/uploads/2021/12/cover-225x300.webp 225w">
  </div>
  <div class="nhv-novel-hero__content">
    <p class="nhv-novel-kicker">رواية Pursuit of the Truth</p>
    <h1 class="nhv-novel-title">السعي وراء الحقيقة</h1>
    <div class="nhv-novel-meta">
      <div><span><svg class="nhv-inline-icon"></svg> النوع</span><strong>صينية</strong></div>
      <div class="nhv-novel-status is-ongoing"><span><svg class="nhv-inline-icon"></svg> الحالة</span><strong>مستمرة</strong></div>
      <div><span><svg class="nhv-inline-icon"></svg> الفصول</span><strong>225</strong></div>
      <div><span><svg class="nhv-inline-icon"></svg> المشاهدات</span><strong>66٬355</strong></div>
      <div><span><svg class="nhv-inline-icon"></svg> المؤلف</span><strong><a href="https://cenele.com/cont-author/er-gen/" rel="tag">Er Gen</a></strong></div>
      <div><span><svg class="nhv-inline-icon"></svg> المترجم</span><strong>بلا حدود</strong></div>
    </div>
    <div class="nhv-novel-genres" aria-label="تصنيفات الرواية">
      <a href="https://cenele.com/cont-genre/action/">أكشن</a>
      <a href="https://cenele.com/cont-genre/xianxia/">زيانشيا</a>
      <a href="https://cenele.com/cont-genre/mystery/">غموض</a>
    </div>
    <div class="nhv-novel-tags" data-nhv-tags="">
      <a href="https://cenele.com/cont-tag/cultivation/">الزراعة</a>
      <a href="https://cenele.com/cont-tag/revenge/">الانتقام</a>
    </div>
  </div>
</article>
<nav class="nhv-novel-tabs" role="tablist">
  <button class="is-active" type="button" role="tab" data-nhv-section="summary">القصة</button>
  <button type="button" role="tab" data-nhv-section="chapters">قائمة الفصول</button>
</nav>
<div class="nhv-novel-panel" id="nhv-novel-panel" data-nhv-section-panel data-nhv-initial-section="summary">
  <div class="nhv-novel-synopsis">
    <p>سجن أبدي، جسد بلا روح، روح مختومة، كل شيء ضاع.</p>
  </div>
</div>
</body>
</html>
```

- [ ] **Step 3: Write the failing test**

Create `src/sources/extensions/cenele.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractNovelConfig } from "./cenele";

const novelHtml = readFileSync(
  join(__dirname, "__fixtures__/cenele-novel.html"),
  "utf8",
);

describe("extractNovelConfig", () => {
  it("reads postId and chaptersNonce from nhvNovelV2", () => {
    expect(extractNovelConfig(novelHtml)).toEqual({
      postId: "32235",
      chaptersNonce: "6d7f45aa72",
    });
  });

  it("prefers chaptersNonce over the section nonce", () => {
    // nhvNovelV2.nonce is 0367ecdfde and belongs to nhv_novel_v2_section,
    // NOT to the chapters AJAX. Picking it would 403 every chapter fetch.
    expect(extractNovelConfig(novelHtml)?.chaptersNonce).not.toBe("0367ecdfde");
  });

  it("returns null when the config global is absent", () => {
    expect(extractNovelConfig("<html><body>no config</body></html>")).toBeNull();
  });

  it("returns null when chaptersNonce is missing", () => {
    const html = `<script>var nhvNovelV2 = {"postId":"1","nonce":"abc"};</script>`;
    expect(extractNovelConfig(html)).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run src/sources/extensions/cenele.test.ts`
Expected: FAIL — `extractNovelConfig` is not exported from `./cenele`.

- [ ] **Step 5: Replace the config extractor**

In `src/sources/extensions/cenele.ts`, delete the `NhvMangaSingleAjax`
interface and `extractMangaSingleAjax` function (lines ~403-428) and put
this in their place:

```ts
export interface NovelConfig {
  /** Numeric WordPress post id of the novel. Sent as `manga_id`. */
  postId: string;
  /** Nonce for `nhv_manga_single_chapters_page` and
   *  `nhv_search_manga_chapters`. Distinct from `nhvNovelV2.nonce`,
   *  which belongs to the `nhv_novel_v2_section` tab-content action. */
  chaptersNonce: string;
}

/** Extract the chapter-list credentials from the novel page's inline
 *  config: `var nhvNovelV2 = {"ajaxurl":"…","nonce":"…","postId":"…",
 *  "chaptersNonce":"…", …};`. Replaced `nhvMangaSingleAjax` when the
 *  site redesigned its novel page (see docs/store-feature/cenele.md). */
export function extractNovelConfig(html: string): NovelConfig | null {
  const m = html.match(/var\s+nhvNovelV2\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]) as Record<string, unknown>;
    const postId = asIdString(obj.postId);
    const chaptersNonce =
      typeof obj.chaptersNonce === "string" ? obj.chaptersNonce : null;
    if (!postId || !chaptersNonce) return null;
    return { postId, chaptersNonce };
  } catch {
    return null;
  }
}

function asIdString(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  return null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run src/sources/extensions/cenele.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/sources/extensions/cenele.ts \
        src/sources/extensions/cenele.test.ts \
        src/sources/extensions/__fixtures__/cenele-novel.html
git commit -m "fix(cenele): read chapter credentials from nhvNovelV2"
```

---

### Task 2: Cenele novel-page metadata

Every selector `parseNovelPage` used returns zero nodes on the redesigned
page. Rewrite the metadata extraction; leave the AJAX volume logic that
follows it alone.

**Files:**
- Modify: `src/sources/extensions/cenele.ts` (`parseNovelPage`, `extractDescription`, `extractVolumeShells`)
- Modify: `src/sources/extensions/cenele.test.ts`

**Interfaces:**
- Consumes: `extractNovelConfig(html)` and the fixture from Task 1.
- Produces: `export function parseNovelPage(doc: Document, pageUrl: string): ParsedNovelPage`
  where `ParsedNovelPage` keeps its existing fields but `mangaId` is fed
  from `NovelConfig.postId` and `chaptersNonce` from
  `NovelConfig.chaptersNonce`.

- [ ] **Step 1: Write the failing test**

Append to `src/sources/extensions/cenele.test.ts`:

```ts
import { parseNovelPage } from "./cenele";

const parse = () =>
  parseNovelPage(
    new DOMParser().parseFromString(novelHtml, "text/html"),
    "https://cenele.com/cont/pursuit/",
  );

describe("parseNovelPage", () => {
  it("reads title, original title and cover", () => {
    const n = parse();
    expect(n.title).toBe("السعي وراء الحقيقة");
    expect(n.originalTitle).toBe("Pursuit of the Truth");
    expect(n.coverUrl).toBe(
      "https://cenele.com/wp-content/uploads/2021/12/cover-768x1024.webp",
    );
  });

  it("keeps genres and tags as separate lists", () => {
    const n = parse();
    expect(n.tags).toEqual([
      "أكشن", "زيانشيا", "غموض", "الزراعة", "الانتقام",
    ]);
  });

  it("reads the site's own status text, which the badge renders verbatim", () => {
    // NovelDetailView renders novel.status as-is (NovelDetailView.tsx:629),
    // so this must stay the site's Arabic string — normalizing it to
    // "ongoing" would print English into an Arabic UI.
    expect(parse().status).toBe("مستمرة");
  });

  it("builds label/value meta rows and links them", () => {
    const n = parse();
    expect(n.meta).toContainEqual({ label: "النوع", value: "صينية" });
    expect(n.meta).toContainEqual({
      label: "المؤلف",
      value: "Er Gen",
      url: "https://cenele.com/cont-author/er-gen/",
    });
  });

  it("lifts the author out of the meta rows", () => {
    expect(parse().author).toBe("Er Gen");
  });

  it("reads the synopsis", () => {
    expect(parse().description).toContain("سجن أبدي");
  });

  it("carries the chapter credentials through", () => {
    const n = parse();
    expect(n.mangaId).toBe("32235");
    expect(n.chaptersNonce).toBe("6d7f45aa72");
  });

  it("throws a page-identifying error when the config is missing", () => {
    const doc = new DOMParser().parseFromString(
      "<html><body>nope</body></html>", "text/html");
    expect(() => parseNovelPage(doc, "https://cenele.com/cont/x/")).toThrow(
      /https:\/\/cenele\.com\/cont\/x\//,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/sources/extensions/cenele.test.ts`
Expected: FAIL — title/cover/tags assertions fail; old selectors match nothing.

- [ ] **Step 3: Rewrite the metadata extraction**

Replace the body of `parseNovelPage` in `src/sources/extensions/cenele.ts`
from the `const title = ...` line through the `const volumeShells = ...`
line with:

```ts
  const title = sanitizeText(doc.querySelector(".nhv-novel-title")?.textContent);

  // The kicker reads "رواية <Original Title>". Strip the leading word so
  // the stored originalTitle is just the name.
  const originalTitle =
    sanitizeText(doc.querySelector(".nhv-novel-kicker")?.textContent)
      .replace(/^رواية\s+/, "") || undefined;

  const coverImg = doc.querySelector(
    ".nhv-novel-cover img",
  ) as HTMLImageElement | null;
  const coverUrl = pickImageSrc(coverImg);

  // Genres and tags are separate lists on the redesigned page. We flatten
  // them into one `tags` array because SourceNovel models a single chip
  // set, and the reader treats both the same way.
  const tags = [
    ...Array.from(doc.querySelectorAll(".nhv-novel-genres a")),
    ...Array.from(doc.querySelectorAll(".nhv-novel-tags a")),
  ]
    .map((a) => sanitizeText(a.textContent))
    .filter((s) => s.length > 0);

  // The status row is one of the meta rows, distinguished by an
  // `is-ongoing` / `is-completed` class. We take its <strong> text rather
  // than deriving a normalized token from the class: SourceNovel.status is
  // a display field rendered verbatim as a badge, so the site's own Arabic
  // wording is what belongs in it.
  const status = sanitizeText(
    doc.querySelector(".nhv-novel-status strong")?.textContent,
  );

  // Each meta row is `<div><span>[svg] Label</span><strong>Value</strong></div>`.
  // The svg contributes no textContent, so trimming the span is enough.
  const meta: SourceNovelMeta[] = [];
  let author = "";
  const seenLabels = new Set<string>();
  for (const row of Array.from(doc.querySelectorAll(".nhv-novel-meta > div"))) {
    const label = sanitizeText(row.querySelector("span")?.textContent);
    const valueEl = row.querySelector("strong");
    const value = sanitizeText(valueEl?.textContent);
    if (!label || !value) continue;
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    const linkEl = valueEl?.querySelector("a");
    meta.push({
      label,
      value,
      url: linkEl
        ? absolutizeUrl(linkEl.getAttribute("href") || "", BASE_URL)
        : undefined,
    });
    if (/مؤلف|كاتب|author|writer/i.test(label) && !author) {
      author = value;
    }
  }

  const description = extractDescription(doc);
  const volumeShells = extractVolumeShells(doc);
```

- [ ] **Step 4: Point the config read at the new extractor**

At the top of `parseNovelPage`, replace the `extractMangaSingleAjax` call:

```ts
  const html = doc.documentElement.outerHTML;
  const config = extractNovelConfig(html);
  if (!config) {
    throw new Error(
      `Cenele: couldn't find nhvNovelV2 config on ${pageUrl}. The site layout may have changed, or this isn't a novel page.`,
    );
  }
```

and in the returned object replace the two credential fields:

```ts
    mangaId: config.postId,
    chaptersNonce: config.chaptersNonce,
```

- [ ] **Step 5: Update the two helpers the redesign moved**

`extractDescription` — the excerpt classes are gone; the synopsis is now
a block inside the summary panel:

```ts
function extractDescription(doc: Document): string | undefined {
  const el = doc.querySelector(".nhv-novel-synopsis");
  if (!el) return undefined;
  const text = sanitizeText(el.textContent);
  if (!text) return undefined;
  const cleaned = text.replace(/Read more$/i, "").trim();
  return cleaned.length > 1500 ? cleaned.slice(0, 1500).trim() + "…" : cleaned;
}
```

`extractVolumeShells` — `.nhv-volume-card` no longer exists in the page
HTML; volumes come from the `meta_only` AJAX call that `getNovel` already
makes. Return an empty list rather than deleting the function, so
`ParsedNovelPage` keeps its shape and `getNovel` is untouched:

```ts
/** The redesigned novel page ships no volume markup — the chapters tab
 *  loads volumes over AJAX. getNovel gets the canonical list from
 *  fetchVolumeMeta's `meta_only=1` call, so there is nothing to scrape
 *  here. Kept (returning empty) so ParsedNovelPage's shape is stable. */
function extractVolumeShells(_doc: Document): VolumeShell[] {
  return [];
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/sources/extensions/cenele.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. If `extractMangaSingleAjax` is reported unused,
delete any leftover reference.

- [ ] **Step 8: Commit**

```bash
git add src/sources/extensions/cenele.ts src/sources/extensions/cenele.test.ts
git commit -m "fix(cenele): parse the redesigned novel page metadata"
```

---

### Task 3: Cenele search, and the end of suggestions

Cenele has a real WordPress search results page. Implement `search()`
against it and delete the suggest path — nonce scrape included.

**Files:**
- Create: `src/sources/extensions/__fixtures__/cenele-search.html`
- Modify: `src/sources/extensions/cenele.ts` (add `parseSearchPage`, `searchUrl`; add `search`; delete `searchSuggest`, `getSuggestNonce`, `clearSuggestNonceCache`, `extractSuggestNonce`, `callSuggest`, `SuggestResult`, `SUGGEST_NONCE_CARRIER`)
- Modify: `src/sources/extensions/cenele.test.ts`

**Interfaces:**
- Consumes, all already present in `cenele.ts` — do not redefine them:
  - `sanitizeText(raw)` — collapses whitespace, returns `""` for nullish
  - `pickImageSrc(img)` — reads `src` / `data-src` / `data-lazy-src`, absolutized
  - `isNovelHref(href)` — true only for `/cont/<slug>/` index pages, so
    chapter links in a result row can't become cards
  - `absolutizeUrl(href, base)` (imported from `../host`), `BASE_URL`
- Produces:
  - `export function searchUrl(query: string, page: number): string`
  - `export function parseSearchPage(doc: Document, query: string, page: number): SourceSearchResult`

- [ ] **Step 1: Create the search fixture**

Create `src/sources/extensions/__fixtures__/cenele-search.html`, trimmed
from `https://cenele.com/?s=سيد&post_type=wp-manga` captured 2026-08-27:

```html
<!doctype html>
<html lang="ar" dir="rtl">
<head><title>نتائج البحث عن “سيد” – فضاء الروايات</title></head>
<body>
<div class="c-page-content">
  <div class="row c-tabs-item__content">
    <div class="col-4 col-md-2">
      <div class="tab-thumb c-image-hover">
        <a href="https://cenele.com/cont/lord-of-wishes/" title="سيد التمني">
          <img width="193" height="278"
            src="https://cenele.com/wp-content/uploads/2026/06/wishes-193x278.jpg"
            class="img-responsive" alt="رواية سيد التمني">
        </a>
      </div>
    </div>
    <div class="col-8 col-md-10">
      <div class="tab-summary">
        <div class="post-title"><h3 class="h4"><a href="https://cenele.com/cont/lord-of-wishes/">سيد التمني</a></h3></div>
        <div class="post-content">
          <div class="post-content_item mg_alternative">
            <div class="summary-heading"><h5>Alternative</h5></div>
            <div class="summary-content">رواية Lord of Wishes</div>
          </div>
          <div class="post-content_item mg_genres">
            <div class="summary-heading"><h5>Genre(s)</h5></div>
            <div class="summary-content">
              <a href="https://cenele.com/cont-genre/action/">أكشن</a>,
              <a href="https://cenele.com/cont-genre/fantasy/">فانتازيا</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="row c-tabs-item__content">
    <div class="col-4 col-md-2">
      <div class="tab-thumb c-image-hover">
        <a href="https://cenele.com/cont/silent-shadows/" title="سيد الظلال">
          <img src="https://cenele.com/wp-content/uploads/2026/07/shadows-193x278.webp" class="img-responsive" alt="رواية سيد الظلال">
        </a>
      </div>
    </div>
    <div class="col-8 col-md-10">
      <div class="tab-summary">
        <div class="post-title"><h3 class="h4"><a href="https://cenele.com/cont/silent-shadows/">سيد الظلال</a></h3></div>
      </div>
    </div>
  </div>
</div>
<div class="nav-links">
  <div class="nav-previous float-left">
    <a href="https://cenele.com/page/2/?s=%D8%B3%D9%8A%D8%AF&amp;post_type=wp-manga">Older Posts</a>
  </div>
</div>
</body>
</html>
```

- [ ] **Step 2: Write the failing test**

Append to `src/sources/extensions/cenele.test.ts`:

```ts
import { searchUrl, parseSearchPage } from "./cenele";

const searchHtml = readFileSync(
  join(__dirname, "__fixtures__/cenele-search.html"),
  "utf8",
);

describe("searchUrl", () => {
  it("omits the /page/ segment on page 1", () => {
    expect(searchUrl("سيد", 1)).toBe(
      "https://cenele.com/?s=%D8%B3%D9%8A%D8%AF&post_type=wp-manga",
    );
  });

  it("uses the /page/N/ form beyond page 1", () => {
    expect(searchUrl("سيد", 3)).toBe(
      "https://cenele.com/page/3/?s=%D8%B3%D9%8A%D8%AF&post_type=wp-manga",
    );
  });

  it("clamps non-positive pages to 1", () => {
    expect(searchUrl("x", 0)).toBe(
      "https://cenele.com/?s=x&post_type=wp-manga",
    );
  });
});

describe("parseSearchPage", () => {
  const parsed = () =>
    parseSearchPage(
      new DOMParser().parseFromString(searchHtml, "text/html"),
      "سيد",
      1,
    );

  it("returns one card per result row", () => {
    expect(parsed().cards).toHaveLength(2);
  });

  it("reads url, title, cover, original title and genres", () => {
    expect(parsed().cards[0]).toEqual({
      url: "https://cenele.com/cont/lord-of-wishes/",
      title: "سيد التمني",
      coverUrl:
        "https://cenele.com/wp-content/uploads/2026/06/wishes-193x278.jpg",
      subtitle: "رواية Lord of Wishes",
      badges: ["أكشن", "فانتازيا"],
    });
  });

  it("omits optional fields a row doesn't carry", () => {
    const second = parsed().cards[1];
    expect(second.subtitle).toBeUndefined();
    expect(second.badges).toBeUndefined();
  });

  it("reports hasMore from the older-posts link", () => {
    expect(parsed().hasMore).toBe(true);
  });

  it("reports hasMore false when there is no older-posts link", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="row c-tabs-item__content">
         <div class="post-title"><h3 class="h4"><a href="https://cenele.com/cont/a/">A</a></h3></div>
       </div>`,
      "text/html",
    );
    expect(parseSearchPage(doc, "q", 1).hasMore).toBe(false);
  });

  it("echoes query and page", () => {
    const r = parseSearchPage(
      new DOMParser().parseFromString(searchHtml, "text/html"), "سيد", 2);
    expect(r.query).toBe("سيد");
    expect(r.page).toBe(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/sources/extensions/cenele.test.ts`
Expected: FAIL — `searchUrl` / `parseSearchPage` are not exported.

- [ ] **Step 4: Implement the search parsers**

Add to `src/sources/extensions/cenele.ts`, next to the other parsers:

```ts
// ── search-page parsing ────────────────────────────────────────────────────
//
// Cenele runs WordPress search over the `wp-manga` post type. Page 1 is
// `/?s=…`; later pages take the `/page/N/` prefix. The `?s=&paged=N`
// form is NOT used — WordPress serves it inconsistently on this host.
// Results render with the stock Madara card markup.

/** Build the results-page URL for a query + 1-based page. */
export function searchUrl(query: string, page: number): string {
  const params = new URLSearchParams({ s: query, post_type: "wp-manga" });
  const n = Math.max(1, page);
  const prefix = n > 1 ? `${BASE_URL}/page/${n}/` : `${BASE_URL}/`;
  return `${prefix}?${params.toString()}`;
}

/** Parse one results page into cards. */
export function parseSearchPage(
  doc: Document,
  query: string,
  page: number,
): SourceSearchResult {
  const cards: NovelCard[] = [];
  for (const row of Array.from(
    doc.querySelectorAll(".row.c-tabs-item__content"),
  )) {
    const link = row.querySelector(
      ".post-title h3.h4 > a, .post-title a",
    ) as HTMLAnchorElement | null;
    const href = link?.getAttribute("href") || "";
    if (!isNovelHref(href)) continue;
    const img = row.querySelector(".tab-thumb img") as HTMLImageElement | null;
    const alt = sanitizeText(
      row.querySelector(".mg_alternative .summary-content")?.textContent,
    );
    const genres = Array.from(
      row.querySelectorAll(".mg_genres .summary-content a"),
    )
      .map((a) => sanitizeText(a.textContent))
      .filter((s) => s.length > 0);
    cards.push({
      url: absolutizeUrl(href, BASE_URL),
      title: sanitizeText(link?.textContent),
      coverUrl: pickImageSrc(img),
      subtitle: alt || undefined,
      badges: genres.length > 0 ? genres : undefined,
    });
  }

  // The site is RTL, so its "previous" slot holds the *older* (next)
  // page. Its presence is the only reliable more-pages signal — there is
  // no numeric pager on this template.
  const hasMore = !!doc.querySelector(".nav-links .nav-previous a");

  return { cards, hasMore, query, page };
}
```

Add `NovelCard` and `SourceSearchResult` to the `import type { … } from "../types"` list at the top of the file if either is missing.

- [ ] **Step 5: Swap the Source method**

In the object returned by `createCeneleSource`, delete the whole
`async searchSuggest(query) { … }` method and put this in its place:

```ts
    async search(query, page) {
      const trimmed = query.trim();
      const pageNum = Math.max(1, page ?? 1);
      if (trimmed.length === 0) {
        return { cards: [], hasMore: false, query: trimmed, page: pageNum };
      }
      const url = searchUrl(trimmed, pageNum);
      host.log("info", `search(${trimmed}, page=${pageNum}) → ${url}`);
      const resp = await host.fetch(url);
      return parseSearchPage(parseHtmlDocument(resp.text), trimmed, pageNum);
    },
```

- [ ] **Step 6: Delete the dead suggest machinery**

Remove from `src/sources/extensions/cenele.ts`:
- `const SUGGEST_NONCE_CARRIER = …`
- `let suggestNonceCache: string | null = null;` and the
  `getSuggestNonce()` / `clearSuggestNonceCache()` closures inside
  `createCeneleSource`
- `function extractSuggestNonce(…)`
- `interface SuggestResult` and `async function callSuggest(…)`
- the `NovelCard` import only if nothing else in the file uses it (the
  new `parseSearchPage` does, so keep it)

Update the file's header comment: the block explaining "Search is 'live
suggestions only' — there's no /?s= results page" is now false. Replace
those lines with:

```ts
//   2. Search uses the site's WordPress results page at
//      `/?s=<query>&post_type=wp-manga` (page 2+ takes a `/page/N/`
//      prefix). The theme's live-suggest endpoint is deliberately unused
//      — the app has one search interaction: type, Enter, results grid.
```

Also drop the `nhv_manga_suggest` bullet from the AJAX-nonces comment
block, keeping the `nhv_manga_single_chapters_page` /
`nhv_search_manga_chapters` bullet — but correct it to say the nonce now
arrives as `nhvNovelV2.chaptersNonce`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run src/sources/extensions/cenele.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/sources/extensions/cenele.ts src/sources/extensions/cenele.test.ts \
        src/sources/extensions/__fixtures__/cenele-search.html
git commit -m "feat(cenele): search the results page, drop live suggestions"
```

---

### Task 4: KolNovel search repair

`free.kolnovel.com` now 301s to `kolnovel.com`, so `kolnovel`'s
`canHandle` can never match. `kolnovel`'s pagination builds URLs that
return HTTP 500. `kolnovel-pro` searches the autocomplete endpoint
instead of the real results page.

**Files:**
- Modify: `src/sources/extensions/kolnovel.ts:38-61` (`canHandle`, `search`)
- Modify: `src/sources/extensions/kolnovel-pro.ts` (`search`; delete `liveSearch`, `liveSearchCards`, `TsAcResponse`)
- Create: `src/sources/extensions/kolnovel-theme.test.ts`

**Interfaces:**
- Consumes: `parseSearchResults(doc, baseUrl, query, page)` from `./kolnovel-theme` (existing, unchanged).
- Produces: no new exports. Both extensions' `search` return
  `hasMore: false` always.

- [ ] **Step 1: Write the failing test**

Create `src/sources/extensions/kolnovel-theme.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { parseSearchResults } from "./kolnovel-theme";

const BASE = "https://kolnovel.com";

const resultsHtml = `
<div class="listupd">
  <article class="maindet">
    <div class="mdthumb">
      <a href="https://kolnovel.com/series/silent-shadows/" title="سيد الظلال الصامتة">
        <img src="https://kolnovel.com/wp-content/uploads/2026/07/shadows.jpg">
      </a>
    </div>
    <div class="mdinfo">
      <h2><a href="https://kolnovel.com/series/silent-shadows/">سيد الظلال الصامتة</a></h2>
      <div class="contexcerpt"><p>حين يشعر العالم بأنك لا تنتمي إليه…</p></div>
      <div class="mdgenre">
        <a href="#"># اكشن مغامرات</a>
        <a href="#"># ايسيكاي</a>
      </div>
    </div>
  </article>
</div>`;

const parse = (html: string, page = 1) =>
  parseSearchResults(
    new DOMParser().parseFromString(html, "text/html"),
    BASE, "سيد", page,
  );

describe("parseSearchResults", () => {
  it("reads url, title, cover, excerpt and hash-stripped genres", () => {
    expect(parse(resultsHtml).cards[0]).toEqual({
      url: "https://kolnovel.com/series/silent-shadows/",
      title: "سيد الظلال الصامتة",
      coverUrl: "https://kolnovel.com/wp-content/uploads/2026/07/shadows.jpg",
      subtitle: "حين يشعر العالم بأنك لا تنتمي إليه…",
      badges: ["اكشن مغامرات", "ايسيكاي"],
    });
  });

  it("reports hasMore false — KolNovel renders one page of results", () => {
    // The theme emits an empty `.pagination` block and no paged links.
    // Any true here would send the UI to a URL that returns HTTP 500.
    expect(parse(resultsHtml + '<div class="pagination"> </div>').hasMore)
      .toBe(false);
  });

  it("returns no cards for an empty result set", () => {
    expect(parse('<div class="listupd"></div>').cards).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes already**

Run: `pnpm vitest run src/sources/extensions/kolnovel-theme.test.ts`
Expected: PASS (3 tests). `parseSearchResults` is already correct — this
test pins the behaviour before the callers change around it. If it fails,
fix `parseSearchResults` before continuing.

- [ ] **Step 3: Fix `kolnovel.ts`**

Replace `canHandle` and `search` in `src/sources/extensions/kolnovel.ts`:

```ts
    canHandle(url) {
      try {
        const h = new URL(url).hostname.toLowerCase();
        // free.kolnovel.com 301s to kolnovel.com; keep matching it so
        // URLs already saved in a user's library still resolve.
        return (
          h === "kolnovel.com" ||
          h === "www.kolnovel.com" ||
          h === "free.kolnovel.com"
        );
      } catch {
        return false;
      }
    },

    async search(query) {
      // No pagination: the theme renders every match on one page, and
      // both `?s=…&paged=N` and `/page/N/?s=…` return HTTP 500 on this
      // host. parseSearchResults reports hasMore false accordingly.
      const url = `${BASE_URL}/?${new URLSearchParams({ s: query })}`;
      host.log("info", `search(${query}) → ${url}`);
      const resp = await host.fetch(url);
      return parseSearchResults(parseHtmlDocument(resp.text), BASE_URL, query, 1);
    },
```

Then change the module constant so the extension stops pointing at the
dead mirror:

```ts
const BASE_URL = "https://kolnovel.com";
```

- [ ] **Step 4: Fix `kolnovel-pro.ts`**

In `src/sources/extensions/kolnovel-pro.ts`, replace the `search` method:

```ts
    async search(query) {
      const url = `${BASE_URL}/?${new URLSearchParams({ s: query })}`;
      host.log("info", `search(${query}) → ${url}`);
      const resp = await host.fetch(url);
      return parseSearchResults(parseHtmlDocument(resp.text), BASE_URL, query, 1);
    },
```

Add `parseSearchResults` to the existing import from `./kolnovel-theme`.

Delete `async function liveSearch(…)`, `function liveSearchCards(…)`, and
the `TsAcResponse` interface (plus any `TsAc*` helper types only they
used). Remove the "Search uses the theme's live autocomplete API
(ts_ac_do_search)" line from the file header and replace it with:

```ts
// Search uses the site's WordPress results page (`/?s=`). The theme's
// ts_ac_do_search autocomplete is unused — it returns thinner cards and
// the app has one search interaction.
```

If `NovelCard` is now unused in this file, drop it from the type import.

- [ ] **Step 5: Update the registry's base URL**

In `src/sources/registry.ts`, the `kolnovel` entry's
`baseUrl: "https://free.kolnovel.com"` is now wrong. Change it to:

```ts
      baseUrl: "https://kolnovel.com",
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/sources/extensions/kolnovel.ts \
        src/sources/extensions/kolnovel-pro.ts \
        src/sources/extensions/kolnovel-theme.test.ts \
        src/sources/registry.ts
git commit -m "fix(kolnovel): search the results page, drop the dead free mirror"
```

---

### Task 5: One search interaction

Remove `searchSuggest` from the interface and strip the dropdown
machinery out of the store UI.

**Files:**
- Modify: `src/sources/types.ts:244-253` (`search` required, `searchSuggest` deleted)
- Modify: `src/components/SourceHomeView.tsx` (delete `SuggestState`, the debounce effect, `SUGGEST_*`, `canSuggest`, `SearchInputWithSuggest`'s suggest half, `SuggestDropdown`)
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts` (drop `store.suggestError`, `store.noSuggestMatches`)
- Modify: `docs/store-feature/sources.md` (the optional-capabilities section)

**Interfaces:**
- Consumes: `Source.search` implementations from Tasks 3 and 4.
- Produces: `Source.search(query, page?): Promise<SourceSearchResult>` is
  required; `Source.searchSuggest` no longer exists. `SourceHomeView`
  renders a plain `SearchInput` with no dropdown props.

- [ ] **Step 1: Make `search` required and delete `searchSuggest`**

In `src/sources/types.ts`, replace the `search?` and `searchSuggest?`
declarations with a single required method:

```ts
  /** Search for novels matching `query`. Page is 1-based. Sources whose
   *  site renders all matches on one page ignore `page` and return
   *  `hasMore: false`.
   *
   *  Required. The store has exactly one search interaction — the user
   *  types and presses Enter, and this fills the results grid. There is
   *  no as-you-type suggestion path. */
  search(query: string, page?: number): Promise<SourceSearchResult>;
```

- [ ] **Step 2: Run the typechecker to find every break**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL — errors in `SourceHomeView.tsx` referencing
`source.searchSuggest`. This list is the work for the next step.

- [ ] **Step 3: Strip the suggest machinery from `SourceHomeView.tsx`**

Delete, in order:
- the `SuggestState` interface (~lines 50-61)
- `SUGGEST_DEBOUNCE_MS` and `SUGGEST_MIN_CHARS` (~lines 63-64)
- the `suggestState` and `suggestOpen` `useState` calls
- `const canSuggest = typeof source?.searchSuggest === "function";`
- the entire debounced-suggest `useEffect` (~lines 155-186)
- the `SuggestDropdown` component and `SuggestDropdownProps` (~lines 539-653)

Replace `onSubmitSearch` with the unconditional form:

```ts
  const onSubmitSearch = useCallback(() => {
    void runSearch(searchInput);
  }, [runSearch, searchInput]);
```

`canSearch` becomes redundant now that `search` is required — delete the
`const canSearch = …` line and render the input unconditionally.

In `HomeHeader`, drop `canSearch`, `canSuggest`, `suggestOpen`,
`onCloseSuggest`, `suggestState` and `onOpenSuggestion` from
`HomeHeaderProps` and from the call site in `SourceHomeView`, and replace
the conditional block:

```tsx
      {(canSearch || canSuggest) && (
        <SearchInputWithSuggest … />
      )}
```

with:

```tsx
      <SearchInput
        theme={theme}
        isMobile={isMobile}
        inputRef={inputRef}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        onSubmitSearch={onSubmitSearch}
      />
```

Rename `SearchInputWithSuggest` → `SearchInput` and
`SearchInputWithSuggestProps` → `SearchInputProps`, keeping only
`theme`, `isMobile`, `inputRef`, `searchInput`, `setSearchInput` and
`onSubmitSearch`. Inside it, delete the click-outside `useEffect`, the
`containerRef` if it has no other use, and the `<SuggestDropdown …/>`
render. Keep the input, its Enter handler, and the clear button.

Update the file's header comment — the "search mode" paragraph is still
accurate, but remove any mention of the dropdown.

- [ ] **Step 4: Remove the dead i18n keys**

Delete `"store.suggestError"` and `"store.noSuggestMatches"` from both
`src/i18n/en.ts` and `src/i18n/ar.ts`.

- [ ] **Step 5: Typecheck and test**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors, all tests PASS.

- [ ] **Step 6: Update the subsystem docs**

In `docs/store-feature/sources.md`, delete the `### searchSuggest(query)
→ NovelCard[]` subsection entirely. Move `search` out of "Optional
capabilities" into "The required interface", and update that code block:

```ts
interface Source {
  readonly meta: SourceMetadata;
  canHandle(url: string): boolean;
  getHomeSections(): Promise<SourceSection[]>;
  search(query: string, page?: number): Promise<SourceSearchResult>;
  getNovel(url: string): Promise<SourceNovel>;
  getChapterContent(chapter: SourceChapter): Promise<SourceLine[]>;
}
```

Under `### search(query, page)`, replace the "KolNovel implements this.
Cenele does not" line with:

```markdown
Every source implements this. Sources whose site renders all matches on
one page ignore `page` and return `hasMore: false` — KolNovel does.
Cenele paginates and reports `hasMore` from its older-posts link.
```

- [ ] **Step 7: Commit**

```bash
git add src/sources/types.ts src/components/SourceHomeView.tsx \
        src/i18n/en.ts src/i18n/ar.ts docs/store-feature/sources.md
git commit -m "refactor(store): one search interaction, no live suggestions"
```

---

### Task 6: Load more

`SourceSearchResult.hasMore` has always been returned and never read —
`search` is only ever called with page 1. Wire it up.

**Files:**
- Create: `src/components/searchPaging.ts`
- Create: `src/components/searchPaging.test.ts`
- Modify: `src/components/SourceHomeView.tsx` (`SearchState`, `runSearch`, `SearchResults`)
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts` (add `store.loadMore`, `store.loadingMore`)

**Interfaces:**
- Consumes: `SourceSearchResult` from `../sources/types`.
- Produces:
  - `export interface SearchPage { cards: NovelCard[]; hasMore: boolean; page: number }`
  - `export function appendPage(prev: SearchPage | null, next: SourceSearchResult): SearchPage`

- [ ] **Step 1: Write the failing test**

Create `src/components/searchPaging.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { appendPage } from "./searchPaging";
import type { SourceSearchResult } from "../sources/types";

const result = (
  urls: string[], hasMore: boolean, page: number,
): SourceSearchResult => ({
  cards: urls.map((u) => ({ url: u, title: u })),
  hasMore, query: "q", page,
});

describe("appendPage", () => {
  it("seeds from nothing", () => {
    const out = appendPage(null, result(["a", "b"], true, 1));
    expect(out).toEqual({
      cards: [{ url: "a", title: "a" }, { url: "b", title: "b" }],
      hasMore: true, page: 1,
    });
  });

  it("appends the next page and advances the cursor", () => {
    const first = appendPage(null, result(["a"], true, 1));
    const out = appendPage(first, result(["b"], false, 2));
    expect(out.cards.map((c) => c.url)).toEqual(["a", "b"]);
    expect(out.page).toBe(2);
    expect(out.hasMore).toBe(false);
  });

  it("drops duplicates so a repeated row can't produce two React keys", () => {
    const first = appendPage(null, result(["a", "b"], true, 1));
    const out = appendPage(first, result(["b", "c"], true, 2));
    expect(out.cards.map((c) => c.url)).toEqual(["a", "b", "c"]);
  });

  it("stops when a page comes back empty even if hasMore was true", () => {
    const first = appendPage(null, result(["a"], true, 1));
    expect(appendPage(first, result([], true, 2)).hasMore).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/searchPaging.test.ts`
Expected: FAIL — cannot resolve `./searchPaging`.

- [ ] **Step 3: Implement it**

Create `src/components/searchPaging.ts`:

```ts
// Accumulator for paginated source search. Kept out of SourceHomeView so
// the merge rules (dedupe, end-of-results) are unit-testable without a
// React renderer.

import type { NovelCard, SourceSearchResult } from "../sources/types";

export interface SearchPage {
  cards: NovelCard[];
  hasMore: boolean;
  /** Highest page number merged so far; the next fetch asks for page+1. */
  page: number;
}

/** Merge one search response onto the accumulated results.
 *
 *  Dedupes by `url` — sources paginate over live data, so a novel that
 *  moves between pages while the user is reading would otherwise appear
 *  twice and collide on its React key.
 *
 *  An empty page ends pagination regardless of the source's `hasMore`:
 *  a source that always reports true would otherwise loop forever. */
export function appendPage(
  prev: SearchPage | null,
  next: SourceSearchResult,
): SearchPage {
  const cards = prev ? [...prev.cards] : [];
  const seen = new Set(cards.map((c) => c.url));
  for (const card of next.cards) {
    if (seen.has(card.url)) continue;
    seen.add(card.url);
    cards.push(card);
  }
  return {
    cards,
    hasMore: next.hasMore && next.cards.length > 0,
    page: next.page,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/searchPaging.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the i18n strings**

In `src/i18n/en.ts`, beside the other `store.*` keys:

```ts
  "store.loadMore": "Load more",
  "store.loadingMore": "Loading more…",
```

In `src/i18n/ar.ts`:

```ts
  "store.loadMore": "تحميل المزيد",
  "store.loadingMore": "جارٍ تحميل المزيد…",
```

- [ ] **Step 6: Hold accumulated pages in `SearchState`**

In `src/components/SourceHomeView.tsx`, change `SearchState` to carry a
`SearchPage` plus a separate flag for the append-in-flight state:

```ts
interface SearchState {
  loading: boolean;
  /** True while a Load-more fetch is in flight — keeps the existing
   *  results on screen instead of swapping them for skeletons. */
  loadingMore: boolean;
  error: string | null;
  result: SearchPage | null;
  query: string;
}
```

Update the initial state and every `setSearchState` reset to include
`loadingMore: false`. Import `appendPage` and `type SearchPage` from
`./searchPaging`, and drop the now-unused `SourceSearchResult` import if
nothing else in the file uses it.

Rewrite `runSearch` so it handles both the first page and appends:

```ts
  const runSearch = useCallback(
    async (query: string, page = 1) => {
      if (!source) return;
      const trimmed = query.trim();
      if (trimmed.length === 0) {
        setSearchState({
          loading: false, loadingMore: false, error: null,
          result: null, query: "",
        });
        return;
      }
      const appending = page > 1;
      setSearchState((s) => ({
        ...s,
        loading: !appending,
        loadingMore: appending,
        error: null,
        result: appending ? s.result : null,
        query: trimmed,
      }));
      try {
        const res = await source.search(trimmed, page);
        setSearchState((s) =>
          // A newer query started while this was in flight — discard.
          s.query !== trimmed
            ? s
            : {
                loading: false,
                loadingMore: false,
                error: null,
                result: appendPage(appending ? s.result : null, res),
                query: trimmed,
              },
        );
      } catch (e) {
        setSearchState((s) =>
          s.query !== trimmed
            ? s
            : {
                ...s,
                loading: false,
                loadingMore: false,
                error: e instanceof Error ? e.message : String(e),
              },
        );
      }
    },
    [source],
  );
```

- [ ] **Step 7: Render the control**

Pass a handler down to `SearchResults` from `SourceHomeView`:

```tsx
          <SearchResults
            theme={theme}
            state={searchState}
            onClear={() => {
              setSearchInput("");
              setSearchState({
                loading: false, loadingMore: false, error: null,
                result: null, query: "",
              });
            }}
            onLoadMore={() =>
              void runSearch(searchState.query, (searchState.result?.page ?? 1) + 1)
            }
            onOpenNovel={onOpenNovel}
          />
```

Add `onLoadMore: () => void;` to `SearchResultsProps`, and render the
button after `<ResultsGrid …/>` inside `SearchResults`:

```tsx
      {state.result?.hasMore && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
          <Button
            theme={theme}
            variant="secondary"
            onClick={onLoadMore}
            disabled={state.loadingMore}
          >
            {state.loadingMore ? tr("store.loadingMore") : tr("store.loadMore")}
          </Button>
        </div>
      )}
```

The existing `state.loading ? skeletons : state.error ? … : …` ladder is
unchanged — `loadingMore` deliberately does not enter it, so the grid
stays put while the next page loads.

- [ ] **Step 8: Verify `Button` supports the props used**

Run: `grep -n "variant\|disabled" src/components/Button.tsx | head -20`
If `Button` has no `disabled` prop or no `secondary` variant, use the
variant it does expose and gate the click with
`onClick={() => { if (!state.loadingMore) onLoadMore(); }}`.

- [ ] **Step 9: Typecheck and test**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors, all tests PASS.

- [ ] **Step 10: Manual verification**

Run: `pnpm tauri dev`

Check, in the running app:
1. Store → فضاء الروايات → open any novel. The detail page loads with
   title, cover, author, genres and status. (Task 2 — this is the bug
   you reported.)
2. Expand a volume. Chapters list. Open one. Text is clean, with no
   "stolen chapter" boilerplate.
3. Search `سيد` and press Enter. A results grid appears with covers.
   **Load more** is present; clicking it appends without clearing the
   grid.
4. Store → ملوك الروايات → search `سيد` + Enter. Results appear, and
   **no** Load more button (KolNovel returns everything at once).
5. Search `رواية` on KolNovel. The site returns HTTP 500; confirm the
   red inline error renders rather than an empty grid.
6. Type into either search box without pressing Enter. **No dropdown
   appears** — that is the whole point of this change.

- [ ] **Step 11: Commit**

```bash
git add src/components/searchPaging.ts src/components/searchPaging.test.ts \
        src/components/SourceHomeView.tsx src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(store): load more search results"
```

---

## Done when

- `pnpm test` passes and `pnpm exec tsc --noEmit` is clean.
- A Cenele novel page opens with full metadata — the reported bug is gone.
- Searching any source is: type, Enter, grid. No dropdown exists anywhere.
- `grep -rn "searchSuggest" src/` returns nothing.
- Cenele search paginates; KolNovel search doesn't, and never requests a
  URL that 500s.

## Deliberately not in this plan

- **Merging `kolnovel` + `kolnovel-pro`.** The spec merges them into one
  extension, but that lands with the repo port (Plan 2) where the id
  alias table also lives. Plan 1 only repairs the live bugs in both.
- **The `section.nhv-gems-lb` Cenele home section.** Marked optional in
  the spec; `getHomeSections` already returns two working sections and
  adding a third is not worth a release gate. Pick it up during the port.

## Follow-on plans

- **Plan 2** — `Riwaq-Extensions` repo: API package, build, CI, README,
  three extensions ported (KolNovel merged).
- **Plan 3** — app extension runtime + Extensions UI, replacing the
  bundled registry.

Both are written from the same spec once this plan lands.
