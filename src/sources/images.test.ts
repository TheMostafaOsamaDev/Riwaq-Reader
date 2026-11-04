import { describe, expect, it } from "vitest";
import { optimizedCoverUrl } from "./images";

describe("optimizedCoverUrl", () => {
  it("asks a WordPress upload for its generated thumbnail", () => {
    expect(
      optimizedCoverUrl(
        "https://kolnovel.com/wp-content/uploads/2026/10/cover.png",
        300,
      ),
    ).toBe("https://kolnovel.com/wp-content/uploads/2026/10/cover-225x300.png");
  });

  it("leaves an image that is not a WordPress upload untouched", () => {
    // No thumbnail variant exists off WordPress, so a rewrite only buys a
    // doomed request — on novelbuddy's CDN, a 404 that takes seconds —
    // before every cover falls back to the URL it should have started on.
    for (const url of [
      "https://rs.novelbuddy.me/covers/shadow-slave.png",
      "https://cdn.chikari.moe/novels/14086/cover.webp",
      "https://example.com/images/cover.jpg",
    ]) {
      expect(optimizedCoverUrl(url, 300)).toBe(url);
    }
  });

  it("leaves a WordPress upload that is already a thumbnail alone", () => {
    const url =
      "https://cenele.com/wp-content/uploads/2026/08/cover-270x270.png";
    expect(optimizedCoverUrl(url, 300)).toBe(url);
  });
});
