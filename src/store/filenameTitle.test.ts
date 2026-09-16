import { describe, expect, it } from "vitest";
import { filenameTitle } from "./library";

describe("filenameTitle", () => {
  it("drops the extension and reads underscores as spaces", () => {
    expect(
      filenameTitle("/Users/me/Ahmed_Metwally_dalel_elmozaf_elmostagad.pdf"),
    ).toBe("Ahmed Metwally dalel elmozaf elmostagad");
  });

  it("handles Windows separators", () => {
    expect(filenameTitle("C:\\Books\\my-book.epub")).toBe("my book");
  });

  it("keeps a name that has no extension", () => {
    expect(filenameTitle("/tmp/README")).toBe("README");
  });

  it("only strips a real extension, not a dotted title", () => {
    // "Vol. 2" is part of the name; ".2" is not a file extension.
    expect(filenameTitle("/b/The Long War Vol. 2.epub")).toBe(
      "The Long War Vol. 2",
    );
  });

  it("strips extensions other than the three the app parses", () => {
    // Format is sniffed from bytes, so the extension can be anything or lie.
    expect(filenameTitle("/b/notes.PDF")).toBe("notes");
    expect(filenameTitle("/b/book.epub3")).toBe("book");
  });

  // Android hands back Storage Access Framework URIs. Some carry the real
  // path, percent-encoded; others are an opaque provider id.
  it("recovers the name from a percent-encoded SAF path", () => {
    expect(
      filenameTitle(
        "content://com.android.externalstorage.documents/document/primary%3ADownload%2FAhmed_Metwally.pdf",
      ),
    ).toBe("Ahmed Metwally");
  });

  it("recovers a name with encoded spaces", () => {
    expect(
      filenameTitle(
        "content://com.android.providers.downloads.documents/document/raw%3A%2Fstorage%2Femulated%2F0%2FDownload%2FMy%20Book.epub",
      ),
    ).toBe("My Book");
  });

  it("returns empty for an opaque provider id, so the UI can localize", () => {
    // `document%3A19` decodes to `document:19` — a row id, not a name.
    expect(
      filenameTitle(
        "content://com.android.providers.media.documents/document/document%3A19",
      ),
    ).toBe("");
  });

  it("returns empty rather than a bare number", () => {
    expect(filenameTitle("content://x/document/12345")).toBe("");
  });

  it("survives a malformed percent-encoding", () => {
    // decodeURIComponent throws on a lone %; the name is still usable.
    expect(() => filenameTitle("/b/100%_real.pdf")).not.toThrow();
    expect(filenameTitle("/b/100%_real.pdf")).toContain("real");
  });

  it("collapses whitespace and trims", () => {
    expect(filenameTitle("/b/  spaced   out__name .pdf")).toBe(
      "spaced out name",
    );
  });

  it("keeps Arabic names intact", () => {
    expect(filenameTitle("/b/دليل_الموظف_المسجد.pdf")).toBe(
      "دليل الموظف المسجد",
    );
  });
});
