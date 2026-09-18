import { beforeEach, describe, expect, it, vi } from "vitest";

/** What the native `display_name` command answers, per path. */
let resolver: (path: string) => string | null;
let calls: string[];
let fail = false;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd !== "display_name") throw new Error(`unexpected command ${cmd}`);
    if (fail) throw new Error("bridge unavailable");
    const path = args.path as string;
    calls.push(path);
    return resolver(path);
  },
}));

const { importName } = await import("./importName");

beforeEach(() => {
  calls = [];
  fail = false;
  resolver = () => null;
});

describe("importName", () => {
  it("reads the name straight off a path that has one", async () => {
    await expect(
      importName("/Users/me/Ahmed_Metwally_dalel_elmozaf_elmostagad.pdf"),
    ).resolves.toBe("Ahmed Metwally dalel elmozaf elmostagad");
  });

  it("never calls the bridge when the path already parses", async () => {
    // Desktop imports are the overwhelming majority and must not pay for an
    // IPC round trip per file — a multi-file drop would pay it per file.
    await importName("/Users/me/book.pdf");
    await importName(
      "content://com.android.externalstorage.documents/document/primary%3ADownload%2Fbook.pdf",
    );
    expect(calls).toEqual([]);
  });

  // ── The bug: the picker's Recent list hands back a provider row id ──
  // `…/document/document%3A32` has no name in it to recover. Before this,
  // the title field came up empty and the book imported as "Untitled".

  it("asks the provider when the path is an opaque row id", async () => {
    const uri =
      "content://com.android.providers.media.documents/document/document%3A32";
    resolver = () => "Ahmed_Metwally_dalel_elmozaf_elmostagad.pdf";
    await expect(importName(uri)).resolves.toBe(
      "Ahmed Metwally dalel elmozaf elmostagad",
    );
    expect(calls).toEqual([uri]);
  });

  it("sanitizes the provider's name the same way as a path", async () => {
    // The provider returns a filename, not a title — it still has an
    // extension and separators to clean up.
    resolver = () => "my-holiday-notes.epub";
    await expect(importName("content://x/document/document%3A9")).resolves.toBe(
      "my holiday notes",
    );
  });

  it("keeps an Arabic name from the provider", async () => {
    resolver = () => "صور للشخصيات التي ظهرت.pdf";
    await expect(importName("content://x/document/document%3A9")).resolves.toBe(
      "صور للشخصيات التي ظهرت",
    );
  });

  it("gives up quietly when the provider has no name", async () => {
    resolver = () => null;
    await expect(importName("content://x/document/document%3A9")).resolves.toBe(
      "",
    );
  });

  it("gives up quietly when the provider's name is itself a row id", async () => {
    resolver = () => "32";
    await expect(importName("content://x/document/document%3A9")).resolves.toBe(
      "",
    );
  });

  it("survives the bridge throwing", async () => {
    // An import must not fail over a cosmetic title. Desktop also lands here
    // for any path that somehow parses to nothing.
    fail = true;
    await expect(importName("content://x/document/document%3A9")).resolves.toBe(
      "",
    );
  });
});
