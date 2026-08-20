// DOCX-backed FixedPageSource: paginates the sanitized HTML into fixed page
// cards. The document is flowed at a fixed page content-width in an offscreen
// measuring container; top-level blocks are greedily packed into pages at block
// boundaries (no mid-line cuts), heading anchors are mapped to page numbers for
// the outline, and each page renders as a white card scaled to fit the viewport.
// Text stays real HTML — selectable + searchable, and Arabic shapes natively.

import { BaseDirectory, readTextFile } from "@tauri-apps/plugin-fs";
import { bookDir, chapterImageSrcFor, type DocxBook } from "../../store/library";
import { FONT_STACKS } from "../../styles/tokens";
import type { TocEntry } from "../../types/reader";
import type { FixedPageSource } from "./FixedPageSource";

const BASE = BaseDirectory.AppData;

// Fixed page geometry (intrinsic CSS px). The viewer scales the whole card to
// fit the viewport, so pagination stays stable regardless of zoom/fit.
const PAGE_W = 760;
const PAGE_H = Math.round(PAGE_W * 1.414); // A-series ratio ≈ 1075
const MARGIN = 56;
const CW = PAGE_W - MARGIN * 2;
const CH = PAGE_H - MARGIN * 2;
const FONT = FONT_STACKS.serif;
const FONT_SIZE = 17;
const LINE_HEIGHT = 1.7;

interface DocxParts {
  /** Body HTML with `<img>` srcs already resolved to loadable URLs
   *  (asset:// in the app, blob: in the dev harness). */
  html: string;
  dir: "ltr" | "rtl";
  outline: { title: string; level: number; anchorId: string }[];
}

const IMG_CONSTRAIN = (img: HTMLImageElement) => {
  img.style.maxWidth = "100%";
  img.style.maxHeight = `${CH}px`;
  img.style.height = "auto";
};

/** Core paginator — runs in any browser (no Tauri). Used by the app (via
 *  createDocxPageSource) and directly by the dev harness. */
export async function createDocxPageSourceFromParts(
  parts: DocxParts,
): Promise<FixedPageSource> {
  const parsed = new DOMParser().parseFromString(parts.html, "text/html");

  // Offscreen measuring container, styled exactly like the render card so
  // measured heights match what the reader will show.
  const meas = document.createElement("div");
  meas.setAttribute("dir", parts.dir);
  meas.style.cssText =
    `position:fixed; left:-100000px; top:0; width:${CW}px; visibility:hidden; ` +
    `font-family:${FONT}; font-size:${FONT_SIZE}px; line-height:${LINE_HEIGHT}; box-sizing:border-box;`;
  while (parsed.body.firstChild) meas.appendChild(parsed.body.firstChild);
  meas.querySelectorAll("img").forEach(IMG_CONSTRAIN);
  document.body.appendChild(meas);

  // Correct heights need the reading font + images loaded first (both bounded
  // so a slow font/broken image can't hang pagination).
  try {
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, delay(2000)]);
  } catch {
    /* fonts API unavailable — fall through */
  }
  await Promise.all(
    [...meas.querySelectorAll("img")].map((img) =>
      (img as HTMLImageElement).complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            const done = () => res();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            setTimeout(done, 3000);
          }),
    ),
  );

  // Greedy element-boundary pagination.
  const blocks = [...meas.children] as HTMLElement[];
  const pages: Node[][] = [[]];
  const headingPage: Record<string, number> = {};
  let curH = 0;
  for (const blk of blocks) {
    const rect = blk.getBoundingClientRect();
    const cs = getComputedStyle(blk);
    const h =
      rect.height +
      (parseFloat(cs.marginTop) || 0) +
      (parseFloat(cs.marginBottom) || 0);
    if (curH > 0 && curH + h > CH) {
      pages.push([]);
      curH = 0;
    }
    const pageIdx = pages.length - 1;
    if (blk.id && blk.id.startsWith("docx-h-")) headingPage[blk.id] = pageIdx;
    blk.querySelectorAll("[id^='docx-h-']").forEach((el) => {
      headingPage[el.id] = pageIdx;
    });
    pages[pageIdx].push(blk.cloneNode(true));
    curH += h;
  }
  document.body.removeChild(meas);

  const outline: TocEntry[] = parts.outline.map((o) => ({
    title: o.title,
    level: o.level,
    dest: { fmt: "page", page: headingPage[o.anchorId] ?? 0 },
  }));

  return {
    pageCount: pages.length,
    outline,
    hasTextLayer: true,
    async pageSize() {
      return { w: PAGE_W, h: PAGE_H };
    },
    async renderPage(i, host, scale) {
      host.style.overflow = "hidden";
      const card = document.createElement("div");
      card.setAttribute("dir", parts.dir);
      // RTL blocks narrower/wider than the host anchor to the inline-start (right)
      // edge, so the scale origin must match that edge — otherwise the scaled card
      // overflows the host's clip box on the start side. LTR anchors left.
      const originX = parts.dir === "rtl" ? "right" : "left";
      card.style.cssText =
        `width:${PAGE_W}px; height:${PAGE_H}px; box-sizing:border-box; padding:${MARGIN}px; ` +
        `background:#ffffff; color:#1b1b1b; overflow:hidden; ` +
        `font-family:${FONT}; font-size:${FONT_SIZE}px; line-height:${LINE_HEIGHT}; ` +
        `transform: scale(${scale}); transform-origin: top ${originX};`;
      for (const n of pages[i] || []) card.appendChild(n.cloneNode(true));
      card.querySelectorAll("img").forEach(IMG_CONSTRAIN);
      host.replaceChildren(card);
    },
    destroy() {
      /* nothing persistent to release */
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** App entry: read the stored HTML, resolve image srcs to asset:// URLs, and
 *  paginate. */
export async function createDocxPageSource(
  book: DocxBook,
): Promise<FixedPageSource> {
  const html = await readTextFile(`${bookDir(book.id)}/content.html`, {
    baseDir: BASE,
  });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  await Promise.all(
    [...parsed.querySelectorAll("img")].map(async (img) => {
      const src = img.getAttribute("src");
      if (src) img.setAttribute("src", await chapterImageSrcFor(book.id, src));
    }),
  );
  return createDocxPageSourceFromParts({
    html: parsed.body.innerHTML,
    dir: book.dir,
    outline: book.outline,
  });
}
