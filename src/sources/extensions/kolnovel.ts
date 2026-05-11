// KolNovel source — full browse + scrape implementation for free.kolnovel.com.
//
// Of the four scrape entry points, three are pure HTTP because the site
// renders the relevant data in the initial HTML:
//
//   getHomeSections   →  GET /                  →  parse .bixbox sections
//   search            →  GET /?s=<q>&paged=<n>  →  parse .listupd .maindet
//   getNovel          →  GET /series/<slug>/    →  parse .sertobig + .ts-chl-collapsible
//
// The fourth — getChapterContent — still needs the headless webview, because
// chapter bodies are populated by JS shortly after page load (the original
// C# scraper waited via Playwright's WaitForFunctionAsync for the same
// reason). That path goes through host.renderAndExtract.
//
// Selectors are based on a snapshot of the live site (KolNovel runs a
// custom WordPress theme). Brittle bits to watch:
//   - .bs cards in the homepage can carry either a /series/ URL or a
//     /shaag24…/ chapter URL depending on which row they're in; we filter
//     to series-URL cards in getHomeSections so clicking a card always
//     lands on a novel page.
//   - The .utao "latest updates" rows surface series URLs in .imgu > a.

import { absolutizeUrl, parseHtmlDocument } from "../host";
import type {
  NovelCard,
  Source,
  SourceChapter,
  SourceHost,
  SourceLine,
  SourceNovel,
  SourceNovelMeta,
  SourceSearchResult,
  SourceSection,
  SourceVolume,
} from "../types";

const SOURCE_ID = "kolnovel";
const BASE_URL = "https://free.kolnovel.com";

const IGNORED_PATTERNS = [
  "*إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات ko*lno*vel ko*lno*vel. com",
];
const IGNORED_REGEXES = IGNORED_PATTERNS.map(toIgnoreRegex);

function toIgnoreRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${withWildcards}$`, "i");
}

export function createKolNovelSource(host: SourceHost): Source {
  return {
    meta: {
      id: SOURCE_ID,
      name: "KolNovel",
      baseUrl: BASE_URL,
      language: "ar",
      description:
        "Arabic translations of Asian web novels from free.kolnovel.com.",
      version: "0.2.0",
    },

    canHandle(url) {
      try {
        const u = new URL(url);
        return /(^|\.)kolnovel\.com$/i.test(u.hostname);
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
      const pageNum = Math.max(1, page ?? 1);
      const params = new URLSearchParams({ s: query });
      if (pageNum > 1) params.set("paged", String(pageNum));
      const url = `${BASE_URL}/?${params.toString()}`;
      host.log("info", `search(${query}, page=${pageNum}) → ${url}`);
      const resp = await host.fetch(url);
      const doc = parseHtmlDocument(resp.text);
      return parseSearchResults(doc, query, pageNum);
    },

    async getNovel(url) {
      host.log("info", `getNovel(${url})`);
      const resp = await host.fetch(url);
      const doc = parseHtmlDocument(resp.text);
      return parseNovelPage(doc, url);
    },

    async getChapterContent(chapter) {
      host.log("debug", `getChapterContent(#${chapter.id} ${chapter.title})`);
      // Chapter content is in the initial HTML on KolNovel — the hidden
      // decoy paragraphs (height: 0.1px, position: fixed, etc.) that the
      // original Playwright scraper had to filter out are injected by JS
      // at runtime, NOT present in the server response. So static fetch
      // gives us a clean paragraph list AND avoids the headless-webview
      // timeout problem entirely.
      const resp = await host.fetch(chapter.url);
      const doc = parseHtmlDocument(resp.text);
      return extractChapterLines(doc);
    },
  };
}

// ── chapter-page extraction (static) ────────────────────────────────────────

