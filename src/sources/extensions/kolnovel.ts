// KolNovel source — browse + scrape implementation for kolnovel.com.
// free.kolnovel.com 301-redirects here now; canHandle still matches it so
// URLs already saved in a user's library continue to resolve.
//
// Discovery (home, search, novel page) AND chapter-body extraction are all
// delegated to kolnovel-theme.ts, the shared WordPress-theme DOM parsers
// parameterized by base URL — KolNovel and KolNovel Pro render those pages with
// the same theme. Everything is pure HTTP because the site ships the data in
// the initial HTML.
//
//   getChapterContent  →  GET /<chapter-slug>/  →  parseChapterContent(doc, base)
//
// The shared parseChapterContent discovers the rotating per-load hex decoy
// classes (duplicated text + the kolnovel.com ad string) and filters them.

import { parseHtmlDocument } from "../host";
import {
  parseChapterContent,
  parseHomeSections,
  parseNovelPage,
  parseSearchResults,
} from "./kolnovel-theme";
import type {
  Source,
  SourceHost,
} from "../types";

const SOURCE_ID = "kolnovel";
const BASE_URL = "https://kolnovel.com";

export function createKolNovelSource(host: SourceHost): Source {
  return {
    meta: {
      id: SOURCE_ID,
      name: "ملوك الروايات",
      baseUrl: BASE_URL,
      language: "ar",
      version: "0.2.0",
    },

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

    async getHomeSections() {
      host.log("info", "getHomeSections");
      const resp = await host.fetch(BASE_URL + "/");
      return parseHomeSections(parseHtmlDocument(resp.text), BASE_URL);
    },

    async search(query) {
      const url = `${BASE_URL}/?${new URLSearchParams({ s: query })}`;
      host.log("info", `search(${query}) → ${url}`);
      const resp = await host.fetch(url);
      // KolNovel renders every match on one page, and both ?s=&paged=N and
      // /page/N/?s= return HTTP 500 on this host. parseSearchResults derives
      // hasMore from the theme's .pagination block, which can be populated on
      // broad queries — so force it false here rather than trusting the DOM.
      // A true value would render a Load more button whose click can only
      // refetch page 1 and be deduped away.
      return {
        ...parseSearchResults(parseHtmlDocument(resp.text), BASE_URL, query, 1),
        hasMore: false,
      };
    },

    async getNovel(url) {
      host.log("info", `getNovel(${url})`);
      const resp = await host.fetch(url);
      return parseNovelPage(parseHtmlDocument(resp.text), BASE_URL, url);
    },

    async getChapterContent(chapter) {
      host.log("debug", `getChapterContent(#${chapter.id} ${chapter.title})`);
      // Chapter content is in the initial HTML. parseChapterContent discovers
      // the rotating per-load decoy classes from the inline <style> and filters
      // the matching <p>, then scrubs any surviving ad-string fragments.
      const resp = await host.fetch(chapter.url);
      const doc = parseHtmlDocument(resp.text);
      return parseChapterContent(doc, BASE_URL);
    },
  };
}
