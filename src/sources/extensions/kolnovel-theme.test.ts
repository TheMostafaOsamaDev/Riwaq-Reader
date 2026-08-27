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
