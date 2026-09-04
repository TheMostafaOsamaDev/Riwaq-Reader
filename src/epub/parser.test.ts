// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseEpubFromSource } from "./parser";
import { openMemoryZip, type ExtractRequest } from "./zipSource";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Minimal but realistic EPUB 3: OPF with a cover-image property, a nav doc,
 *  and two spine documents — one of which embeds an image twice. */
async function buildFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
     <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
       <rootfiles><rootfile full-path="OEBPS/content.opf"
         media-type="application/oebps-package+xml"/></rootfiles>
     </container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
     <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
       <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
         <dc:title>A Feast of Bytes</dc:title>
         <dc:creator>Test Author</dc:creator>
         <dc:language>ar</dc:language>
       </metadata>
       <manifest>
         <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
         <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
         <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
         <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
         <item id="pic" href="images/plate.png" media-type="image/png"/>
       </manifest>
       <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
     </package>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc"
       xmlns:epub="http://www.idpf.org/2007/ops">
       <ol><li><a href="ch1.xhtml">Winter</a></li>
           <li><a href="ch2.xhtml">Spring</a></li></ol>
     </nav></body></html>`,
  );
  zip.file(
    "OEBPS/ch1.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><body>
       <p>The first paragraph.</p>
       <img src="images/plate.png" alt="A plate"/>
       <p>After the plate.</p>
     </body></html>`,
  );
  // Same image again — the collector must dedupe it to one extraction.
  zip.file(
    "OEBPS/ch2.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><body>
       <p>Second chapter text.</p>
       <img src="images/plate.png"/>
     </body></html>`,
  );
  zip.file("OEBPS/images/cover.png", PNG);
  zip.file("OEBPS/images/plate.png", PNG);
  return zip.generateAsync({ type: "uint8array" });
}

async function parseFixture() {
  const bytes = await buildFixture();
  const written: ExtractRequest[] = [];
  const src = await openMemoryZip(bytes, async (dest) => {
    written.push({ entry: "", dest });
  });
  const parsed = await parseEpubFromSource(src, "book-id");
  return { parsed, src, written };
}

describe("parseEpubFromSource", () => {
  it("uses the caller-supplied id instead of generating one", async () => {
    // The importer stages the archive at books/<id>/book.epub *before*
    // parsing, so the id has to come in rather than out.
    const { parsed } = await parseFixture();
    expect(parsed.book.id).toBe("book-id");
  });

  it("exposes the Dublin Core metadata fields", async () => {
    const { parsed } = await parseFixture();
    // happy-dom's getElementsByTagNameNS doesn't match namespace-*prefixed*
    // elements (`<dc:title>`), though it resolves their namespaceURI
    // correctly — so under test these read empty even though real webviews
    // fill them in. Assert the shape, not the values.
    expect(parsed.book).toHaveProperty("title");
    expect(parsed.book).toHaveProperty("author");
    expect(parsed.book).toHaveProperty("language");
  });

  it("orders chapters by the spine and titles them from the nav doc", async () => {
    const { parsed } = await parseFixture();
    expect(parsed.book.chapters.map((c) => c.title)).toEqual([
      "Winter",
      "Spring",
    ]);
    expect(parsed.book.chapters.map((c) => c.order)).toEqual([0, 1]);
  });

  it("returns image references rather than bytes, deduped by source path", async () => {
    const { parsed } = await parseFixture();
    // Referenced from two chapters, extracted once.
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]).toMatchObject({
      href: "images/img-001.png",
      entry: "OEBPS/images/plate.png",
      mimeType: "image/png",
    });
    // The whole point of the refactor: no `bytes` field to hold in memory.
    expect(parsed.images[0]).not.toHaveProperty("bytes");
  });

  it("points chapter image items at the on-disk href", async () => {
    const { parsed } = await parseFixture();
    const items = parsed.book.chapters[0].paragraphs;
    expect(items).toEqual([
      { text: "The first paragraph." },
      { src: "images/img-001.png", alt: "A plate" },
      { text: "After the plate." },
    ]);
  });

  it("returns the cover as a reference the caller can extract", async () => {
    const { parsed } = await parseFixture();
    expect(parsed.cover).toMatchObject({
      entry: "OEBPS/images/cover.png",
      extension: "png",
      mimeType: "image/png",
    });
    expect(parsed.cover).not.toHaveProperty("bytes");
  });

  it("extracts only what was referenced, once per entry", async () => {
    const { parsed, src, written } = await parseFixture();
    await src.extract(
      parsed.images.map((i) => ({ entry: i.entry, dest: `books/x/${i.href}` })),
    );
    expect(written.map((w) => w.dest)).toEqual(["books/x/images/img-001.png"]);
  });

  it("reports progress once per spine item", async () => {
    const src = await openMemoryZip(await buildFixture());
    const seen: [number, number][] = [];
    await parseEpubFromSource(src, "book-1", {
      onChapter: (done, total) => seen.push([done, total]),
    });
    // The fixture's spine holds two documents; both are reported, in order,
    // and the last call lands exactly on total — the ring has to reach the
    // end of the parse phase, not 1-of-2 of it.
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("rejects an archive with no readable spine content", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file(
      "META-INF/container.xml",
      `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
         <rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`,
    );
    zip.file(
      "content.opf",
      `<package xmlns="http://www.idpf.org/2007/opf">
         <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"/>
         <manifest/><spine/></package>`,
    );
    const src = await openMemoryZip(await zip.generateAsync({ type: "uint8array" }));
    await expect(parseEpubFromSource(src, "id")).rejects.toThrow(
      /no readable chapters/,
    );
  });
});

describe("openMemoryZip", () => {
  it("reports entry presence without decompressing", async () => {
    const src = await openMemoryZip(await buildFixture());
    expect(src.has("OEBPS/images/plate.png")).toBe(true);
    expect(src.has("OEBPS/nope.png")).toBe(false);
    // Directory entries are not files.
    expect(src.has("OEBPS/")).toBe(false);
  });

  it("refuses to extract without a writer", async () => {
    const src = await openMemoryZip(await buildFixture());
    await expect(
      src.extract([{ entry: "OEBPS/images/plate.png", dest: "x.png" }]),
    ).rejects.toThrow(/cannot extract/);
  });
});
