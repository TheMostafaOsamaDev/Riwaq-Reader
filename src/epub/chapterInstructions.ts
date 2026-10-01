// What counts as a block-level item, and how one is read.
//
// Shared deliberately: the EPUB reader (parser.ts) and the DOCX flow
// adapter (docx/flowDoc.ts) both walk content through here, so the two
// reading modes agree on what a paragraph is. Two copies of these rules
// would drift, and a drift here moves every reading position.

const BLOCK_SELECTOR =
  "p, blockquote, h1, h2, h3, h4, h5, h6, li, figcaption, div.para";
const ITEM_SELECTOR = `${BLOCK_SELECTOR}, img`;

/** A flat document-order list of text spans + image references. The image
 *  step is deferred so a zip-read can run async without scattering awaits
 *  inside the DOM walk. */
export type ChapterInstruction =
  | {
      kind: "text";
      text: string;
      /** 1-6 when the block was a heading, absent for body text. Absent is
       *  the common case and the backward-compatible one: chapters saved
       *  before this existed simply have no level and read as paragraphs. */
      level?: number;
    }
  | { kind: "image"; src: string; alt?: string };

/** `h1`-`h6` -> 1-6; anything else -> undefined. */
function headingLevel(tagName: string): number | undefined {
  const m = /^h([1-6])$/i.exec(tagName);
  return m ? Number(m[1]) : undefined;
}

/** One instruction plus the element that produced it. The EPUB path
 *  discards `node`; the DOCX flow adapter uses it to attribute each item
 *  back to the top-level block it came from, which is the coordinate
 *  DocxPageSource paginates by. */
export interface LocatedInstruction {
  inst: ChapterInstruction;
  node: Element;
}

export function collectInstructions(
  container: Element | null | undefined,
): LocatedInstruction[] {
  // Guard carried over from parser.ts: a spine item with no body must skip,
  // not throw out of the whole import.
  if (!container) return [];
  const nodes = container.querySelectorAll(ITEM_SELECTOR);
  const seen = new Set<Element>();
  const out: LocatedInstruction[] = [];

  nodes.forEach((node) => {
    const isImg = node.tagName.toLowerCase() === "img";

    // Skip elements nested inside another matching block. Exception: a bare
    // `<p><img/></p>` wrapper passes the img through, since EPUB content
    // routinely wraps images in single-purpose paragraphs.
    let anc = node.parentElement;
    while (anc && anc !== container) {
      if (anc.matches(BLOCK_SELECTOR)) {
        const ancText = (anc.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!isImg || ancText.length > 0) return;
      }
      anc = anc.parentElement;
    }
    if (seen.has(node)) return;
    seen.add(node);

    if (isImg) {
      const src = node.getAttribute("src");
      if (!src) return;
      const alt = node.getAttribute("alt") || undefined;
      out.push({ inst: { kind: "image", src, alt }, node });
      return;
    }

    // Block element. If its only meaningful content is an inner <img> with
    // no surrounding text, emit that image directly so we don't drop it on
    // the (text.length > 0) check below.
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length === 0) {
      const innerImg = node.querySelector("img");
      if (innerImg) {
        const src = innerImg.getAttribute("src");
        if (src) {
          seen.add(innerImg);
          out.push({
            inst: {
              kind: "image",
              src,
              alt: innerImg.getAttribute("alt") || undefined,
            },
            node,
          });
        }
      }
      return;
    }
    const level = headingLevel(node.tagName);
    out.push({
      inst: level ? { kind: "text", text, level } : { kind: "text", text },
      node,
    });
  });

  return out;
}
