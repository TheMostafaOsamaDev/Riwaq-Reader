// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  extractNovelConfig,
  isChallengeResponse,
  parseNovelPage,
  searchUrl,
  parseSearchPage,
} from "./cenele";

describe("extractNovelConfig", () => {
  it("returns null when the config global is absent", () => {
    expect(
      extractNovelConfig("<html><body>no config</body></html>"),
    ).toBeNull();
  });

  it("returns null when chaptersNonce is missing", () => {
    const html = `<script>var nhvNovelV2 = {"postId":"1","nonce":"abc"};</script>`;
    expect(extractNovelConfig(html)).toBeNull();
  });
});

describe("parseNovelPage", () => {
  it("throws a page-identifying error when the config is missing", () => {
    const doc = new DOMParser().parseFromString(
      "<html><body>nope</body></html>",
      "text/html",
    );
    expect(() => parseNovelPage(doc, "https://cenele.com/cont/x/")).toThrow(
      /https:\/\/cenele\.com\/cont\/x\//,
    );
  });
});

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
  it("reports hasMore false when there is no older-posts link", () => {
    const doc = new DOMParser().parseFromString(
      `<div class="row c-tabs-item__content">
         <div class="post-title"><h3 class="h4"><a href="https://cenele.com/cont/a/">A</a></h3></div>
       </div>`,
      "text/html",
    );
    expect(parseSearchPage(doc, "q", 1).hasMore).toBe(false);
  });
});

describe("isChallengeResponse", () => {
  // Captured 2026-08-28 from GET https://cenele.com/cont/kingm-bline/ —
  // cenele put a Cloudflare managed challenge on /cont/* while leaving
  // the homepage, /?s=… search and admin-ajax.php open.
  const interstitial =
    `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>` +
    `<meta http-equiv="content-security-policy" content="script-src 'nonce-x' ` +
    `https://challenges.cloudflare.com"></head><body></body></html>`;

  it("detects the challenge from the cf-mitigated header", () => {
    expect(
      isChallengeResponse({
        status: 403,
        headers: { "cf-mitigated": "challenge", server: "cloudflare" },
        text: interstitial,
      }),
    ).toBe(true);
  });

  it("detects the interstitial body when the header is absent", () => {
    expect(
      isChallengeResponse({ status: 403, headers: {}, text: interstitial }),
    ).toBe(true);
  });

  it("does not flag an ordinary 404 from the site itself", () => {
    expect(
      isChallengeResponse({
        status: 404,
        headers: { server: "cloudflare" },
        text: "<html><title>Page not found</title></html>",
      }),
    ).toBe(false);
  });
});
