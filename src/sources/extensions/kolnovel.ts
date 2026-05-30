// KolNovel source — browse + scrape implementation for free.kolnovel.com.
//
// Discovery (home, search, novel page) is delegated to kolnovel-theme.ts, the
// shared WordPress-theme DOM parsers parameterized by base URL — KolNovel and
// KolNovel Pro render those pages with the same theme. All of them are pure
// HTTP because the site ships the data in the initial HTML.
//
// The only scrape step owned here is chapter content:
//   getChapterContent  →  GET /<chapter-slug>/  →  parse #kol_content
//
// Chapter pages carry rotating per-load hex class names that mark decoy
// paragraphs (duplicated text + the kolnovel.com ad string); see
// extractChapterLines / collectHiddenClasses below for how they're filtered.

import { parseHtmlDocument } from "../host";
import {
  parseHomeSections,
  parseNovelPage,
  parseSearchResults,
} from "./kolnovel-theme";
import type {
  Source,
  SourceHost,
  SourceLine,
} from "../types";

const SOURCE_ID = "kolnovel";
const BASE_URL = "https://free.kolnovel.com";

const IGNORED_PATTERNS = [
  "*إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات ko*lno*vel ko*lno*vel. com",
];
const IGNORED_REGEXES = IGNORED_PATTERNS.map(toIgnoreRegex);

/** Compile an ignore pattern into a regex suitable for substring stripping.
 *  - Leading/trailing `*` are trimmed first — they were only meaningful
 *    for the old whole-line `^…$` match; for substring strip they make
 *    the lazy wildcard scan back into legitimate text.
 *  - Interior `*` wildcards become **lazy** `.*?` so a stray match
 *    doesn't bridge two well-separated ad occurrences across real text.
 *  - The compiled regex is padded with optional `\s*\*?\s*` on both
 *    ends so a stray `*` marker that the obfuscator left adjacent to
 *    the phrase boundary in the source line gets absorbed too. This is
 *    how we handle inputs like `real text. *<ad pattern>* more text`
 *    without leaving a dangling `*` behind.
 *  - `gi` flags so `String.replace` strips every occurrence. */
function toIgnoreRegex(pattern: string): RegExp {
  const trimmed = pattern.replace(/^\*+|\*+$/g, "");
  const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*?");
  return new RegExp(`\\s*\\*?\\s*${withWildcards}\\s*\\*?\\s*`, "gi");
}

/** Given the textContent of a single <style> block, return the set of
 *  class names whose rule body matches the KolNovel decoy signature.
 *  The site re-rolls these names on every page load, so we discover them
 *  rather than hardcoding. The signature looks for three independent
 *  tokens — `0.1px`, `opacity` followed by `0`, and `-99999px` — so the
 *  match still works if the site reorders properties or tweaks
 *  whitespace. Only `.[hex]{20,}` selectors are collected; that's the
 *  shape KolNovel uses (random hex with an `a` prefix), and limiting to
 *  long hex avoids snagging legitimate semantic class names. */
function extractHiddenClassesFromCss(cssText: string): Set<string> {
  const out = new Set<string>();
  // Split on rule boundaries — each match is one `selectors { body }` group.
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

/** Discover every decoy class name across all inline <style> blocks in
 *  the parsed chapter document. Returns an empty Set when no rule
 *  matches the hide signature — callers must treat that as "no
 *  class-based decoys to filter" rather than an error. */
function collectHiddenClasses(doc: Document): Set<string> {
  const out = new Set<string>();
  for (const styleEl of Array.from(doc.querySelectorAll("style"))) {
    const css = styleEl.textContent || "";
    if (!css) continue;
    for (const c of extractHiddenClassesFromCss(css)) out.add(c);
  }
  return out;
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
        return new URL(url).hostname.toLowerCase() === "free.kolnovel.com";
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
      const resp = await host.fetch(url);
      return parseNovelPage(parseHtmlDocument(resp.text), BASE_URL, url);
    },

    async getChapterContent(chapter) {
      host.log("debug", `getChapterContent(#${chapter.id} ${chapter.title})`);
      // Chapter content is in the initial HTML on KolNovel. The
      // anti-scrape decoys (paragraphs containing duplicated sentences,
      // the kolnovel.com ad string, and inline ad-network JS) are
      // present in the server response, NOT injected at runtime — they're
      // marked by `class` attributes that reference an inline <style>
      // rule whose 9 hex class names rotate per page load.
      // `extractChapterLines` discovers those names from the <style>
      // block and filters the matching <p> tags. Ad-string fragments
      // that survive the class filter (e.g., embedded inline in a real
      // paragraph) are scrubbed from each paragraph by `stripIgnored`.
      const resp = await host.fetch(chapter.url);
      const doc = parseHtmlDocument(resp.text);
      return extractChapterLines(doc);
    },
  };
}

// ── chapter-page extraction (static) ────────────────────────────────────────

function extractChapterLines(doc: Document): SourceLine[] {
  // Discover the per-page-load set of decoy class names from the
  // chapter's inline <style> block (KolNovel rotates these on each
  // request). Empty Set is a valid result — older/un-obfuscated
  // chapters simply produce no class-based filter.
  const hiddenClasses = collectHiddenClasses(doc);

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

/** True when `p` carries any class name in the discovered hidden set.
 *  Reads `className` directly (cheap) and splits on whitespace. */
function hasHiddenClass(p: Element, hidden: Set<string>): boolean {
  if (hidden.size === 0) return false;
  const cls = (p.getAttribute("class") || "").trim();
  if (!cls) return false;
  for (const c of cls.split(/\s+/)) {
    if (hidden.has(c)) return true;
  }
  return false;
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
 *  `position: fixed` plus `opacity: 0` etc. Belt-and-suspenders catch
 *  for the rare server-rendered variant where the hide style is shipped
 *  inline rather than via a class; the common case (a rotating set of
 *  hex class names mapped to the same hide style by an inline <style>
 *  rule) is handled by `hasHiddenClass`. */
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

/** Strip every occurrence of every ignore pattern from `line`, then
 *  collapse whitespace. Each match is replaced with a single space so
 *  surrounding text doesn't get glued together; the final whitespace
 *  collapse normalises the result. Callers should drop the paragraph
 *  when the returned string is empty. */
function stripIgnored(line: string): string {
  let out = line;
  for (const r of IGNORED_REGEXES) out = out.replace(r, " ");
  return out.replace(/\s+/g, " ").trim();
}
