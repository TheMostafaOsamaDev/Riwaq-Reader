import { describe, expect, it } from "vitest";
import { novelCoverCandidates } from "./novelCoverCandidates";

// A Store novel's cover used to load from the network on every open, even
// when the novel was already in the library with cover.<ext> on disk —
// findSourceEntry returned the whole entry and the caller kept only its id.
// On a Cloudflare-fronted source that is a visible wait for a file we own.
describe("novelCoverCandidates", () => {
  const REMOTE = "https://cenele.com/wp-content/uploads/2026/01/cover.jpg";
  const LOCAL = "asset://localhost/books/abc/cover.jpg?v=1";

  it("loads the local file first when the novel is in the library", () => {
    const [first] = novelCoverCandidates({
      local: LOCAL,
      remote: REMOTE,
      height: 600,
    });
    expect(first).toBe(LOCAL);
  });

  it("still keeps the remote URLs behind a local file, in case it is missing", () => {
    // The index can name a coverFile whose bytes are gone (a half-finished
    // delete, a restored backup). Falling through to the network beats
    // showing "no cover" for a novel whose art we can still fetch.
    const candidates = novelCoverCandidates({
      local: LOCAL,
      remote: REMOTE,
      height: 600,
    });
    expect(candidates).toEqual([LOCAL, expect.stringContaining("450x600"), REMOTE]);
  });

  it("uses the site's resized variant before its original when not in the library", () => {
    expect(novelCoverCandidates({ local: null, remote: REMOTE, height: 600 }))
      .toEqual([expect.stringContaining("450x600"), REMOTE]);
  });

  it("does not repeat a URL the resizer left unchanged", () => {
    // optimizedCoverUrl returns the input for anything it can't rewrite, so a
    // naive [optimized, original] would load the same URL twice on failure.
    const opaque = "https://example.com/cover";
    expect(novelCoverCandidates({ local: null, remote: opaque, height: 600 }))
      .toEqual([opaque]);
  });

  it("has nothing to show when the novel has no cover anywhere", () => {
    expect(novelCoverCandidates({ local: null, remote: undefined, height: 600 }))
      .toEqual([]);
  });

  it("skips the network entirely for a local cover with no remote URL", () => {
    // A novel saved offline whose source page is gone.
    expect(novelCoverCandidates({ local: LOCAL, remote: undefined, height: 600 }))
      .toEqual([LOCAL]);
  });
});
