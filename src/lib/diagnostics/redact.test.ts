import { describe, expect, it } from "vitest";
import {
  hashTitle,
  redactPath,
  redactUrl,
  redactValue,
  scrubPaths,
} from "./redact";

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

  it("redacts an array of objects", () => {
    const out = redactValue([{ title: "x" }]) as Array<Record<string, unknown>>;
    expect(out[0].title).toMatch(/^t:/);
  });

  it("does not recurse forever on a cycle", () => {
    const a: Record<string, unknown> = { name: "x" };
    a.self = a;
    expect(() => redactValue(a)).not.toThrow();
  });

  it("redacts a DAG (same object referenced by two siblings) fully both times, not as a cycle", () => {
    const shared = { a: 1 };
    const out = redactValue({ x: shared, y: shared }) as Record<
      string,
      unknown
    >;
    expect(out.x).toEqual({ a: 1 });
    expect(out.y).toEqual({ a: 1 });
  });
});

// The Rust layer builds its error strings out of absolute paths —
// src-tauri/src/archive.rs has four of the shape
// `format!("cannot open {}: {e}", path.display())`. An unhandled invoke()
// rejection carrying one of those puts the user's home directory AND the
// book's real title into the session file, which buildBundle then pastes
// into a document Settings invites them to share.
describe("scrubPaths", () => {
  it("reduces the archive.rs error shape to a basename", () => {
    expect(
      scrubPaths(
        "cannot open /Users/someone/Library/Application Support/com.riwaq.reader/books/The Mad Priest.epub: No such file (os error 2)",
      ),
    ).toBe("cannot open The Mad Priest.epub: No such file (os error 2)");
  });

  it("reduces the mkdir shape, whose path ends at a directory", () => {
    expect(
      scrubPaths("mkdir /Users/someone/Library/Application Support: denied"),
    ).toBe("mkdir Application Support: denied");
  });

  it("covers the Android and Linux roots too", () => {
    expect(scrubPaths("cannot open /data/user/0/com.riwaq.reader/x.epub")).toBe(
      "cannot open x.epub",
    );
    expect(scrubPaths("cannot open /storage/emulated/0/Books/x.epub")).toBe(
      "cannot open x.epub",
    );
    expect(scrubPaths("cannot open /home/someone/books/x.epub")).toBe(
      "cannot open x.epub",
    );
  });

  it("reduces a Windows path", () => {
    expect(
      scrubPaths("cannot open C:\\Users\\someone\\Books\\x.epub: denied"),
    ).toBe("cannot open x.epub: denied");
  });

  // Stack frames are the reason `stack` is worth keeping at all, and in a
  // packaged build they are tauri://localhost URLs carrying no user data.
  // Truncating them to a basename would throw away the line and column.
  it("leaves a stack frame URL alone", () => {
    const frame = "at load (tauri://localhost/assets/index-abc.js:1:234)";
    expect(scrubPaths(frame)).toBe(frame);
  });

  it("leaves a URL that happens to contain a scrubbable root alone", () => {
    const url = "https://example.com/data/chapter/12";
    expect(scrubPaths(url)).toBe(url);
  });

  it("leaves a message with no path alone", () => {
    expect(scrubPaths("not a readable zip: invalid header")).toBe(
      "not a readable zip: invalid header",
    );
    expect(scrubPaths("")).toBe("");
  });

  it("leaves a relative path alone — it identifies nobody", () => {
    expect(scrubPaths("write failed: books/x.epub")).toBe(
      "write failed: books/x.epub",
    );
  });
});

describe("redactValue — diagnostic message fields", () => {
  it("scrubs paths out of an error message", () => {
    const out = redactValue({
      message: "cannot open /Users/someone/books/Novel.epub: denied",
    }) as Record<string, string>;
    expect(out.message).toBe("cannot open Novel.epub: denied");
  });

  it("scrubs a stack while leaving its frame URLs readable", () => {
    const out = redactValue({
      stack: "Error: x\n    at q (tauri://localhost/assets/i.js:1:2)",
    }) as Record<string, string>;
    expect(out.stack).toContain("tauri://localhost/assets/i.js:1:2");
  });

  it("scrubs a React componentStack", () => {
    const out = redactValue({
      componentStack: "    in Boom (/Users/someone/src/App.tsx:1)",
    }) as Record<string, string>;
    expect(out.componentStack).not.toContain("someone");
  });
});
