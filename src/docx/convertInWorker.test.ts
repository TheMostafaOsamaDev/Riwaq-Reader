// The worker is best-effort: mammoth ships a browser bundle and a worker has
// no `document`, so if constructing or running it fails we must still
// convert. A janky import beats a broken one.
import { describe, expect, it, vi } from "vitest";

// vi.hoisted, because vi.mock's factory is lifted above every other
// statement in the file and would otherwise close over an uninitialized const.
const { inThread } = vi.hoisted(() => ({
  inThread: vi.fn(async () => ({
    html: "<p>fallback</p>",
    images: [] as { href: string; bytes: Uint8Array }[],
    dir: "ltr" as const,
  })),
}));
vi.mock("./rawHtml", () => ({ docxToRawHtml: inThread }));

import { docxToRawHtmlInWorker } from "./convertInWorker";

describe("docxToRawHtmlInWorker", () => {
  it("converts in-thread when the platform has no Worker", async () => {
    const saved = (globalThis as { Worker?: unknown }).Worker;
    delete (globalThis as { Worker?: unknown }).Worker;
    try {
      const raw = await docxToRawHtmlInWorker(new Uint8Array([1]));
      expect(raw.html).toBe("<p>fallback</p>");
      expect(inThread).toHaveBeenCalledOnce();
    } finally {
      if (saved) (globalThis as { Worker?: unknown }).Worker = saved;
    }
  });
});
