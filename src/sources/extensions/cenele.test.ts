// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractNovelConfig, parseNovelPage } from "./cenele";

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
      "أكشن", "بالغ", "زيانشيا", "غموض", "فنون قتالية", "للكبار", "مأساة", "مظلمة", "نفسي",
      "إنتقال العالم", "الانتقال الزمني", "الانتقام", "الزراعة", "الشخصية لا ترحم", "الكيمياء", "الوقت القديم", "تطور شخصية", "خلفية عائلة غامضة", "داو", "غدر الأحباء", "من ضعيف إلى قوي",
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

  it("excludes heading boilerplate from the synopsis", () => {
    // The synopsis container holds an <h2> (title repeated) and trailing
    // <h3> (promotional copy). These must not appear in the stored description.
    const n = parse();
    expect(n.description).not.toContain("قصة رواية السعي وراء الحقيقة");
    expect(n.description).not.toContain("الكتاب الثاني في سلسلة إير جين");
    // The actual paragraph content should still be present
    expect(n.description).toContain("سجن أبدي");
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
