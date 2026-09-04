// pdf.js pulls a PDF in slices through Rust instead of us handing it the
// whole file. A 200 MB PDF used to cost ~400 MB of JS heap at import (whole
// file read, then bytes.slice() because pdf.js may detach the buffer) and
// the same again every time the book was opened.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { path: string; offset: number; length: number }[] = [];
let fail = false;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, number | string>) => {
    if (cmd !== "read_file_range") throw new Error(`unexpected command ${cmd}`);
    if (fail) throw new Error("read failed");
    calls.push({
      path: args.path as string,
      offset: args.offset as number,
      length: args.length as number,
    });
    return new Uint8Array([1, 2, 3]).buffer;
  },
}));

import { createFileRangeTransport, readFileRange } from "./rangeSource";

/** Stand-in for pdfjs.PDFDataRangeTransport — records what the transport
 *  hands back to pdf.js. */
class FakeTransport {
  ranges: [number, Uint8Array][] = [];
  aborted = false;
  requestDataRange: (begin: number, end: number) => void = () => {
    throw new Error("abstract");
  };
  constructor(
    public length: number,
    public initialData: Uint8Array,
    public progressiveDone: boolean,
  ) {}
  onDataRange(begin: number, chunk: Uint8Array) {
    this.ranges.push([begin, chunk]);
  }
  abort() {
    this.aborted = true;
  }
}

const fakePdfjs = { PDFDataRangeTransport: FakeTransport } as never;

beforeEach(() => {
  calls.length = 0;
  fail = false;
});

describe("readFileRange", () => {
  it("asks Rust for exactly the requested slice", async () => {
    const bytes = await readFileRange("leaflet/books/b1/book.pdf", 1024, 512);
    expect(calls).toEqual([
      { path: "leaflet/books/b1/book.pdf", offset: 1024, length: 512 },
    ]);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});

describe("createFileRangeTransport", () => {
  it("turns a pdf.js range request into a file read", async () => {
    const t = createFileRangeTransport(
      fakePdfjs,
      "leaflet/books/b1/book.pdf",
      9000,
      new Uint8Array([9]),
    ) as unknown as FakeTransport;
    t.requestDataRange(100, 356);
    await vi.waitFor(() => expect(t.ranges).toHaveLength(1));
    expect(calls).toEqual([
      { path: "leaflet/books/b1/book.pdf", offset: 100, length: 256 },
    ]);
    expect(t.ranges[0][0]).toBe(100);
  });

  it("aborts the document rather than hanging when a read fails", async () => {
    // pdf.js has no error channel for a range request; a rejected read that
    // never calls onDataRange would leave it waiting forever.
    fail = true;
    const t = createFileRangeTransport(
      fakePdfjs,
      "leaflet/books/b1/book.pdf",
      9000,
      new Uint8Array([9]),
    ) as unknown as FakeTransport;
    t.requestDataRange(0, 16);
    await vi.waitFor(() => expect(t.aborted).toBe(true));
  });
});
