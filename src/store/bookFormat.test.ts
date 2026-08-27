import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { detectBookFormat, isOpaqueUri } from "./bookFormat";

const bytes = (s: string) => new TextEncoder().encode(s);

/** Minimal spec-compliant EPUB: uncompressed `mimetype` entry first. */
async function epubBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", "<container/>");
  zip.file("OEBPS/content.opf", "<package/>");
  return zip.generateAsync({ type: "uint8array" });
}

/** EPUB that skips the `mimetype` convention — only container.xml identifies it. */
async function looseEpubBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", "<container/>");
  zip.file("OEBPS/content.opf", "<package/>");
  return zip.generateAsync({ type: "uint8array" });
}

async function docxBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", "<document/>");
  return zip.generateAsync({ type: "uint8array" });
}

describe("detectBookFormat", () => {
  it("identifies a PDF by its header", () => {
    expect(detectBookFormat(bytes("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj"))).toBe(
      "pdf",
    );
  });

  it("identifies an EPUB by its mimetype entry", async () => {
    expect(detectBookFormat(await epubBytes())).toBe("epub");
  });

  it("identifies an EPUB missing the mimetype entry via container.xml", async () => {
    expect(detectBookFormat(await looseEpubBytes())).toBe("epub");
  });

  it("identifies a DOCX by its word/document.xml entry", async () => {
    expect(detectBookFormat(await docxBytes())).toBe("docx");
  });

  it("does not mistake a DOCX for an EPUB", async () => {
    expect(detectBookFormat(await docxBytes())).not.toBe("epub");
  });

  it("reports unknown for a zip that is neither", async () => {
    const zip = new JSZip();
    zip.file("notes.txt", "hello");
    expect(detectBookFormat(await zip.generateAsync({ type: "uint8array" }))).toBe(
      "unknown",
    );
  });

  it("reports unknown for arbitrary bytes and for empty input", () => {
    expect(detectBookFormat(bytes("not a book at all"))).toBe("unknown");
    expect(detectBookFormat(new Uint8Array())).toBe("unknown");
  });
});

describe("isOpaqueUri", () => {
  it("flags the SAF URIs Android's picker returns", () => {
    expect(
      isOpaqueUri(
        "content://com.android.providers.media.documents/document/document%3A19",
      ),
    ).toBe(true);
  });

  it("leaves ordinary filesystem paths alone", () => {
    expect(isOpaqueUri("/Users/me/Downloads/book.pdf")).toBe(false);
    expect(isOpaqueUri("C:\\Users\\me\\book.docx")).toBe(false);
    expect(isOpaqueUri("book.epub")).toBe(false);
  });
});