function extractChapterLines(doc: Document): SourceLine[] {
  // Prefer the canonical chapter body (`#kol_content`); fall back to the
  // first `.entry-content` for theme variations. Walking inside this
  // single container scopes us away from sidebar/related-posts widgets
  // that share the `.entry-content` class but aren't part of the
  // chapter the user wants.
  const root =
    doc.querySelector("#kol_content") ||
    doc.querySelector(".entry-content") ||
    doc.body;

  // Walk all `<p>` and `<img>` descendants in document order. A chapter
  // page on KolNovel mixes inline illustrations (book maps, character
  // art) with text paragraphs at sibling depth, so we have to handle
  // both — image-only chapters and prose-only chapters alike.
  const items = root.querySelectorAll("p, img");

  const lines: SourceLine[] = [];
  const seenText = new Set<string>();
  const seenImage = new Set<string>();
  for (const el of Array.from(items)) {
    if (el.tagName === "IMG") {
      // Skip the image if it's already been emitted (e.g., when the
      // same `<img>` is also nested inside a `<p>` we'll walk later —
      // querySelectorAll yields each element once, but we still guard
      // against URL duplicates from inlined banner/cover repeats).
      const img = el as HTMLImageElement;
      if (isDecorativeImage(img)) continue;
      const src = absoluteImageSrc(img);
      if (!src) continue;
      if (seenImage.has(src)) continue;
      seenImage.add(src);
      lines.push({ type: "image", content: src });
      continue;
    }
    // <p> path. If this paragraph contains an `<img>` (nested), the
    // image was/will be emitted separately by the IMG branch — we still
    // emit any surrounding text but only if it's non-trivial.
    const p = el;
    if (isHiddenInline(p)) continue;
    const text = paragraphText(p);
    if (text.length === 0) continue;
    if (isIgnored(text)) continue;
    if (seenText.has(text)) continue;
    seenText.add(text);
    lines.push({ type: "text", content: text });
  }
  return lines;
}

/** Reject site-furniture imagery (post thumbnails, ad banners,
 *  WordPress sharing icons, …) by class-name signal. The chapter body
 *  illustrations on KolNovel typically carry classes like
 *  `aligncenter size-full wp-image-XXXX` — no `wp-post-image` or
 *  `attachment-post-thumbnail`. */
