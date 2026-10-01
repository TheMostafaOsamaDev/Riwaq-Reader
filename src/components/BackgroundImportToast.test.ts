// Which result offers what. The card's copy and actions are decided by one
// pure function; these pin down the rules a user would notice breaking.
import { describe, expect, it, vi } from "vitest";
import { makeTr } from "../i18n";
import type { BackgroundImportResult } from "../store/backgroundImport";
import { describe as describeView } from "./BackgroundImportToast";

function helpers() {
  return {
    tr: makeTr("en"),
    num: (n: number) => String(n),
    open: vi.fn(),
    edit: vi.fn(),
    viewLibrary: vi.fn(),
    retry: vi.fn(),
  };
}

const result = (r: Partial<BackgroundImportResult>) => ({
  kind: "result" as const,
  seq: 1,
  waiting: 0,
  result: { added: [], reused: [], failed: [], opened: null, ...r },
});

const labels = (c: ReturnType<typeof describeView>) =>
  c.actions.map((a) => a.label);

describe("BackgroundImportToast — what each result offers", () => {
  it("an opened new book offers only Edit details, and goes on its own", () => {
    const c = describeView(
      result({ added: [{ id: "b", title: "Book" }], opened: "b" }),
      helpers(),
    );
    expect(c.title).toBe("Added to your library");
    expect(c.detail).toBe("Book");
    expect(labels(c)).toEqual(["Edit details"]);
    expect(c.ttl).not.toBeNull();
  });

  it("a new book the user navigated away from offers Open first", () => {
    const h = helpers();
    const c = describeView(
      result({ added: [{ id: "b", title: "Book" }], opened: null }),
      h,
    );
    expect(labels(c)).toEqual(["Open", "Edit details"]);
    c.actions[0].onClick();
    expect(h.open).toHaveBeenCalledWith("b");
  });

  it("a book already in the library has no Edit details", () => {
    const c = describeView(
      result({ reused: [{ id: "b", title: "Book" }], opened: "b" }),
      helpers(),
    );
    expect(c.title).toBe("Already in your library");
    expect(labels(c)).toEqual([]);
  });

  it("a failure stays up and retries exactly the files that failed", () => {
    const h = helpers();
    const c = describeView(
      result({
        failed: [
          { name: "a.epub", message: "x", path: "/a.epub", retryable: true },
          { name: "b.txt", message: "x", path: "/b.txt", retryable: false },
        ],
      }),
      h,
    );
    expect(c.tone).toBe("error");
    expect(c.ttl).toBeNull();
    expect(labels(c)).toEqual(["Retry"]);
    c.actions[0].onClick();
    expect(h.retry).toHaveBeenCalledWith(["/a.epub"]);
  });

  it("offers no Retry for a file that is not a book", () => {
    const c = describeView(
      result({
        failed: [
          {
            name: "notes.txt",
            message: "Unsupported file — not an EPUB, PDF or DOCX.",
            path: "/notes.txt",
            retryable: false,
          },
        ],
      }),
      helpers(),
    );
    expect(labels(c)).toEqual([]);
    expect(c.closable).toBe(true);
  });

  it("words an OS error plainly instead of showing it raw", () => {
    const c = describeView(
      result({
        failed: [
          {
            name: "a.pdf",
            message: "Permission Denial: opening provider com.x",
            path: "content://x",
            retryable: true,
          },
        ],
      }),
      helpers(),
    );
    expect(c.detail).not.toMatch(/Permission Denial/);
    expect(c.detail).toMatch(/couldn't read this file/);
  });

  it("words a known error even when its English copy is the raw text", () => {
    const c = describeView(
      result({
        failed: [
          {
            name: "a.epub",
            message: "Another import is already running",
            path: "/a.epub",
            retryable: true,
          },
        ],
      }),
      helpers(),
    );
    expect(c.detail).toBe(makeTr("en")("error.anotherImportRunning"));
  });

  it("a partial run says both halves and names the one that failed", () => {
    const c = describeView(
      result({
        added: [{ id: "a", title: "A" }],
        failed: [
          { name: "b.epub", message: "x", path: "/b.epub", retryable: true },
        ],
      }),
      helpers(),
    );
    expect(c.tone).toBe("warn");
    expect(c.title).toBe("1 added · 1 couldn't be imported");
    expect(c.detail?.startsWith("b.epub: ")).toBe(true);
  });

  it("several books point at the library rather than opening one", () => {
    const c = describeView(
      result({
        added: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
      }),
      helpers(),
    );
    expect(c.title).toBe("2 books added to your library");
    expect(labels(c)).toEqual(["View library"]);
  });

  it("a running import can be hidden but offers no action", () => {
    const c = describeView(
      {
        kind: "working",
        name: "Big Book",
        index: 1,
        total: 3,
        waiting: 2,
        hidden: false,
      },
      helpers(),
    );
    expect(c.title).toBe("Importing Big Book");
    expect(c.detail).toBe("2 of 3 · 2 more waiting");
    expect(c.closable).toBe(true);
    expect(c.actions).toEqual([]);
  });
});
