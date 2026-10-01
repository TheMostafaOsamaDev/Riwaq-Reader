// The import dialog prefills from the FILE's name, not the document's own
// metadata. These mock the parsers away — the rule under test is precedence,
// and pdf.js / mammoth have nothing to say about it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openPdfDocument, commitPdfBook, commitDocxBook, docxToFixedDoc } =
  vi.hoisted(() => ({
    openPdfDocument: vi.fn(),
    commitPdfBook: vi.fn(async (o: { title: string }) => ({
      id: "pdf-1",
      ...o,
    })),
    commitDocxBook: vi.fn(async (o: { title: string }) => ({
      id: "docx-1",
      ...o,
    })),
    docxToFixedDoc: vi.fn(),
  }));

vi.mock("../pdf/pdfjs", () => ({ openPdfDocument }));
vi.mock("./fixedImport", () => ({ commitPdfBook, commitDocxBook }));
vi.mock("./nativeStaging", () => ({ deleteStaged: vi.fn(async () => {}) }));
vi.mock("../docx/toFixedDoc", () => ({ docxToFixedDoc }));

import { stageFixedImport } from "./fixedImportStage";

/** A PdfDoc stub carrying only what staging reads. Cover thumbnails are
 *  lazy, so renderPage is never reached by these tests. */
function pdfDoc(meta: { title?: string; author?: string }) {
  return {
    pageCount: 3,
    meta: { title: meta.title ?? "", author: meta.author ?? "" },
    outline: [],
    hasTextLayer: true,
    renderPage: vi.fn(),
    destroy: vi.fn(),
  };
}

function fixedDoc(title: string) {
  return {
    html: "<p>body</p>",
    images: [] as { href: string; bytes: Uint8Array }[],
    title,
    author: "",
    dir: "ltr" as const,
    outline: [],
  };
}

const bytes = new Uint8Array([1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stageFixedImport — title prefill", () => {
  it("prefills a PDF from the filename, not the embedded title", async () => {
    openPdfDocument.mockResolvedValue(
      pdfDoc({ title: "Microsoft Word - Doc1" }),
    );
    const draft = await stageFixedImport(
      { bytes },
      "/Users/me/Ahmed_Metwally_dalel.pdf",
      "pdf",
    );
    expect(draft.title).toBe("Ahmed Metwally dalel");
  });

  it("prefills a DOCX from the filename, not the first heading", async () => {
    docxToFixedDoc.mockResolvedValue(fixedDoc("Chapter One"));
    const draft = await stageFixedImport(
      { bytes },
      "/Users/me/my-book.docx",
      "docx",
    );
    expect(draft.title).toBe("my book");
  });

  // An Android SAF "Recent" pick is a bare provider row id with no name in
  // it, so filenameTitle() yields "" and the document is all we have.
  it("falls back to the embedded title when the path carries no name", async () => {
    openPdfDocument.mockResolvedValue(pdfDoc({ title: "The Long War" }));
    const draft = await stageFixedImport(
      { bytes },
      "content://com.android.providers.media.documents/document/document%3A19",
      "pdf",
    );
    expect(draft.title).toBe("The Long War");
  });

  it("prefers the filename over a whitespace-only embedded title", async () => {
    openPdfDocument.mockResolvedValue(pdfDoc({ title: "   " }));
    const draft = await stageFixedImport(
      { bytes },
      "/Users/me/real-title.pdf",
      "pdf",
    );
    expect(draft.title).toBe("real title");
  });

  it("uses the caller's resolved name over the path when given one", async () => {
    // On Android the name costs an IPC round trip, so stagePaths resolves it
    // once and passes it down; it must outrank re-parsing the path.
    openPdfDocument.mockResolvedValue(pdfDoc({ title: "Embedded" }));
    const draft = await stageFixedImport(
      { bytes },
      "content://…/document%3A19",
      "pdf",
      undefined,
      "Resolved Name",
    );
    expect(draft.title).toBe("Resolved Name");
  });
});

describe("stageFixedImport — committed title", () => {
  it("commits a PDF under the filename when the field is cleared", async () => {
    openPdfDocument.mockResolvedValue(pdfDoc({ title: "Embedded Title" }));
    const draft = await stageFixedImport(
      { bytes },
      "/Users/me/on-disk.pdf",
      "pdf",
    );
    await draft.commit({ title: "   ", cover: { kind: "none" } });
    expect(commitPdfBook).toHaveBeenCalledWith(
      expect.objectContaining({ title: "on disk" }),
    );
  });

  it("commits a DOCX under the filename when the field is cleared", async () => {
    docxToFixedDoc.mockResolvedValue(fixedDoc("Chapter One"));
    const draft = await stageFixedImport(
      { bytes },
      "/Users/me/on-disk.docx",
      "docx",
    );
    await draft.commit({ title: "", cover: { kind: "none" } });
    expect(commitDocxBook).toHaveBeenCalledWith(
      expect.objectContaining({ title: "on disk" }),
    );
  });

  it("commits what the user typed when they typed something", async () => {
    openPdfDocument.mockResolvedValue(pdfDoc({ title: "Embedded" }));
    const draft = await stageFixedImport(
      { bytes },
      "/Users/me/on-disk.pdf",
      "pdf",
    );
    await draft.commit({ title: "  What I Typed  ", cover: { kind: "none" } });
    expect(commitPdfBook).toHaveBeenCalledWith(
      expect.objectContaining({ title: "What I Typed" }),
    );
  });
});
