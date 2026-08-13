// Shared KolNovel WordPress-theme parsers. Both the free source
// (free.kolnovel.com) and the pro source (kolnovel.com) render their browse,
// search, novel, AND chapter pages with the same theme, so the DOM→data
// parsing lives here once and is parameterized by base URL. `parseChapterContent`
// handles chapter bodies for both (free = always HTML; pro = HTML-first with a
// PDF fallback owned by kolnovel-pro.ts).

import { absolutizeUrl } from "../host";
import { makeTr, type Locale } from "../../i18n";
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

/** Best-effort current UI locale for the rare case a homepage scrape
 *  doesn't yield a section heading and we fall back to a fixed name. This
 *  module runs outside the component tree (plain DOM parsing, no React
 *  context available), so it reads `document.documentElement.lang` instead
 *  of `useI18n()` — App.tsx keeps that attribute in sync with the user's
 *  UI-language preference. */
function currentUiLocale(): Locale {
  if (typeof document !== "undefined" && document.documentElement.lang === "ar") {
    return "ar";
  }
  return "en";
}

// ── home-page parsing ───────────────────────────────────────────────────────

export function parseHomeSections(doc: Document, baseUrl: string): SourceSection[] {
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
    const section = parseSectionElement(el, `home-${idx}`, baseUrl);
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
  baseUrl: string,
): SourceSection | null {
  if (el.classList.contains("trendarea")) {
    return parseTrendArea(el, id, baseUrl);
  }
  if (el.classList.contains("homehot")) {
    return parseHomeHot(el, id, baseUrl);
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
  const cards = parseCardsInListupd(listupd, baseUrl);
  if (cards.length === 0) return null;
  const viewMore = el.querySelector(".releases .vl") as HTMLAnchorElement | null;
  return {
    id,
    title,
    cards,
    viewMoreUrl: viewMore?.href || undefined,
  };
}

function parseTrendArea(el: Element, id: string, baseUrl: string): SourceSection | null {
  const title =
    cleanTitle(el.querySelector(".topareatitle")?.textContent) ||
    makeTr(currentUiLocale())("source.section.trendingFallback");
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
      url: absolutizeUrl(href, baseUrl),
      title: cleanTitle(titleEl?.textContent),
      coverUrl: pickImageSrc(img, baseUrl),
      subtitle: cleanTitle(item.querySelector(".trendsys")?.textContent),
      badges: badges.length > 0 ? badges : undefined,
    });
  }
  return cards.length > 0 ? { id, title, cards } : null;
}

