import { describe, expect, it } from "vitest";
import { hashTitle, redactPath, redactUrl, redactValue } from "./redact";

describe("hashTitle", () => {
  it("is stable, so one book is followable across events", () => {
    expect(hashTitle("القس المجنون")).toBe(hashTitle("القس المجنون"));
  });

  it("distinguishes different titles", () => {
    expect(hashTitle("A")).not.toBe(hashTitle("B"));
  });

  it("never leaks the original text", () => {
    const title = "The Mad Priest";
    expect(hashTitle(title)).not.toContain("Mad");
    expect(hashTitle(title)).toMatch(/^t:[0-9a-f]{6}$/);
  });

  it("handles empty input", () => {
    expect(hashTitle("")).toBe("t:empty");
  });
});

describe("redactPath", () => {
  it("keeps only the basename, dropping the user's home", () => {
    expect(redactPath("/Users/someone/Library/Books/novel.epub")).toBe(
      "novel.epub",
    );
  });

  it("handles Windows separators", () => {
    expect(redactPath("C:\\Users\\someone\\book.pdf")).toBe("book.pdf");
  });

  it("passes through a bare name", () => {
    expect(redactPath("book.epub")).toBe("book.epub");
  });
});

describe("redactUrl", () => {
  it("keeps only the host", () => {
    expect(redactUrl("https://kolnovel.com/series/x/chapter-12")).toBe(
      "kolnovel.com",
    );
  });

  it("leaves a non-URL alone rather than inventing a host", () => {
    expect(redactUrl("not a url")).toBe("<url>");
  });
});

describe("redactValue", () => {
  it("redacts by key name, recursively", () => {
    const out = redactValue({
      title: "The Mad Priest",
      path: "/Users/me/b.epub",
      url: "https://cenele.com/x",
      nested: { chapterTitle: "Chapter One", count: 7 },
    }) as Record<string, unknown>;

    expect(out.title).toMatch(/^t:/);
    expect(out.path).toBe("b.epub");
    expect(out.url).toBe("cenele.com");
    expect((out.nested as Record<string, unknown>).chapterTitle).toMatch(/^t:/);
    expect((out.nested as Record<string, unknown>).count).toBe(7);
  });

  it("leaves primitives and arrays of primitives intact", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue([1, 2, 3])).toEqual([1, 2, 3]);
    expect(redactValue(null)).toBe(null);
  });

  it("does not recurse forever on a cycle", () => {
    const a: Record<string, unknown> = { name: "x" };
    a.self = a;
    expect(() => redactValue(a)).not.toThrow();
  });
});
