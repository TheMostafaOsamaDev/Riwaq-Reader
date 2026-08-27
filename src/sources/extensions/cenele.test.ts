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
