// Cenele (فضاء الروايات) source — Arabic web-novel site at cenele.com.
//
// Cenele runs the Madara WordPress theme with a custom child theme
// ("novelhub"). That has two consequences that shape the extension:
//
//   1. The chapter list is NOT in the novel page's initial HTML.
//      The page ships an empty `<div id="nhv-manga-chapters">` shell
//      and the theme's JS calls `wp-admin/admin-ajax.php` on accordion
//      open to fetch each volume's chapters. We replicate those AJAX
//      calls server-side via host.fetch + form-encoded bodies — no
//      headless webview needed.
//
//   2. Search uses the site's WordPress results page at
//      `/?s=<query>&post_type=wp-manga` (page 2+ takes a `/page/N/`
//      prefix). The theme's live-suggest endpoint is deliberately unused
//      — the app has one search interaction: type, Enter, results grid.
//
// AJAX nonces. WordPress nonces are user-session-scoped, generated server-
// side and embedded in inline scripts on every page render.
// `nhv_manga_single_chapters_page` and `nhv_search_manga_chapters` share one
// nonce, exposed as `nhvNovelV2.chaptersNonce` alongside the post id
// (`nhvNovelV2.postId`) on the novel page.
//
// We scrape the nonce lazily and cache it for the session. Nonces
// eventually roll over (24h-ish on a default WP install); we don't retry
// on a stale one today. (The site exposes an `nhv_refresh_front_nonces`
// action we don't currently use for that.)
//
// Chapter body anti-piracy. Cenele intersperses real paragraphs with
// "stolen-chapters" decoys hidden via inline CSS (`position:absolute`,
// `opacity:0`, etc.) plus `aria-hidden="true"` + `data-nosnippet="true"`.
// `extractChapterLines` strips those before walking text — see
// `isDecoyElement` for the detection heuristics.

import { absolutizeUrl, parseHtmlDocument } from "../host";
import { makeTr, type Locale } from "../../i18n";
import type {
  NovelCard,
  Source,
  SourceChapter,
  SourceHost,
  SourceLine,
  SourceNovelMeta,
  SourceSearchResult,
  SourceSection,
  SourceVolume,
} from "../types";

/** Best-effort current UI locale for the rare case a volume has no
 *  scraped label and we fall back to a fixed "Volume N" name. This
 *  module runs outside the component tree (plain DOM parsing, no React
 *  context available), so it reads `document.documentElement.lang`
 *  instead of `useI18n()` — App.tsx keeps that attribute in sync with
 *  the user's UI-language preference. Mirrors kolnovel-theme.ts's
 *  identically-named helper. */
function currentUiLocale(): Locale {
  if (typeof document !== "undefined" && document.documentElement.lang === "ar") {
    return "ar";
  }
  return "en";
}

const SOURCE_ID = "cenele";
const BASE_URL = "https://cenele.com";
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;
const CHAPTERS_PER_PAGE = 50;
/** Hard cap on the volume-chapter pagination loop. A real novel maxes
 *  out at a few thousand chapters per volume; this guard keeps a broken
 *  `has_more` response from hanging the import. */
const MAX_VOLUME_PAGES = 100;

interface CachedNovel {
  /** Numeric WordPress post id of the novel — sent in every AJAX call. */
  mangaId: string;
  /** Per-session nonce for `nhv_manga_single_chapters_page` and
   *  `nhv_search_manga_chapters` (same nonce). */
  chaptersNonce: string;
  /** Map from our volume.id (1-based, monotonic across the novel)
   *  → AJAX parameters + the id offset to assign to that volume's
   *  chapters. Populated by getNovel from the meta_only response so
   *  getVolumeChapters can resolve a lazy expand without re-walking
   *  the novel page. */
  volumeIndex: Map<
    number,
    { sourceNum: number; startId: number; count: number }
  >;
  /** Map from chapter URL → chapter id assigned during getNovel() or
   *  getVolumeChapters(). Used by searchChapters to map results back
   *  to the numeric id the importer + reader use. Populated lazily
   *  as volumes are expanded. */
  chapterIdByUrl: Map<string, number>;
}