function isDecorativeImage(img: HTMLImageElement): boolean {
  const cls = (img.getAttribute("class") || "").toLowerCase();
  if (cls.includes("wp-post-image")) return true;
  if (cls.includes("attachment-post-thumbnail")) return true;
  if (cls.includes("avatar")) return true;
  if (cls.includes("emoji")) return true;
  const src = (img.getAttribute("src") || "").toLowerCase();
  // Common ad/network image patterns.
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

/** True when a paragraph is decorated with the inline-style pattern the
 *  site uses to visually hide decoy text — `height: 0.1px` plus
 *  `position: fixed` plus `opacity: 0` etc. Pure static check; the
 *  computed-style + offset path the JS scraper used can't run here, but
 *  in practice those decoys are JS-injected after the initial response,
 *  so the static HTML doesn't include them at all. This is a belt-and-
 *  suspenders catch for the rare case where the server-side template
 *  ships one inline. */
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
  // Strip nested <script>/<noscript> just in case, then collapse
  // whitespace. innerText would honor block-level newlines but isn't
  // available on a parsed (non-rendered) Document — textContent is the
  // closest equivalent here.
  const clone = p.cloneNode(true) as Element;
  clone.querySelectorAll("script, noscript, style").forEach((n) => n.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function isIgnored(line: string): boolean {
  return IGNORED_REGEXES.some((r) => r.test(line));
}

// ── home-page parsing ───────────────────────────────────────────────────────

function parseHomeSections(doc: Document): SourceSection[] {
  // Walk the homepage in document order so sections come back in the
  // same order the user sees on the site. We support three section
  // shapes:
  //
  //   .trendarea          "Trending this week" hero list (.trendlist items)
  //   .homehot            "Trending updates" big-card row (.hotoday items)
  //   .bixbox + .listupd  Most other sections — completed novels,
  //                       recommendations, new novels, …
  //
  // Each shape has its own card extractor; the union of their outputs
  // becomes the SourceSection.cards array.
  const sections: SourceSection[] = [];
  let idx = 0;
  const candidates = doc.querySelectorAll(".trendarea, .homehot, .bixbox");
  for (const el of Array.from(candidates)) {
    const section = parseSectionElement(el, `home-${idx}`);
    if (section && section.cards.length > 0) {
      sections.push(section);
      idx++;
    }
  }
  return sections;
}

function parseSectionElement(
  el: Element,
  id: string,
): SourceSection | null {
  if (el.classList.contains("trendarea")) {
    return parseTrendArea(el, id);
  }
  if (el.classList.contains("homehot")) {
    return parseHomeHot(el, id);
  }
  // .bixbox path — most homepage sections.
  const heading = el.querySelector(".releases h1, .releases h2, .releases h3");
  if (!heading) return null;
  const title = cleanTitle(heading.textContent);
  if (!title) return null;
  const listupd = el.querySelector(".listupd");
  if (!listupd) return null;
  // Skip blog roll + small sidebar widgets that share .bixbox but don't
  // have novel cards.
  if (listupd.querySelector(".blogbox, .lexa")) return null;
  const cards = parseCardsInListupd(listupd);
  if (cards.length === 0) return null;
  const viewMore = el.querySelector(".releases .vl") as HTMLAnchorElement | null;
  return {
    id,
    title,
    cards,
    viewMoreUrl: viewMore?.href || undefined,
  };
}

function parseTrendArea(el: Element, id: string): SourceSection | null {
  const title =
    cleanTitle(el.querySelector(".topareatitle")?.textContent) || "Trending";
  const cards: NovelCard[] = [];
  for (const item of Array.from(el.querySelectorAll(".trendlist"))) {
    const link = item.querySelector(".thumbtr a") as HTMLAnchorElement | null;
    if (!link) continue;
    const href = link.getAttribute("href") || "";
    if (!/\/series\//.test(href)) continue;
    const img = item.querySelector(".thumbtr img") as HTMLImageElement | null;
    const titleEl = item.querySelector(".trenti a, .trenti");
    const score = cleanTitle(item.querySelector(".trendscore")?.textContent);
    const genres = Array.from(item.querySelectorAll(".cusi.gentop a"))
      .map((a) => cleanTitle(a.textContent))
      .filter((s) => s.length > 0);
    const badges: string[] = [];
    if (score) badges.push(`★ ${score}`);
    badges.push(...genres.slice(0, 1));
    cards.push({
      url: absolutizeUrl(href, BASE_URL),
      title: cleanTitle(titleEl?.textContent),
      coverUrl: pickImageSrc(img),
      subtitle: cleanTitle(item.querySelector(".trendsys")?.textContent),
      badges: badges.length > 0 ? badges : undefined,
    });
  }
  return cards.length > 0 ? { id, title, cards } : null;
}

function parseHomeHot(el: Element, id: string): SourceSection | null {
  const title =
    cleanTitle(el.querySelector(".topareatitle")?.textContent) || "Hot updates";
  const cards: NovelCard[] = [];
  for (const item of Array.from(el.querySelectorAll(".hotoday"))) {
    const link = item.querySelector(".inhotoday > a") as HTMLAnchorElement | null;
    if (!link) continue;
    const href = link.getAttribute("href") || "";
    if (!/\/series\//.test(href)) continue;
    const img = item.querySelector(".todthumb img") as HTMLImageElement | null;
    const status = cleanTitle(item.querySelector(".todstat")?.textContent);
    const titleEl = item.querySelector(".todtitle");
    const latestChapter = cleanTitle(item.querySelector(".todchap")?.textContent);
    const score = cleanTitle(item.querySelector(".todnum")?.textContent);
    const badges: string[] = [];
    if (score) badges.push(`★ ${score}`);
    if (status) badges.push(status);
    cards.push({
      url: absolutizeUrl(href, BASE_URL),
      title: cleanTitle(titleEl?.textContent),
      coverUrl: pickImageSrc(img),
      subtitle: latestChapter || undefined,
      badges: badges.length > 0 ? badges : undefined,
    });
  }
  return cards.length > 0 ? { id, title, cards } : null;
}

/** Read every card under a .listupd, whether it's in `.bs/.bsx` form or
 *  `.utao` form. Cards whose link points at a chapter rather than a series
 *  index are filtered out — the store's UI assumes a click navigates to a
 *  novel detail page. */
function parseCardsInListupd(listupd: Element): NovelCard[] {
  const out: NovelCard[] = [];
  const utaos = listupd.querySelectorAll(".utao");
  for (const u of Array.from(utaos)) {
    const card = parseUtaoCard(u);
    if (card) out.push(card);
  }
  // Cards in .bs form. Skip if there are .utao siblings — KolNovel
  // sometimes nests .utao + .bs in the same container and we don't want
  // duplicates.
  if (utaos.length === 0) {
    const bsArticles = listupd.querySelectorAll("article.bs");
    for (const a of Array.from(bsArticles)) {
      const card = parseBsCard(a);
      if (card) out.push(card);
    }
  }
  return out;
}

function parseUtaoCard(el: Element): NovelCard | null {
  const link = el.querySelector(".imgu a, .luf > a") as HTMLAnchorElement | null;
  if (!link) return null;
  const href = link.getAttribute("href") || "";
  if (!/\/series\//.test(href)) return null;
  const img = el.querySelector(".imgu img") as HTMLImageElement | null;
  const titleEl = el.querySelector(".luf h3");
  const latestEl = el.querySelector(".luf ul li a");
  return {
    url: absolutizeUrl(href, BASE_URL),
    title: cleanTitle(titleEl?.textContent || link.getAttribute("title")),
    coverUrl: pickImageSrc(img),
    subtitle: cleanTitle(latestEl?.textContent),
  };
}

function parseBsCard(el: Element): NovelCard | null {
  const link = el.querySelector(".bsx > a") as HTMLAnchorElement | null;
  if (!link) return null;
  const href = link.getAttribute("href") || "";
  // Only surface cards that point at a series page; otherwise the user
  // can't navigate to a novel detail view from this card.
  if (!/\/series\//.test(href)) return null;
  const img = el.querySelector(".limit img, .bsx img") as HTMLImageElement | null;
  const ntitle = el.querySelector(".tt .ntitle");
  const nchapter = el.querySelector(".tt .nchapter");
  return {
    url: absolutizeUrl(href, BASE_URL),
    title: cleanTitle(ntitle?.textContent || link.getAttribute("title")),
    coverUrl: pickImageSrc(img),
    subtitle: cleanTitle(nchapter?.textContent),
  };
}

// ── search-page parsing ─────────────────────────────────────────────────────

function parseSearchResults(
  doc: Document,
  query: string,
  page: number,
): SourceSearchResult {
  const cards: NovelCard[] = [];
  const articles = doc.querySelectorAll(".listupd .maindet, article.maindet");
  for (const a of Array.from(articles)) {
    const link =
      (a.querySelector(".mdthumb a, .mdinfo h2 a") as HTMLAnchorElement | null);
    if (!link) continue;
    const href = link.getAttribute("href") || "";
    if (!href) continue;
    const img = a.querySelector(".mdthumb img") as HTMLImageElement | null;
    const title = cleanTitle(
      a.querySelector(".mdinfo h2 a")?.textContent ||
        link.getAttribute("title"),
    );
    const excerpt = cleanTitle(
      a.querySelector(".contexcerpt p")?.textContent,
    );
    const genreLinks = Array.from(a.querySelectorAll(".mdgenre a"))
      .map((g) => (g.textContent || "").replace(/^#\s*/, "").trim())
      .filter((s) => s.length > 0);
    cards.push({
      url: absolutizeUrl(href, BASE_URL),
      title,
      coverUrl: pickImageSrc(img),
      subtitle: excerpt || undefined,
      badges: genreLinks.length > 0 ? genreLinks : undefined,
    });
  }

  // Pagination — WordPress emits a `.pagination` block with `.page-numbers`
  // links/spans. Detect a "next page" by looking for one whose text or
  // class indicates a page beyond the current one.
  const pageLinks = doc.querySelectorAll(".pagination .page-numbers");
  let hasMore = false;
  for (const pl of Array.from(pageLinks)) {
    const cls = pl.className || "";
    const txt = (pl.textContent || "").trim();
    // The "next" link's class often includes "next"; some themes show a
    // higher-numbered link instead — accept either signal.
    if (/\bnext\b/i.test(cls)) {
      hasMore = true;
      break;
    }
    const n = parseInt(txt, 10);
    if (!Number.isNaN(n) && n > page) {
      hasMore = true;
      break;
    }
  }

  return { cards, hasMore, query, page };
}

// ── novel-page parsing ──────────────────────────────────────────────────────

function parseNovelPage(doc: Document, pageUrl: string): SourceNovel {
  const sertobig = doc.querySelector(".sertobig") ?? doc;

  const title =
    cleanTitle(sertobig.querySelector("h1.entry-title")?.textContent) ||
    cleanTitle(doc.querySelector("h1.entry-title")?.textContent) ||
    "Unknown title";

  const originalTitle =
    cleanTitle(sertobig.querySelector(".alter")?.textContent) || undefined;

  const status =
    cleanTitle(sertobig.querySelector(".sertostat > span")?.textContent) ||
    undefined;

  const coverImg = sertobig.querySelector(
    ".sertothumb img",
  ) as HTMLImageElement | null;
  const coverUrl = pickImageSrc(coverImg);

  // serl rows — each is one labeled metadata field. We capture them all so
  // the UI can render a complete definition list, but also pluck the
  // author out for the EPUB metadata.
  const meta: SourceNovelMeta[] = [];
  let author = "Unknown author";
  for (const row of Array.from(sertobig.querySelectorAll(".serl"))) {
    const label = cleanTitle(row.querySelector(".sername")?.textContent);
    const valEl = row.querySelector(".serval");
    if (!label || !valEl) continue;
    const linkEl = valEl.querySelector("a");
    const value =
      cleanTitle(valEl.textContent).replace(/^[:：]\s*/, "") || "";
    if (!value) continue;
    meta.push({
      label,
      value,
      url: linkEl
        ? absolutizeUrl(linkEl.getAttribute("href") || "", BASE_URL)
        : undefined,
    });
    // Heuristic: the author row is labeled with "الكاتب" (Arabic for
    // "Writer/Author") on this theme. Fall back to first matching English
    // label too in case the theme switches language.
    if (
      /كاتب|writer|author/i.test(label) &&
      author === "Unknown author"
    ) {
      author = value;
    }
  }

  const tags = Array.from(sertobig.querySelectorAll(".sertogenre a"))
    .map((a) => cleanTitle(a.textContent))
    .filter((s) => s.length > 0);

  const descEl =
    sertobig.querySelector(".sersys.entry-content") ||
    sertobig.querySelector(".sersys") ||
    doc.querySelector(".sersys");
  const description = descEl
    ? extractDescriptionText(descEl)
    : undefined;

  const volumes = parseVolumes(doc, pageUrl);

  return {
    title,
    author,
    originalTitle,
    language: "ar",
    direction: "rtl",
    coverUrl,
    description,
    tags,
    status,
    meta,
    volumes,
  };
}

function parseVolumes(doc: Document, pageUrl: string): SourceVolume[] {
  // Read volume headers in document order, then for each follow its
  // `.ts-chl-collapsible-content` sibling for the chapter list. The
  // sibling isn't always the immediate next element — sometimes there's
  // a wrapper div between them — so walk forward until we find it.
  const headers = Array.from(
    doc.querySelectorAll(".ts-chl-collapsible"),
  );
  const volumeBuckets: { title: string; anchors: HTMLAnchorElement[] }[] = [];
  for (const h of headers) {
    const title = cleanTitle(h.textContent);
    let sibling: Element | null = h.nextElementSibling;
    while (sibling && !sibling.classList.contains("ts-chl-collapsible-content")) {
      sibling = sibling.nextElementSibling;
    }
    const anchors = sibling
      ? (Array.from(
          sibling.querySelectorAll("ul li a"),
        ) as HTMLAnchorElement[])
      : [];
    volumeBuckets.push({ title, anchors });
  }
  // The page lists volumes newest-first; reverse so volume 1 comes first.
  // Same for chapters within each volume.
  volumeBuckets.reverse();
  for (const b of volumeBuckets) b.anchors.reverse();

  let runningChapterId = 1;
  return volumeBuckets.map((b, vi) => ({
    id: vi + 1,
    title: b.title || `Volume ${vi + 1}`,
    chapters: b.anchors.map<SourceChapter>((a) => {
      const href = a.getAttribute("href") || "";
      const titleEl = a.querySelector(".epl-title");
      const rawTitle = (titleEl ? titleEl.textContent : a.textContent) || "";
      return {
        id: runningChapterId++,
        title: sanitizeTitle(rawTitle, runningChapterId),
        url: absolutizeUrl(href, pageUrl),
        lines: [],
      };
    }),
  }));
}

// ── helpers ─────────────────────────────────────────────────────────────────

function cleanTitle(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").trim();
}

function sanitizeTitle(raw: string, fallbackId: number): string {
  const collapsed = cleanTitle(raw);
  const safe = collapsed.replace(/[\\/:*?"<>|]+/g, "").trim();
  const truncated = safe.length > 100 ? safe.slice(0, 100).trim() : safe;
  return truncated || `${fallbackId} - No Title`;
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

function extractDescriptionText(el: Element): string {
  // Strip injected ad blocks (e.g., `code-block`, `<script>` wrappers) so
  // the description in the UI doesn't read "...the world. 222222222
  // window.pubfuturetag.push(...)". Cloning lets us mutate without
  // disturbing the parsed DOM.
  const clone = el.cloneNode(true) as Element;
  clone
    .querySelectorAll("script, .code-block, .ai-viewports")
    .forEach((n) => n.remove());
  const text = (clone.textContent || "").replace(/\s+/g, " ").trim();
  // Many KolNovel pages prepend a few hundred chars; cap so the UI's
  // description card doesn't grow unbounded — full text is still
  // available in the imported EPUB's content.
  return text.length > 1200 ? text.slice(0, 1200).trim() + "…" : text;
}