function parseHomeHot(el: Element, id: string, baseUrl: string): SourceSection | null {
  const title =
    cleanTitle(el.querySelector(".topareatitle")?.textContent) ||
    makeTr(currentUiLocale())("source.section.hotUpdatesFallback");
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
      url: absolutizeUrl(href, baseUrl),
      title: cleanTitle(titleEl?.textContent),
      coverUrl: pickImageSrc(img, baseUrl),
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
function parseCardsInListupd(listupd: Element, baseUrl: string): NovelCard[] {
  const out: NovelCard[] = [];
  const utaos = listupd.querySelectorAll(".utao");
  for (const u of Array.from(utaos)) {
    const card = parseUtaoCard(u, baseUrl);
    if (card) out.push(card);
  }
  // Cards in .bs form. Skip if there are .utao siblings — KolNovel
  // sometimes nests .utao + .bs in the same container and we don't want
  // duplicates.
  if (utaos.length === 0) {
    const bsArticles = listupd.querySelectorAll("article.bs");
    for (const a of Array.from(bsArticles)) {
      const card = parseBsCard(a, baseUrl);
      if (card) out.push(card);
    }
  }
  return out;
}

function parseUtaoCard(el: Element, baseUrl: string): NovelCard | null {
  const link = el.querySelector(".imgu a, .luf > a") as HTMLAnchorElement | null;
  if (!link) return null;
  const href = link.getAttribute("href") || "";
  if (!/\/series\//.test(href)) return null;
  const img = el.querySelector(".imgu img") as HTMLImageElement | null;
  const titleEl = el.querySelector(".luf h3");
  const latestEl = el.querySelector(".luf ul li a");
  return {
    url: absolutizeUrl(href, baseUrl),
    title: cleanTitle(titleEl?.textContent || link.getAttribute("title")),
    coverUrl: pickImageSrc(img, baseUrl),
    subtitle: cleanTitle(latestEl?.textContent),
  };
}

function parseBsCard(el: Element, baseUrl: string): NovelCard | null {
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
    url: absolutizeUrl(href, baseUrl),
    title: cleanTitle(ntitle?.textContent || link.getAttribute("title")),
    coverUrl: pickImageSrc(img, baseUrl),
    subtitle: cleanTitle(nchapter?.textContent),
  };
}

// ── search-page parsing ─────────────────────────────────────────────────────

export function parseSearchResults(
  doc: Document,
  baseUrl: string,
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
      url: absolutizeUrl(href, baseUrl),
      title,
      coverUrl: pickImageSrc(img, baseUrl),
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

export function parseNovelPage(doc: Document, baseUrl: string, pageUrl: string): SourceNovel {
  const sertobig = doc.querySelector(".sertobig") ?? doc;

  const title =
    cleanTitle(sertobig.querySelector("h1.entry-title")?.textContent) ||
    cleanTitle(doc.querySelector("h1.entry-title")?.textContent) ||
    makeTr(currentUiLocale())("common.untitled");

  const originalTitle =
    cleanTitle(sertobig.querySelector(".alter")?.textContent) || undefined;

  const status =
    cleanTitle(sertobig.querySelector(".sertostat > span")?.textContent) ||
    undefined;

  const coverImg = sertobig.querySelector(
    ".sertothumb img",
  ) as HTMLImageElement | null;
  const coverUrl = pickImageSrc(coverImg, baseUrl);

  // serl rows — each is one labeled metadata field. We capture them all so
  // the UI can render a complete definition list, but also pluck the
  // author out for the EPUB metadata. Empty (not "Unknown author") when
  // no author row is found — same rationale as the epub/docx author fix:
  // a blank `Book.author` lets the display-time fallback
  // (`common.unknownAuthor`) localize it, instead of freezing an English
  // literal into the novel's persisted data.
  const meta: SourceNovelMeta[] = [];
  let author = "";
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
        ? absolutizeUrl(linkEl.getAttribute("href") || "", baseUrl)
        : undefined,
    });
    // Heuristic: the author row is labeled with "الكاتب" (Arabic for
    // "Writer/Author") on this theme. Fall back to first matching English
    // label too in case the theme switches language.
    if (/كاتب|writer|author/i.test(label) && !author) {
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

export function parseVolumes(doc: Document, pageUrl: string): SourceVolume[] {
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
    // One anchor per chapter: the chapter permalink is the direct child of
    // the <li>. The pro source also renders a per-chapter PDF download link
    // (<div class="epl-pdf"><a class="dlpdf" href=".../pdf/">), which is NOT a
    // direct child — `li > a` excludes it so it isn't parsed as a phantom
    // "No Title" chapter. The free source has only the one direct-child anchor.
    const anchors = sibling
      ? (Array.from(
          sibling.querySelectorAll("ul li > a"),
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
    title:
      b.title ||
      makeTr(currentUiLocale())("novel.volumeFallback", { n: vi + 1 }),
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
  // Rare technical fallback (a scraped chapter with no usable title text) —
  // same pattern as the volume-title fallback above: synthesized directly
  // here via `makeTr(currentUiLocale())` since this becomes the persisted
  // chapter title (data), not something translated at a single display site.
  return (
    truncated ||
    makeTr(currentUiLocale())("novel.chapterNoTitleFallback", { n: fallbackId })
  );
}

function pickImageSrc(img: HTMLImageElement | null, baseUrl: string): string | undefined {
  if (!img) return undefined;
  const src =
    img.getAttribute("src") ||
    img.getAttribute("data-src") ||
    img.getAttribute("data-lazy-src") ||
    "";
  if (!src) return undefined;
  try {
    return new URL(src, baseUrl).toString();
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
