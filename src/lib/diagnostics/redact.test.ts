import { describe, expect, it } from "vitest";
import {
  hashTitle,
  redactId,
  redactPath,
  redactUrl,
  redactValue,
  scrubMessage,
  scrubPaths,
  scrubUrls,
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

// A streamed book's id is minted as `stream:${sourceId}:${novelUrl}` and a
// streamed chapter's as `${chapterUrl}#0`, so `id` and `chapterId` carried
// the full source URL into a document Settings invites the user to paste
// into a public issue — right beside the hashed title that was supposed to
// keep the book private. Local ids are UUIDs and must NOT be touched: they
// identify nothing off-device, and they are how one book is followed across
// a session.
describe("redactId", () => {
  it("reduces a streamed book id to its host, keeping the source prefix", () => {
    expect(
      redactId("stream:cenele:https://cenele.com/novel/al-qass-al-majnun/"),
    ).toBe("stream:cenele:cenele.com");
  });

  it("reduces a bare chapter URL id to its host", () => {
    expect(redactId("https://kolnovel.com/series/x/chapter-12#0")).toBe(
      "kolnovel.com",
    );
  });

  it("passes a local UUID through untouched", () => {
    const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(redactId(id)).toBe(id);
  });

  it("passes a non-URL prefixed id through untouched", () => {
    expect(redactId("epub:local:12")).toBe("epub:local:12");
  });
});

describe("scrubUrls", () => {
  it("reduces a source URL in free text to its host", () => {
    expect(
      scrubUrls("failed to fetch https://cenele.com/novel/al-qass/chapter-3"),
    ).toBe("failed to fetch cenele.com");
  });

  // These four are the export's most useful debugging content. Reducing a
  // frame to a host destroys the file, line and column for no privacy gain,
  // so all four must come out byte-identical.
  it.each([
    [
      "tauri:// (packaged macOS/Linux)",
      "at load (tauri://localhost/assets/index-abc.js:1:234)",
    ],
    [
      "https://tauri.localhost (packaged Android/Windows)",
      "at load (https://tauri.localhost/assets/index-abc.js:1:234)",
    ],
    [
      "http://localhost:1420 (vite dev)",
      "at load (http://localhost:1420/src/main.tsx:40:3)",
    ],
    [
      "file:// under dist",
      "at load (file:///Users/someone/app/dist/assets/index-abc.js:1:234)",
    ],
  ])("leaves a %s frame byte-identical", (_label, frame) => {
    expect(scrubUrls(frame)).toBe(frame);
    // Via the combined treatment too — the file:// frame is the one that
    // POSIX_ABS would otherwise cut down to a basename.
    expect(scrubMessage(frame)).toBe(frame);
  });

  it("leaves a message with no URL alone", () => {
    expect(scrubUrls("not a readable zip")).toBe("not a readable zip");
    expect(scrubUrls("")).toBe("");
  });

  it("reduces a source URL without disturbing a frame in the same string", () => {
    const s =
      "fetch https://cenele.com/novel/x failed\n    at q (tauri://localhost/assets/i.js:1:2)";
    expect(scrubMessage(s)).toBe(
      "fetch cenele.com failed\n    at q (tauri://localhost/assets/i.js:1:2)",
    );
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

// The three payloads a whole-branch review pulled out of the shipped code.
// Each was verbatim in an exported bundle; each is asserted here on the real
// shape its call site emits, not on a simplified stand-in.
describe("redactValue — the source-URL leak, end to end", () => {
  it("does not leak the novel URL out of a streamed session header", () => {
    // components/DesktopReader.tsx — logSessionStart({ book: {...} }).
    expect(
      redactValue({
        book: {
          id: "stream:cenele:https://cenele.com/novel/al-qass-al-majnun/",
          title: "القس المجنون",
          chapters: 120,
          lang: "ar",
        },
      }),
    ).toEqual({
      book: {
        id: "stream:cenele:cenele.com",
        title: hashTitle("القس المجنون"),
        chapters: 120,
        lang: "ar",
      },
    });
  });

  it("does not leak the chapter URL out of position:run, which fires on every chapter open", () => {
    // components/DesktopReader.tsx — logEvent("position:run", {...}).
    const out = redactValue({
      chapter: 11,
      chapterId: "https://kolnovel.com/series/x/chapter-12#0",
      reactItems: 48,
    }) as Record<string, unknown>;
    expect(out.chapterId).toBe("kolnovel.com");
    expect(out.chapter).toBe(11);
  });

  it("does not leak the novel URL out of a fetch error message", () => {
    // components/SourceStreamReader.tsx — devLog("fetch:error", {...}).
    const out = redactValue({
      idx: 3,
      message: "failed to fetch https://cenele.com/novel/al-qass/chapter-3",
    }) as Record<string, unknown>;
    expect(out.message).toBe("failed to fetch cenele.com");
  });

  it("still passes a local book id through, so events stay correlatable", () => {
    const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const out = redactValue({ book: { id, title: "x" } }) as {
      book: Record<string, unknown>;
    };
    expect(out.book.id).toBe(id);
  });
});
