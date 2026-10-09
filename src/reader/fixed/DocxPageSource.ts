// DOCX-backed FixedPageSource: paginates the sanitized HTML into fixed page
// cards. The document is flowed at a fixed page content-width in an offscreen
// measuring container; top-level blocks are greedily packed into pages at block
// boundaries (no mid-line cuts), heading anchors are mapped to page numbers for
// the outline, and each page renders as a white card scaled to fit the viewport.
// Text stays real HTML — selectable + searchable, and Arabic shapes natively.

import { BaseDirectory, readTextFile } from "@tauri-apps/plugin-fs";
import {
  bookDir,
  chapterImageSrcFor,
  type DocxBook,
  type Highlight,
} from "../../store/library";
import { FONT_STACKS, type ThemeKey } from "../../styles/tokens";
import type { TocEntry } from "../../types/reader";
import type { FixedPageSource } from "./FixedPageSource";
import { applyHighlightsToBlock, type BlockMark } from "./docxHighlight";
import { paintDocxNoteSpines, type SpineTarget } from "./docxNoteSpines";

const BASE = BaseDirectory.AppData;

// Fixed page geometry (intrinsic CSS px). The viewer scales the whole card to
// fit the viewport, so pagination stays stable regardless of zoom/fit.
const PAGE_W = 760;
const PAGE_H = Math.round(PAGE_W * 1.414); // A-series ratio ≈ 1075
const MARGIN = 56;
const CW = PAGE_W - MARGIN * 2;
const CH = PAGE_H - MARGIN * 2;
const DEFAULT_FONT = FONT_STACKS.serif;
const DEFAULT_FONT_SIZE = 17;
const LINE_HEIGHT = 1.7;

/** Reading typography for a DOCX page. The text is real HTML, so the page
 *  honours the same font settings the reflowable reader does — a PDF page is
 *  a bitmap and cannot. Changing either re-paginates, which is safe because
 *  a reading position is anchored to a block, not to a page number. */
export interface DocxTypography {
  fontFamily?: string;
  fontSize?: number;
}

interface DocxParts {
  /** Reading typography; defaults to the serif face at 17px. */
  typography?: DocxTypography;
  /** Body HTML with `<img>` srcs already resolved to loadable
   *  asset:// URLs. */
  html: string;
  dir: "ltr" | "rtl";
  outline: { title: string; level: number; anchorId: string }[];
}

const IMG_CONSTRAIN = (img: HTMLImageElement) => {
  img.style.maxWidth = "100%";
  img.style.maxHeight = `${CH}px`;
  img.style.height = "auto";
};

/** Core paginator — runs in any browser (no Tauri), which is what keeps it
 *  testable. Used by the app via createDocxPageSource. */