export function createCeneleSource(host: SourceHost): Source {
  // Per-instance caches. These survive across getNovel/searchChapters
  // calls within one session but reset when the source is reconstructed.
  const novelCache = new Map<string, CachedNovel>();

  return {
    meta: {
      id: SOURCE_ID,
      name: "فضاء الروايات",
      baseUrl: BASE_URL,
      language: "ar",
      version: "0.1.0",
    },
    // Cenele loads chapter lists per volume via AJAX. Most novels have
    // thousands of chapters across a dozen volumes; pre-loading them
    // all in getNovel was both slow on first open AND mismatched the
    // site's own behavior (the user clicks a volume → AJAX). Lazy
    // mode hands one volume's chapters back at a time.
    hasLazyVolumes: true,

    canHandle(url) {
      try {
        const u = new URL(url);
        return /(^|\.)cenele\.com$/i.test(u.hostname);
      } catch {
        return false;
      }
    },

    async getHomeSections() {
      host.log("info", "getHomeSections");
      const resp = await host.fetch(BASE_URL + "/");
      const doc = parseHtmlDocument(resp.text);
      return parseHomeSections(doc);
    },

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

    async getNovel(url) {
      host.log("info", `getNovel(${url})`);
      const resp = await host.fetch(url);
      const doc = parseHtmlDocument(resp.text);
      const parsed = parseNovelPage(doc, url);

      // Hit `meta_only=1` once to get the canonical volume list with
      // per-volume chapter counts. The shells in the page HTML carry
      // labels but not counts, and counts are what lets us pre-assign
      // stable chapter id ranges per volume (so flags persist across
      // sessions without re-loading every chapter list up front).
      const metaVolumes = await fetchVolumeMeta(
        host,
        parsed.mangaId,
        parsed.chaptersNonce,
      );

      // Sort: real volumes ascending by num; the "no volumes"
      // pseudo-volume (num=0) goes last regardless. Then assign our
      // monotonic 1-based ids + compute id offsets for the chapters
      // each volume contains.
      const sorted = [...metaVolumes].sort((a, b) => {
        if (a.num === 0 && b.num !== 0) return 1;
        if (b.num === 0 && a.num !== 0) return -1;
        return a.num - b.num;
      });

      const volumeIndex = new Map<
        number,
        { sourceNum: number; startId: number; count: number }
      >();
      let nextId = 1;
      const volumes: SourceVolume[] = sorted.map((shell, i) => {
        const ourId = i + 1;
        const count = shell.count ?? 0;
        const startId = nextId;
        volumeIndex.set(ourId, {
          sourceNum: shell.num,
          startId,
          count,
        });
        nextId += count;
        return {
          id: ourId,
          title:
            shell.label ||
            makeTr(currentUiLocale())("novel.volumeFallback", {
              n: shell.num,
            }),
          chapters: [],
          chapterCount: count,
          key: String(shell.num),
        };
      });

      // Reset the per-novel cache. Existing chapterIdByUrl entries
      // from a stale session would mis-resolve search hits after
      // the volume id offsets shifted.
      novelCache.set(url, {
        mangaId: parsed.mangaId,
        chaptersNonce: parsed.chaptersNonce,
        volumeIndex,
        chapterIdByUrl: new Map(),
      });

      return {
        title: parsed.title,
        author: parsed.author,
        originalTitle: parsed.originalTitle,
        language: "ar",
        direction: "rtl",
        coverUrl: parsed.coverUrl,
        description: parsed.description,
        tags: parsed.tags,
        status: parsed.status,
        meta: parsed.meta,
        volumes,
      };
    },

    async getVolumeChapters(novelUrl, volume) {
      let cached = novelCache.get(novelUrl);
      if (!cached) {
        // Cold start: the detail view loaded the snapshot from disk
        // and is calling us without a prior getNovel. We need to
        // re-derive manga_id + nonce from the novel page, and we
        // can't recover the volume's startId without the meta_only
        // call. Do both, then proceed.
        host.log("debug", "getVolumeChapters: cache miss, refetching");
        const resp = await host.fetch(novelUrl);
        const ajax = extractNovelConfig(resp.text);
        if (!ajax) {
          throw new Error(
            "Cenele: couldn't find nhvNovelV2 config — site layout may have changed.",
          );
        }
        const meta = await fetchVolumeMeta(host, ajax.postId, ajax.chaptersNonce);
        const sorted = [...meta].sort((a, b) => {
          if (a.num === 0 && b.num !== 0) return 1;
          if (b.num === 0 && a.num !== 0) return -1;
          return a.num - b.num;
        });
        const volumeIndex = new Map<
          number,
          { sourceNum: number; startId: number; count: number }
        >();
        let nextId = 1;
        sorted.forEach((shell, i) => {
          const c = shell.count ?? 0;
          volumeIndex.set(i + 1, {
            sourceNum: shell.num,
            startId: nextId,
            count: c,
          });
          nextId += c;
        });
        cached = {
          mangaId: ajax.postId,
          chaptersNonce: ajax.chaptersNonce,
          volumeIndex,
          chapterIdByUrl: new Map(),
        };
        novelCache.set(novelUrl, cached);
      }

      // Resolve volume → AJAX param + startId. Prefer the cached
      // entry by our id; fall back to volume.key (the source num)
      // when the caller is rendering a volume whose id we didn't
      // assign (a snapshot may have shifted ids across sessions).
      let entry = cached.volumeIndex.get(volume.id);
      if (!entry) {
        const num = parseInt(volume.key || "0", 10);
        for (const e of cached.volumeIndex.values()) {
          if (e.sourceNum === num) {
            entry = e;
            break;
          }
        }
      }
      if (!entry) {
        throw new Error(
          `Cenele: couldn't resolve volume ${volume.id} — meta lookup mismatch.`,
        );
      }

      const chapters = await fetchVolumeChapters(
        host,
        cached.mangaId,
        cached.chaptersNonce,
        entry.sourceNum,
      );
      // Assign global ids based on the volume's offset. The order
      // matches the source's chapter sequence so re-fetching keeps
      // ids stable (modulo upstream insertions, which are rare).
      chapters.forEach((c, i) => {
        c.id = entry!.startId + i;
        cached!.chapterIdByUrl.set(c.url, c.id);
      });
      return chapters;
    },

    async searchChapters(novelUrl, query) {
      const trimmed = query.trim();
      if (trimmed.length === 0) return [];
      const cached = novelCache.get(novelUrl);
      if (!cached) {
        // Caller asked for chapter search before getNovel resolved.
        // Shouldn't happen via the UI (the chapter-search input is
        // rendered alongside the volumes accordion, which itself comes
        // from getNovel), but guard with a clear message.
        throw new Error(
          "Cenele: searchChapters called before getNovel — internal state is missing.",
        );
      }
      const items = await callChapterSearch(
        host,
        cached.mangaId,
        cached.chaptersNonce,
        trimmed,
      );
      // Re-key against the volume map so search hits that already exist
      // in the volume listing share the same numeric id (lets the
      // detail-view click hand off to the chapter reader). Chapters
      // present in the search but missing from the cached map are
      // assigned synthetic ids beyond the highest existing one — they
      // still render but won't deep-link until the user fetches the
      // owning volume.
      let nextSynthetic = 0;
      for (const id of cached.chapterIdByUrl.values()) {
        if (id > nextSynthetic) nextSynthetic = id;
      }
      const out: SourceChapter[] = [];
      for (const item of items) {
        const existing = cached.chapterIdByUrl.get(item.url);
        const id = existing ?? ++nextSynthetic;
        out.push({
          id,
          title: item.title,
          url: item.url,
          lines: [],
        });
      }
      return out;
    },

    async getChapterContent(chapter) {
      host.log("debug", `getChapterContent(#${chapter.id} ${chapter.title})`);
      const resp = await host.fetch(chapter.url);
      const doc = parseHtmlDocument(resp.text);
      return extractChapterLines(doc);
    },
  };
}

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

