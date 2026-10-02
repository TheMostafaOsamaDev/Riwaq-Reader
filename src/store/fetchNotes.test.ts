import { describe, expect, it } from "vitest";
import { fetchNotes } from "./fetchNotes";

describe("fetchNotes", () => {
  it("parses what Rust returns and keeps the image", async () => {
    const r = await fetchNotes(async (cmd, args) => {
      expect(cmd).toBe("fetch_release_notes");
      expect(args).toEqual({ version: "0.6.0" });
      return {
        notes: {
          version: "0.6.0",
          date: "d",
          items: [{ kind: "new", en: "a", ar: "ب" }],
        },
        highlightImage: "data:image/webp;base64,AA",
      };
    }, "0.6.0");
    expect(r.notes?.items).toHaveLength(1);
    expect(r.highlightImage).toMatch(/^data:image\/webp/);
  });
  it("is null — not a throw — when the release has no notes asset", async () => {
    const r = await fetchNotes(async () => {
      throw "HTTP 404";
    }, "0.6.0");
    expect(r.notes).toBeNull();
  });
  it("drops an image that is not a webp data URL", async () => {
    const r = await fetchNotes(
      async () => ({
        notes: {
          version: "0.6.0",
          date: "d",
          items: [{ kind: "new", en: "a", ar: "ب" }],
        },
        highlightImage: "https://evil.example/x.png",
      }),
      "0.6.0",
    );
    expect(r.highlightImage).toBeUndefined();
  });
});
