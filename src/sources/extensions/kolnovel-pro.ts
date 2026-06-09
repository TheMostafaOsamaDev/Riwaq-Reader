// KolNovel Pro source — kolnovel.com. Browse/search/novel pages reuse the
// shared KolNovel theme parsers; the difference is chapter content: each
// chapter is a downloadable PDF (translated text + official illustrations),
// fetched via the site's ts_ln_dl_url token flow and parsed with pdf.js.
//
//   token:  POST /wp-admin/admin-ajax.php  action=ts_ln_dl_url&post_id=<id>
//             → { error:0, url: "https://kolnovel.com/<chapter>/pdf/?tspdftoken=<token>" } (absolute)
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
 *  e.g. ".../...z435ggye-275085/" → "275085". Tolerate a trailing "/pdf/"
 *  download segment and any query/hash so the permalink and its PDF-download
 *  variant (".../-275085/pdf/?tspdftoken=…") both resolve to the same id. */
function extractPostId(url: string): string | null {
  const path = url.replace(/[?#].*$/, "").replace(/\/pdf\/?$/i, "");
  const m = path.match(/-(\d+)\/?$/);
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
    // requestPdfUrl already handled the members-only case; reaching here with
    // non-PDF bytes means the token expired or the endpoint returned an
    // error/login/CDN page instead of the file.
    throw new Error(
      "Downloaded chapter was not a PDF (token may have expired or the endpoint returned an error/login page).",
    );
  }
}