// ── chapter-list AJAX ──────────────────────────────────────────────────────

interface VolumeShell {
  num: number;
  label: string;
  /** Chapter count when known (always present on responses from the
   *  meta_only AJAX; absent for shells parsed straight out of the
   *  page HTML, which doesn't include counts). */
  count?: number;
}

interface VolumeMetaResponse {
  num: number;
  label?: string;
  count?: number;
}

interface ChaptersPageResponse {
  success: boolean;
  html: string;
  has_more?: boolean;
  page?: number;
  volumes?: VolumeMetaResponse[];
}

async function fetchVolumeMeta(
  host: SourceHost,
  mangaId: string,
  nonce: string,
): Promise<VolumeShell[]> {
  const body = new URLSearchParams({
    action: "nhv_manga_single_chapters_page",
    nonce,
    manga_id: mangaId,
    meta_only: "1",
  }).toString();
  const resp = await host.fetch(AJAX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const parsed = safeJson<ChaptersPageResponse>(resp.text);
  if (!parsed || !parsed.success || !parsed.volumes) {
    throw new Error(
      "Cenele: meta_only chapters request failed — server returned no volumes.",
    );
  }
  return parsed.volumes.map((v) => ({
    num: v.num,
    label: v.label ?? "",
    count: v.count ?? 0,
  }));
}

async function fetchVolumeChapters(
  host: SourceHost,
  mangaId: string,
  nonce: string,
  volume: number,
): Promise<SourceChapter[]> {
  const all: SourceChapter[] = [];
  for (let page = 1; page <= MAX_VOLUME_PAGES; page++) {
    const body = new URLSearchParams({
      action: "nhv_manga_single_chapters_page",
      nonce,
      manga_id: mangaId,
      volume: String(volume),
      page: String(page),
      per_page: String(CHAPTERS_PER_PAGE),
    }).toString();
    const resp = await host.fetch(AJAX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const parsed = safeJson<ChaptersPageResponse>(resp.text);
    if (!parsed || !parsed.success) {
      throw new Error(
        `Cenele: failed to fetch chapters page ${page} for volume ${volume}.`,
      );
    }
    const chunk = parseChapterListHtml(parsed.html);
    all.push(...chunk);
    if (!parsed.has_more) break;
  }
  return all;
}

/** Parse a chapter list HTML fragment returned by the chapters AJAX.
 *  Server returns a sequence of `<li data-chapter-id="N"
 *  class="wp-manga-chapter"><a href="URL">الفصل N <span
 *  class="nhv-chapter-name">TITLE</span></a> …</li>`. */
function parseChapterListHtml(html: string): SourceChapter[] {
  // Wrap in a `<ul>` before parsing so the document body has a
  // well-formed parent for the `<li>`s. Browsers' DOMParser fixes some
  // structures silently, but explicit is cheaper than hunting parser
  // edge cases.
  const doc = parseHtmlDocument(`<ul>${html}</ul>`);
  const items = doc.querySelectorAll("li.wp-manga-chapter, li[data-chapter-id]");
  const out: SourceChapter[] = [];
  for (const li of Array.from(items)) {
    const a = li.querySelector("a[href]") as HTMLAnchorElement | null;
    if (!a) continue;
    const href = a.getAttribute("href") || "";
    if (!href) continue;
    const url = absolutizeUrl(href, BASE_URL);

    // Title shape: "الفصل N    <span class="nhv-chapter-name">SUBTITLE</span>".
    // Strip the `<span class="nhv-chapter-name">` wrapper, collapse
    // whitespace, then join the chapter number and subtitle with a dash
    // so the imported EPUB chapter title reads like "الفصل 5 - السلاسل
    // المكسورة" rather than the cramped "الفصل 5السلاسل المكسورة" the
    // raw text content would produce.
    const subtitleEl = a.querySelector(".nhv-chapter-name");
    const subtitle = subtitleEl ? sanitizeText(subtitleEl.textContent) : "";
    // Clone the <a> and remove the subtitle node so we can read the
    // chapter-number prefix in isolation.
    const aClone = a.cloneNode(true) as Element;
    aClone.querySelectorAll(".nhv-chapter-name").forEach((n) => n.remove());
    const prefix = sanitizeText(aClone.textContent);
    const composed = subtitle ? `${prefix} - ${subtitle}` : prefix;
    const title = sanitizeChapterTitle(composed, out.length + 1);
    out.push({
      // Placeholder; fetchAllVolumes assigns the final monotonic id once
      // the full volume listing is in.
      id: 0,
      title,
      url,
      lines: [],
    });
  }
  return out;
}

// ── chapter search ─────────────────────────────────────────────────────────

interface ChapterSearchItem {
  id: number;
  title: string;
  title_html: string;
  url: string;
  time: string;
}

interface ChapterSearchResponse {
  success: boolean;
  items?: ChapterSearchItem[];
}

/** Re-shape the search response into chapter stubs. The site returns
 *  both a structured `items` array and a rendered `html` blob; we use
 *  `items` for predictable parsing.
 *
 *  Decoding: the title field arrives as plain text already (theme
 *  splits the prefix from the subtitle for `title_html` but keeps
 *  `title` short). We compose the same `prefix - subtitle` shape used
 *  by `parseChapterListHtml` for consistency. */
async function callChapterSearch(
  host: SourceHost,
  mangaId: string,
  nonce: string,
  query: string,
): Promise<Array<{ title: string; url: string }>> {
  const body = new URLSearchParams({
    action: "nhv_search_manga_chapters",
    nonce,
    manga_id: mangaId,
    query,
    limit: "80",
  }).toString();
  const resp = await host.fetch(AJAX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const parsed = safeJson<ChapterSearchResponse>(resp.text);
  if (!parsed || !parsed.success || !parsed.items) {
    throw new Error("Cenele: chapter search returned an unexpected response.");
  }
  return parsed.items.map((item) => {
    // Reuse the same prefix-+-subtitle composition as the volume
    // listing. The site delivers `title_html` with a `<span
    // class="nhv-chapter-name">` for the subtitle — strip the span
    // wrappers, collapse whitespace, and reuse our common renderer.
    const composed = composeChapterTitle(item.title_html || item.title);
    return {
      title: composed,
      url: absolutizeUrl(item.url, BASE_URL),
    };
  });
}

function composeChapterTitle(rawHtml: string): string {
  // Search items have HTML with a nested span; parse it through DOMParser
  // so we don't have to roll a regex strip that might miss attribute
  // variations.
  const doc = parseHtmlDocument(`<div>${rawHtml}</div>`);
  const sub = doc.querySelector(".nhv-chapter-name");
  const subtitle = sub ? sanitizeText(sub.textContent) : "";
  doc.querySelectorAll(".nhv-chapter-name").forEach((n) => n.remove());
  const prefix = sanitizeText(doc.body.textContent);
  const composed = subtitle ? `${prefix} - ${subtitle}` : prefix;
  return sanitizeChapterTitle(composed, 0);
}

// ── novel-page parsing ─────────────────────────────────────────────────────

interface ParsedNovelPage {
  title: string;
  author: string;
  originalTitle?: string;
  status?: string;
  coverUrl?: string;
  description?: string;
  tags: string[];
  meta: SourceNovelMeta[];
  mangaId: string;
  chaptersNonce: string;
  /** Pre-rendered volume shells from the page HTML. May be empty when
   *  the theme decides to defer rendering until the chapters tab opens. */
  volumeShells: VolumeShell[];
}

export function parseNovelPage(doc: Document, pageUrl: string): ParsedNovelPage {
  const html = doc.documentElement.outerHTML;
  const config = extractNovelConfig(html);
  if (!config) {
    throw new Error(
      `Cenele: couldn't find nhvNovelV2 config on ${pageUrl}. The site layout may have changed, or this isn't a novel page.`,
    );
  }

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

  return {
    title,
    author,
    originalTitle,
    status,
    coverUrl,
    description,
    tags,
    meta,
    mangaId: config.postId,
    chaptersNonce: config.chaptersNonce,
    volumeShells,
  };
}

function extractDescription(doc: Document): string | undefined {
  const el = doc.querySelector(".nhv-novel-synopsis");
  if (!el) return undefined;
  // The container also holds an <h2> (the title, repeated) and a trailing
  // <h3> of promotional copy. Take only the paragraphs, or the synopsis
  // arrives with both glued to it.
  const paragraphs = Array.from(el.querySelectorAll("p"))
    .map((p) => sanitizeText(p.textContent))
    .filter((t) => t.length > 0);
  // Fall back to the whole container if the theme ever drops the <p> wrapping.
  const text = paragraphs.length > 0
    ? paragraphs.join("\n\n")
    : sanitizeText(el.textContent);
  if (!text) return undefined;
  const cleaned = text.replace(/Read more$/i, "").trim();
  return cleaned.length > 1500 ? cleaned.slice(0, 1500).trim() + "…" : cleaned;
}

/** The redesigned novel page ships no volume markup — the chapters tab
 *  loads volumes over AJAX. getNovel gets the canonical list from
 *  fetchVolumeMeta's `meta_only=1` call, so there is nothing to scrape
 *  here. Kept (returning empty) so ParsedNovelPage's shape is stable. */
function extractVolumeShells(_doc: Document): VolumeShell[] {
  return [];
}

// ── homepage parsing ───────────────────────────────────────────────────────

function parseHomeSections(doc: Document): SourceSection[] {
  const sections: SourceSection[] = [];
  // Walk each themed nhv-section in document order. We support four
  // shapes the live site renders; unrecognized sections (theme A/B
  // tests, ad blocks) are silently skipped.
  let idx = 0;
  for (const sec of Array.from(doc.querySelectorAll("section.nhv-section"))) {
    const id = `home-${idx}`;
    const title = sanitizeText(sec.querySelector(".nhv-title")?.textContent);
    if (!title) continue;
    let cards: NovelCard[] = [];
    if (sec.classList.contains("nhv-popular")) {
      cards = parsePopularCards(sec);
    } else if (sec.classList.contains("nhv-newseries")) {
      cards = parseNewseriesCards(sec);
    } else if (sec.classList.contains("nhv-manual")) {
      cards = parseManualCards(sec);
    } else if (sec.classList.contains("nhv-newreleases")) {
      cards = parseNewreleasesCards(sec);
    }
    if (cards.length === 0) continue;
    sections.push({ id, title, cards });
    idx++;
  }
  return sections;
}

function parsePopularCards(sec: Element): NovelCard[] {
  const out: NovelCard[] = [];
  for (const a of Array.from(sec.querySelectorAll("a.nhv-pitem"))) {
    const link = a as HTMLAnchorElement;
    const href = link.getAttribute("href") || "";
    if (!isNovelHref(href)) continue;
    const img = link.querySelector("img.nhv-prog-img") as HTMLImageElement | null;
    const title = sanitizeText(link.querySelector(".nhv-ptitle")?.textContent);
    const badge = sanitizeText(link.querySelector(".nhv-badge")?.textContent);
    out.push({
      url: absolutizeUrl(href, BASE_URL),
      title,
      coverUrl: pickImageSrc(img),
      badges: badge ? [badge] : undefined,
    });
  }
  return out;
}

function parseNewseriesCards(sec: Element): NovelCard[] {
  const out: NovelCard[] = [];
  for (const article of Array.from(sec.querySelectorAll("article.nhv-feature"))) {
    const link = article.querySelector(".nhv-feature__title") as HTMLAnchorElement | null;
    const cover = article.querySelector(".nhv-cover") as HTMLAnchorElement | null;
    const href = link?.getAttribute("href") || cover?.getAttribute("href") || "";
    if (!isNovelHref(href)) continue;
    const title = sanitizeText(link?.textContent);
    const img = article.querySelector("img.nhv-prog-img") as HTMLImageElement | null;
    const chips = Array.from(article.querySelectorAll(".nhv-chip"))
      .map((c) => sanitizeText(c.textContent))
      .filter((s) => s.length > 0)
      .slice(0, 3);
    const desc = sanitizeText(article.querySelector(".nhv-feature__desc")?.textContent);
    out.push({
      url: absolutizeUrl(href, BASE_URL),
      title,
      coverUrl: pickImageSrc(img),
      subtitle: desc || undefined,
      badges: chips.length > 0 ? chips : undefined,
    });
  }
  return out;
}

function parseManualCards(sec: Element): NovelCard[] {
  const out: NovelCard[] = [];
  for (const cap of Array.from(sec.querySelectorAll(".nhv-manual__capsule"))) {
    const main = cap.querySelector(".nhv-manual__main") as HTMLAnchorElement | null;
    const href = main?.getAttribute("href") || "";
    if (!isNovelHref(href)) continue;
    const title = sanitizeText(main?.querySelector(".nhv-manual__name")?.textContent);
    const img = main?.querySelector("img.nhv-prog-img") as HTMLImageElement | null;
    out.push({
      url: absolutizeUrl(href, BASE_URL),
      title,
      coverUrl: pickImageSrc(img),
    });
  }
  return out;
}

function parseNewreleasesCards(sec: Element): NovelCard[] {
  const out: NovelCard[] = [];
  for (const row of Array.from(sec.querySelectorAll("article.nhv-nrRow"))) {
    const title = row.querySelector(".nhv-nrTitle") as HTMLAnchorElement | null;
    const href = title?.getAttribute("href") || "";
    if (!isNovelHref(href)) continue;
    const img = row.querySelector("img.nhv-prog-img") as HTMLImageElement | null;
    const latest = row.querySelector(".nhv-chapBtn .nhv-chapBtn__left");
    out.push({
      url: absolutizeUrl(href, BASE_URL),
      title: sanitizeText(title?.textContent),
      coverUrl: pickImageSrc(img),
      subtitle: latest ? sanitizeText(latest.textContent) : undefined,
    });
  }
  return out;
}

/** Cenele novel pages live under `/cont/<slug>/`. We filter so cards
 *  linking to chapter URLs (which also live under /cont/) are skipped —
 *  the store UI assumes a click navigates to a novel detail view. */
function isNovelHref(href: string): boolean {
  if (!href) return false;
  try {
    const u = new URL(href, BASE_URL);
    if (!/(^|\.)cenele\.com$/i.test(u.hostname)) return false;
    const path = u.pathname.replace(/\/+$/, "/");
    // /cont/<slug>/ — novel index. Reject deeper paths (volume / chapter).
    const m = path.match(/^\/cont\/([^/]+)\/?$/);
    return !!m && m[1] !== "";
  } catch {
    return false;
  }
}

// ── chapter-body extraction ────────────────────────────────────────────────

function extractChapterLines(doc: Document): SourceLine[] {
  const root =
    doc.querySelector(".reading-content .text-left") ||
    doc.querySelector(".reading-content") ||
    doc.querySelector(".entry-content") ||
    doc.body;

  // First pass: strip every decoy inline so the subsequent text-extraction
  // walks see a clean tree. Easier than filtering per-paragraph because
  // decoys can be nested several spans deep inside a real `<p>`.
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (isDecoyElement(el)) {
      el.remove();
    }
  }

  const items = root.querySelectorAll("p, img");
  const lines: SourceLine[] = [];
  const seenText = new Set<string>();
  const seenImage = new Set<string>();
  for (const el of Array.from(items)) {
    if (el.tagName === "IMG") {
      const img = el as HTMLImageElement;
      if (isDecorativeImage(img)) continue;
      const src = absoluteImageSrc(img);
      if (!src) continue;
      if (seenImage.has(src)) continue;
      seenImage.add(src);
      lines.push({ type: "image", content: src });
      continue;
    }
    const p = el;
    if (isDecoyElement(p)) continue;
    const text = paragraphText(p);
    if (text.length === 0) continue;
    if (looksLikePiracyDecoy(text)) continue;
    if (seenText.has(text)) continue;
    seenText.add(text);
    lines.push({ type: "text", content: text });
  }
  return lines;
}

/** Decoy paragraphs/spans share a small set of markers the theme uses
 *  to keep them invisible while still being copy-pasted alongside the
 *  real text. Match on the first cheap signal that hits — none of the
 *  legitimate chapter paragraphs carry any of these. */
function isDecoyElement(el: Element): boolean {
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.getAttribute("data-nosnippet") === "true") return true;
  if (el.getAttribute("role") === "presentation") return true;
  // `translate="no"` is a legitimate attribute on, e.g., code blocks,
  // but on cenele's text content it's exclusively used in concert with
  // the other decoy markers. Combine with a style signal so we don't
  // accidentally strip a real <p> some other theme might decorate this
  // way in the future.
  if (el.getAttribute("translate") === "no" && hasHiddenStyle(el)) return true;
  if (hasHiddenStyle(el)) return true;
  return false;
}

function hasHiddenStyle(el: Element): boolean {
  const style = (el.getAttribute("style") || "").toLowerCase().replace(/\s+/g, "");
  if (!style) return false;
  if (!style.includes("position:absolute")) return false;
  // Any one of these dimensions/effects is enough: visible content
  // never combines position:absolute with these.
  return (
    style.includes("opacity:0") ||
    style.includes("width:0") ||
    style.includes("width:1px") ||
    style.includes("height:0") ||
    style.includes("height:1px") ||
    style.includes("transform:scale(0.0") ||
    style.includes("filter:blur") ||
    style.includes("pointer-events:none")
  );
}

/** Final-line safety net: even after pruning the decoy elements,
 *  paragraphs that ONLY contain the piracy boilerplate (which sometimes
 *  appears outside aria-hidden wrappers when the theme rolls a new
 *  variant) get filtered by keyword. The boilerplate phrases here are
 *  unique enough that no real chapter line would match. */
function looksLikePiracyDecoy(text: string): boolean {
  // Strip zero-width joiners/spaces the decoys insert between letters
  // to defeat substring matching.
  const normalized = text.replace(/[​-‏‪-‮⁠-⁯︀-️]/g, "");
  if (/مسروقة/.test(normalized) && /فضاء الروايات|cenele\.com/.test(normalized)) {
    return true;
  }
  if (/فضاء الروايات/.test(normalized) && /تطبيقنا|تطبيق فضاء/.test(normalized)) {
    return true;
  }
  return false;
}

function isDecorativeImage(img: HTMLImageElement): boolean {
  const cls = (img.getAttribute("class") || "").toLowerCase();
  if (cls.includes("avatar")) return true;
  if (cls.includes("emoji")) return true;
  if (cls.includes("wp-post-image")) return true;
  if (cls.includes("attachment-post-thumbnail")) return true;
  const src = (img.getAttribute("src") || "").toLowerCase();
  if (src.includes("/ads/") || src.includes("doubleclick")) return true;
  return false;
}

function absoluteImageSrc(img: HTMLImageElement): string | null {
  const raw =
    img.getAttribute("src") ||
    img.getAttribute("data-src") ||
    img.getAttribute("data-lazy-src");
  if (!raw) return null;
  try {
    return new URL(raw, BASE_URL).toString();
  } catch {
    return null;
  }
}

function paragraphText(p: Element): string {
  const clone = p.cloneNode(true) as Element;
  clone.querySelectorAll("script, noscript, style").forEach((n) => n.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

// ── small helpers ──────────────────────────────────────────────────────────

function sanitizeText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").trim();
}

function sanitizeChapterTitle(raw: string, fallbackId: number): string {
  const collapsed = sanitizeText(raw);
  const safe = collapsed.replace(/[\\/:*?"<>|]+/g, "").trim();
  const truncated = safe.length > 120 ? safe.slice(0, 120).trim() : safe;
  // Rare technical fallback (a scraped chapter with no usable title text) —
  // same pattern as the volume-title fallback elsewhere in this file:
  // synthesized directly via `makeTr(currentUiLocale())` since this becomes
  // the persisted chapter title (data), not something translated at a
  // single display site.
  return (
    truncated ||
    makeTr(currentUiLocale())("novel.chapterNoTitleFallback", { n: fallbackId })
  );
}

function pickImageSrc(img: HTMLImageElement | null): string | undefined {
  if (!img) return undefined;
  const src =
    img.getAttribute("src") ||
    img.getAttribute("data-src") ||
    img.getAttribute("data-lazy-src") ||
    "";
  if (!src) return undefined;
  try {
    return new URL(src, BASE_URL).toString();
  } catch {
    return src;
  }
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