export async function createDocxPageSourceFromParts(
  parts: DocxParts,
): Promise<FixedPageSource> {
  const FONT = parts.typography?.fontFamily || DEFAULT_FONT;
  const FONT_SIZE = parts.typography?.fontSize || DEFAULT_FONT_SIZE;
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
    if (document.fonts?.ready)
      await Promise.race([document.fonts.ready, delay(2000)]);
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
  // Every id in the document → its page, for in-document links: a Word
  // contents page links to bookmarks (`#_Toc…`), not only to headings.
  const idPage: Record<string, number> = {};
  // Stable block id → page. Ids are assigned here (before cloning) so a
  // highlight anchored to a block survives re-pagination when the page box
  // changes — it just resolves to a different page.
  const blockPage: Record<string, number> = {};
  let curH = 0;
  blocks.forEach((blk, blockIndex) => {
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
    const blockId = `b${blockIndex}`;
    blk.setAttribute("data-block-id", blockId);
    blockPage[blockId] = pageIdx;
    if (blk.id && blk.id.startsWith("docx-h-")) headingPage[blk.id] = pageIdx;
    blk.querySelectorAll("[id^='docx-h-']").forEach((el) => {
      headingPage[el.id] = pageIdx;
    });
    if (blk.id) idPage[blk.id] ??= pageIdx;
    blk.querySelectorAll("[id]").forEach((el) => {
      idPage[el.id] ??= pageIdx;
    });
    pages[pageIdx].push(blk.cloneNode(true));
    curH += h;
  });
  document.body.removeChild(meas);

  // page -> its topmost block, built once from the same walk that assigned
  // the ids. `blocks.forEach` above visits in document order, so the first
  // write for a page wins and later blocks on it do not overwrite it.
  const firstBlockByPage = new Map<number, string>();
  for (const [blockId, page] of Object.entries(blockPage)) {
    if (!firstBlockByPage.has(page)) firstBlockByPage.set(page, blockId);
  }

  const outline: TocEntry[] = parts.outline.map((o) => ({
    title: o.title,
    level: o.level,
    dest: { fmt: "page", page: headingPage[o.anchorId] ?? 0 },
  }));

  // Current highlights + theme, pushed in by the viewer via setHighlights. Read
  // fresh on every renderPage so a newly-created highlight shows on re-render.
  let curHighlights: Highlight[] = [];
  let curThemeKey: ThemeKey = "light";
  /** Built page cards, kept so a page is built once and then MOVED between
   *  hosts — the way PdfPageSource re-parents a drawn canvas. Building a card
   *  is cloning the page's blocks and weaving its highlights in, and a single
   *  turn used to do it twice (the sliding overlay, then the settled page)
   *  plus four more for the neighbours being warmed, none of which were ever
   *  reused. Scale is only a transform on the card, so one card serves every
   *  zoom. Cleared whenever the highlights change, since they are woven in.
   *
   *  Each card owns its note bars' observer: a single shared one, as before,
   *  was dropped by whichever page was built last — a warmed neighbour took
   *  the visible page's bars down with it. */
  const cards = new Map<number, { card: HTMLElement; cancel?: () => void }>();
  const MAX_CARDS = 10;
  // Note-bar observers of cards forgotten while still on screen. They keep
  // working until the card leaves its host, and are cancelled then.
  const orphans = new Map<HTMLElement, () => void>();
  const dropCard = (i: number) => {
    const entry = cards.get(i);
    if (!entry) return;
    cards.delete(i);
    // A card still on screen keeps its bars until it is replaced.
    if (!entry.card.isConnected) entry.cancel?.();
    else if (entry.cancel) orphans.set(entry.card, entry.cancel);
  };
  /** Cancel the observer of whatever a host held before it is refilled. */
  const releaseOutgoing = (host: HTMLElement, incoming: HTMLElement) => {
    for (const child of Array.from(host.children)) {
      if (child === incoming) continue;
      const cancel = orphans.get(child as HTMLElement);
      if (cancel) {
        cancel();
        orphans.delete(child as HTMLElement);
      }
    }
  };
  const clearCards = () => {
    for (const entry of cards.values()) entry.cancel?.();
    cards.clear();
    for (const cancel of orphans.values()) cancel();
    orphans.clear();
  };

  return {
    kind: "docx",
    pageCount: pages.length,
    outline,
    hasTextLayer: true,
    pageForBlock(blockId) {
      return blockPage[blockId];
    },
    pageForAnchor(id) {
      return idPage[id] ?? headingPage[id];
    },
    blockForPage(page) {
      // Blocks are numbered in document order and packed into pages in that
      // order, so the first id that maps to this page is the topmost block on
      // it. Scanning beats keeping a second index: this runs once per saved
      // position, not per frame.
      return firstBlockByPage.get(page);
    },
    setHighlights(hs, themeKey) {
      curHighlights = hs;
      curThemeKey = themeKey;
      clearCards();
    },
    async pageSize() {
      return { w: PAGE_W, h: PAGE_H };
    },
    async renderPage(i, host, scale) {
      host.style.overflow = "hidden";
      const originX = parts.dir === "rtl" ? "right" : "left";
      const cached = cards.get(i);
      if (cached) {
        cached.card.style.transform = `scale(${scale})`;
        cached.card.style.transformOrigin = `top ${originX}`;
        if (cached.card.parentElement !== host) {
          releaseOutgoing(host, cached.card);
          host.replaceChildren(cached.card);
        }
        // Refresh LRU order.
        cards.delete(i);
        cards.set(i, cached);
        return;
      }
      const card = document.createElement("div");
      card.setAttribute("dir", parts.dir);
      // RTL blocks narrower/wider than the host anchor to the inline-start (right)
      // edge, so the scale origin must match that edge — otherwise the scaled card
      // overflows the host's clip box on the start side. LTR anchors left
      // (`originX`, above).
      // Colors read from CSS vars set on the viewer (see FixedPageViewer), so
      // the "Page color" / "Text color" reading settings restyle the cards live
      // — no re-pagination. Fallbacks preserve the original white page + near-
      // black text when no override / theme is in effect.
      card.style.cssText =
        `width:${PAGE_W}px; height:${PAGE_H}px; box-sizing:border-box; padding:${MARGIN}px; ` +
        `background:var(--reading-paper, #ffffff); color:var(--reading-ink, #1b1b1b); overflow:hidden; ` +
        `font-family:${FONT}; font-size:${FONT_SIZE}px; line-height:${LINE_HEIGHT}; ` +
        // The app shell is unselectable (global.css); the page's text opts in
        // — unless the viewer says otherwise: the phone draws its own
        // selection, and a native one raises the system toolbar.
        `-webkit-user-select:var(--fixed-select, text); user-select:var(--fixed-select, text); ` +
        `transform: scale(${scale}); transform-origin: top ${originX};`;
      for (const n of pages[i] || []) card.appendChild(n.cloneNode(true));
      card.querySelectorAll("img").forEach(IMG_CONSTRAIN);
      // Inject highlight <mark>s for any block on this page (before attaching,
      // so the mutation isn't visible mid-render).
      const noted: SpineTarget[] = [];
      if (curHighlights.length > 0) {
        card
          .querySelectorAll<HTMLElement>("[data-block-id]")
          .forEach((blockEl) => {
            const blockId = blockEl.getAttribute("data-block-id");
            if (!blockId) return;
            const marks: BlockMark[] = [];
            for (const hl of curHighlights) {
              if (hl.fixed?.fmt === "docx" && hl.fixed.blockId === blockId) {
                marks.push({
                  id: hl.id,
                  charStart: hl.fixed.charStart,
                  charEnd: hl.fixed.charEnd,
                  color: hl.color,
                });
                if (hl.note?.trim()) {
                  noted.push({ id: hl.id, color: hl.color });
                  // Containing block for the note bar, set by the builder
                  // that owns this block's styling rather than patched on
                  // from the painter afterwards.
                  blockEl.style.position = "relative";
                }
              }
            }
            if (marks.length)
              applyHighlightsToBlock(blockEl, marks, curThemeKey);
          });
      }
      releaseOutgoing(host, card);
      host.replaceChildren(card);
      // Note bars come AFTER attaching: a bar's position can only be
      // measured once the card is in the document and its marks are
      // laid out.
      const cancel =
        noted.length > 0
          ? paintDocxNoteSpines(card, noted, curThemeKey)
          : undefined;
      dropCard(i);
      cards.set(i, { card, cancel });
      while (cards.size > MAX_CARDS) {
        const oldest = cards.keys().next().value;
        if (oldest === undefined) break;
        dropCard(oldest);
      }
    },
    destroy() {
      clearCards();
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
  typography?: DocxTypography,
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
    typography,
  });
}
