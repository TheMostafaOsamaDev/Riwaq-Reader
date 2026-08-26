// The fixed-layout viewer: renders a FixedPageSource's pages as either a
// virtualized continuous scroll of page-cards or one page at a time. Handles
// fit-width / fit-page + zoom, RTL page-flip, lazy per-window size measurement
// with height reservation (no layout shift), skeleton placeholders, and reports
// progress + resume location.
//
// Paged flow turns pages with a "peek": at a scroll edge the wheel first pans
// the page, then drags the incoming page in from that edge; a page only turns
// once the reader has pushed past a resistance threshold (so a stray notch
// can't flip by accident). A thin floating scrollbar fades in while scrolling.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Theme, ThemeKey } from "../../styles/tokens";
import type { Highlight } from "../../store/library";
import { resolveDocxSelection, type DocxSelectionAnchor } from "./docxHighlight";
import type {
  FixedFit,
  FixedFlow,
  FixedPageTint,
  ReaderProgress,
} from "../../types/reader";
import type { FixedPageSource } from "./FixedPageSource";
import { pdfDuotone, resolveReadingColors } from "../readingColors";

const PAD = 20;
const GAP = 18;
const MAX_W = 860; // cap page display width so wide screens stay readable + light

// Paged turn feel: TURN_PX is the overscroll (px, accumulated) needed to commit
// a turn — the "strength" that guards against accidental flips. IDLE_MS springs
// a half-finished peek back; ANIM/CANCEL are the slide timings; POST_LOCK eats
// trackpad momentum right after a turn so it doesn't immediately start another.
const TURN_PX = 200;
const IDLE_MS = 170;
const ANIM_MS = 220;
const CANCEL_MS = 190;
const POST_LOCK_MS = 340;
const TURN_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

// Touch drag feel. AXIS_LOCK is the travel before a drag commits to an axis (so
// a slightly-diagonal vertical pan isn't stolen as a page turn). On release a
// turn completes if the strip was dragged past SNAP_FRACTION of the viewport OR
// flicked faster than FLING — a quick flick shouldn't need a long drag.
const AXIS_LOCK_PX = 10;
const SNAP_FRACTION = 0.25;
const FLING_PX_MS = 0.45;
// Only the tail of a drag counts toward the fling test, so a long slow pan that
// ends in a flick still throws the page — averaging over the whole gesture
// would drown the flick. (MobileSheet's sheetSnap does the same for its own
// vertical axis; the two aren't shared because the axes and units differ.)
const VELOCITY_WINDOW_MS = 100;

/** Signed px/ms across the sample ring, measured over the most recent
 *  VELOCITY_WINDOW_MS. Returns 0 when there's nothing to measure. */
function releaseVelocity(samples: Array<{ x: number; t: number }>): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) {
    if (last.t - s.t <= VELOCITY_WINDOW_MS) {
      first = s;
      break;
    }
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

export function tintFilter(tint: FixedPageTint): string {
  switch (tint) {
    case "dim":
      return "brightness(0.9) contrast(1.02)";
    case "invert":
      return "invert(1) hue-rotate(180deg)";
    default:
      return "none";
  }
}

export interface FixedPageViewerProps {
  source: FixedPageSource;
  flow: FixedFlow;
  fit: FixedFit;
  /** Multiplier on the fit scale (0.5–~2.5). */
  zoom: number;
  tint: FixedPageTint;
  /** Reading color overrides ("auto" or a hex). DOCX cards take them as real
   *  CSS via `--reading-ink`/`--reading-paper`; PDF pages get a GPU duotone. */
  inkColor: string;
  paperColor: string;
  dir: "ltr" | "rtl";
  /** Which way a page turn travels. Mobile turns sideways to match the swipe
   *  that drives it; desktop turns vertically to match the wheel. */
  turnAxis: "x" | "y";
  theme: Theme;
  resume?: { page: number; pageOffset?: number };
  onProgress?: (p: ReaderProgress) => void;
  onLocationChange?: (page: number, pageOffset: number) => void;
  /** Localized page-counter label, e.g. "٧ / ٢٩٨". */
  formatCounter?: (page1: number, total: number) => string;
  reducedMotion?: boolean;
  /** This book's highlights (for DOCX render-back) + the active theme key. */
  highlights: Highlight[];
  themeKey: ThemeKey;
  /** DOCX text selected (or null to dismiss) — the shell shows a color popover. */
  onSelect: (anchor: DocxSelectionAnchor | null) => void;
  /** An existing highlight `<mark>` was clicked — the shell shows edit/delete. */
  onHighlightClick: (id: string, rect: DOMRect) => void;
}

export interface FixedPageViewerHandle {
  goToPage(i: number): void;
}

let shimmerInjected = false;
function ensureShimmerStyle() {
  if (shimmerInjected || typeof document === "undefined") return;
  shimmerInjected = true;
  const el = document.createElement("style");
  el.textContent =
    "@keyframes fx-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}";
  document.head.appendChild(el);
}

export const FixedPageViewer = forwardRef<
  FixedPageViewerHandle,
  FixedPageViewerProps
>(function FixedPageViewer(props, ref) {
  const {
    source,
    flow,
    fit,
    zoom,
    tint,
    inkColor,
    paperColor,
    dir,
    turnAxis: axis,
    theme,
    resume,
    onProgress,
    onLocationChange,
    formatCounter,
    reducedMotion,
    highlights,
    themeKey,
    onSelect,
    onHighlightClick,
  } = props;
  const pageCount = source.pageCount;

  // Bumped whenever DOCX highlights/theme change to force a re-render of the
  // visible pages (renderPage re-injects the <mark> spans from the source).
  const [highlightNonce, setHighlightNonce] = useState(0);
  useEffect(() => {
    if (source.kind !== "docx" || !source.setHighlights) return;
    source.setHighlights(highlights, themeKey);
    // Force the visible pages to re-render so renderPage re-injects the marks.
    // The per-page render cache is keyed only on scale, which hasn't changed, so
    // without clearing it the render effect would skip these pages. `rendered`
    // is untouched, so no skeleton flashes.
    renderedScale.current.clear();
    setHighlightNonce((n) => n + 1);
  }, [source, highlights, themeKey]);

  // DOCX text selection → color popover; clicking an existing <mark> → its
  // edit/delete popover. Deferred a tick so the browser finalizes the selection.
  useEffect(() => {
    if (source.kind !== "docx") return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onUp = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      window.setTimeout(() => {
        const anchor = resolveDocxSelection(scroller);
        if (anchor) {
          onSelect(anchor);
          return;
        }
        onSelect(null);
        const mark = target?.closest?.("[data-h-id]") as HTMLElement | null;
        const id = mark?.getAttribute("data-h-id");
        if (id) onHighlightClick(id, mark!.getBoundingClientRect());
      }, 0);
    };
    scroller.addEventListener("pointerup", onUp);
    return () => scroller.removeEventListener("pointerup", onUp);
  }, [source, onSelect, onHighlightClick]);

  // Reading colors, split by backend. PDF: a GPU duotone (or null → untouched,
  // today's behavior), which supersedes the dim/invert tint filter. DOCX:
  // resolved concrete colors handed to the cards through CSS vars, so "auto"
  // makes DOCX follow the active theme instead of always rendering white.
  const duotone = source.kind === "pdf" ? pdfDuotone(inkColor, paperColor) : null;
  const hostFilter = duotone ? duotone.hostFilter : tintFilter(tint);
  const docxColors =
    source.kind === "docx" ? resolveReadingColors(theme, inkColor, paperColor) : null;

  // The ink + paper blend layers for a single PDF page, positioned by `box`.
  // A plain element factory (not a component) so it never remounts the hosts.
  const duotoneOverlays = (
    keyPrefix: string,
    box: React.CSSProperties,
  ): React.ReactElement[] => {
    if (!duotone) return [];
    return [
      { key: `${keyPrefix}-ink`, layer: duotone.ink },
      { key: `${keyPrefix}-paper`, layer: duotone.paper },
    ].map(({ key, layer }) => (
      <div
        key={key}
        aria-hidden
        style={{
          ...box,
          borderRadius: 4,
          background: layer.color,
          mixBlendMode: layer.blend as React.CSSProperties["mixBlendMode"],
          pointerEvents: "none",
        }}
      />
    ));
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const hostRefs = useRef(new Map<number, HTMLDivElement>());
  const refCbs = useRef(new Map<number, (el: HTMLDivElement | null) => void>());
  const renderedScale = useRef(new Map<number, number>());
  const resumedRef = useRef(false);
  const lastEmitted = useRef(-1);
  const saveTimer = useRef<number | null>(null);

  const [sizes, setSizes] = useState<Array<{ w: number; h: number } | undefined>>(
    () => new Array(pageCount).fill(undefined),
  );
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [current, setCurrent] = useState(resume?.page ?? 0);
  const [win, setWin] = useState({ start: 0, end: Math.min(pageCount - 1, 2) });
  const [rendered, setRendered] = useState<Set<number>>(() => new Set());

  // Paged turn state. `peek` mounts the incoming page as an overlay and its
  // `reveal` (0→1) slides it in from the edge; `peekIdx` is the page shown in
  // that overlay (stable across reveal, so the pdf only renders once per turn);
  // `peekReady` flips true when that page has painted.
  const [peek, setPeek] = useState<{ dir: 1 | -1; reveal: number } | null>(null);
  const [peekAnimating, setPeekAnimating] = useState(false);
  const [peekIdx, setPeekIdx] = useState<number | null>(null);
  const [peekReady, setPeekReady] = useState(false);
  // True from the moment the base layer swaps to the incoming page until the
  // overlay is dropped. While it's set the base must sit untransformed (it is
  // already showing the new page), otherwise it would slide a second time.
  const [swapped, setSwapped] = useState(false);

  // Where the swapped-in page lands (top normally; bottom when turning back).
  const pendingScroll = useRef<null | "top" | "bottom">(null);
  const turnLockUntil = useRef(0); // momentum guard after a turn
  const accum = useRef(0); // overscroll accumulated toward the current turn
  const peekDir = useRef<0 | 1 | -1>(0);
  const peekNeighbor = useRef(0); // index in the overlay (ref mirror of peekIdx)
  const peekHold = useRef<number | null>(null); // keep overlay until base paints
  const turning = useRef(false); // commit slide in flight
  const idleTimer = useRef<number | null>(null);
  const turnTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const peekRaf = useRef(0);
  // Live touch-drag origin + the axis it locked onto ("" until it commits).
  // `samples` is a short ring of recent positions — a flick is judged on the
  // last few milliseconds, not on the whole gesture (see releaseVelocity).
  const touch = useRef({
    x: 0,
    y: 0,
    t: 0,
    axis: "" as "" | "x" | "y",
    samples: [] as Array<{ x: number; t: number }>,
  });
  // Set while a drag is turning pages, so the trailing click doesn't turn again.
  const suppressClick = useRef(false);
  // How far the current page overflows the viewport horizontally, in px.
  // Derived from LAYOUT, never from `scrollWidth - clientWidth`: a turn
  // translates the base layer, and a transformed child counts toward its
  // scroll container's scrollable overflow — so mid-turn the scroller reports
  // a page-wide overflow and the drag gets mistaken for panning a zoomed page.
  const overflowX = useRef(0);
  const peekHostRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const barIdle = useRef<number | null>(null);

  // Live mirrors the subscribe-once wheel listener reads without re-subscribing.
  const currentRef = useRef(current);
  currentRef.current = current;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  useEffect(() => ensureShimmerStyle(), []);

  // Measure the container.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainer({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // "Fit width" means exactly that: the page spans the viewport edge to edge,
  // with no side gutter. Only "fit page" keeps the horizontal inset, where the
  // page is height-bound anyway and the breathing room reads as a margin.
  // MAX_W still caps very wide windows so a desktop page stays readable — on a
  // phone the container is far narrower than the cap, so it never binds.
  const padX = fit === "width" ? 0 : PAD;
  const contentW = Math.max(0, container.w - padX * 2);
  const usableW = Math.min(contentW, MAX_W);
  const fallbackRatio = useMemo(() => {
    const m = sizes.find(Boolean);
    return m ? m.h / m.w : 1.414;
  }, [sizes]);

  // Per-page display width/height + top offsets. Unmeasured pages use the
  // fallback aspect ratio so the scroll height is reserved (refines lazily).
  const layout = useMemo(() => {
    const displayW = new Array<number>(pageCount);
    const displayH = new Array<number>(pageCount);
    const top = new Array<number>(pageCount);
    let y = PAD;
    for (let i = 0; i < pageCount; i++) {
      const s = sizes[i];
      let w: number;
      let h: number;
      if (fit === "page" && container.h > 0) {
        const iw = s?.w ?? Math.max(1, usableW);
        const ih = s?.h ?? iw * fallbackRatio;
        const sc = Math.min(usableW / iw, (container.h - PAD * 2) / ih) * zoom;
        w = iw * sc;
        h = ih * sc;
      } else {
        w = usableW * zoom;
        const ratio = s ? s.h / s.w : fallbackRatio;
        h = w * ratio;
      }
      displayW[i] = w;
      displayH[i] = h;
      top[i] = y;
      y += h + GAP;
    }
    return { displayW, displayH, top, totalH: y - GAP + PAD };
  }, [sizes, container.h, zoom, fit, usableW, fallbackRatio, pageCount]);

  const emit = useCallback(
    (page: number) => {
      if (page === lastEmitted.current) return;
      lastEmitted.current = page;
      onProgress?.({
        page,
        fraction: pageCount > 0 ? (page + 1) / pageCount : 0,
        label: formatCounter
          ? formatCounter(page + 1, pageCount)
          : `${page + 1} / ${pageCount}`,
      });
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        const el = scrollRef.current;
        let off = 0;
        if (el && flow === "scroll") {
          off = Math.max(
            0,
            Math.min(1, (el.scrollTop - layout.top[page]) / (layout.displayH[page] || 1)),
          );
        }
        onLocationChange?.(page, off);
      }, 500);
    },
    [onProgress, onLocationChange, formatCounter, pageCount, flow, layout],
  );

  // Recompute the render window + current page from scroll position.
  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el || flow !== "scroll") return;
    const st = el.scrollTop;
    const ch = el.clientHeight;
    const lo = st - ch;
    const hi = st + ch * 2;
    let start = pageCount;
    let end = -1;
    let cur = 0;
    let bestD = Infinity;
    const mid = st + ch * 0.35;
    for (let i = 0; i < pageCount; i++) {
      const t = layout.top[i];
      const b = t + layout.displayH[i];
      if (b >= lo && t <= hi) {
        if (i < start) start = i;
        if (i > end) end = i;
      }
      const d = Math.abs(t - mid);
      if (d < bestD) {
        bestD = d;
        cur = i;
      }
    }
    if (end < 0) {
      start = 0;
      end = Math.min(pageCount - 1, 2);
    }
    setWin((w) => (w.start === start && w.end === end ? w : { start, end }));
    setCurrent((c) => (c === cur ? c : cur));
    emit(cur);
  }, [flow, pageCount, layout, emit]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || flow !== "scroll") return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        recompute();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [flow, recompute]);

  useEffect(() => {
    recompute();
  }, [recompute, container.w, container.h]);

  // Resume once the container has a real size — scroll to the (estimated) offset
  // of the resume page; lazy measurement refines it as pages come into view.
  useEffect(() => {
    if (resumedRef.current || !resume || container.h === 0 || flow !== "scroll") {
      return;
    }
    resumedRef.current = true;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop =
        layout.top[resume.page] +
        (resume.pageOffset ?? 0) * layout.displayH[resume.page];
    }
    emit(resume.page);
  }, [resume, container.h, layout, flow, emit]);

  // Lazily measure + render the visible window (scroll).
  useEffect(() => {
    if (flow !== "scroll") return;
    let cancelled = false;
    (async () => {
      const measured: Array<[number, { w: number; h: number }]> = [];
      for (let i = win.start; i <= win.end; i++) {
        const host = hostRefs.current.get(i);
        if (!host) continue;
        let s = sizes[i];
        if (!s) {
          try {
            s = await source.pageSize(i);
          } catch {
            s = { w: 800, h: 1132 };
          }
          if (cancelled) return;
          measured.push([i, s]);
        }
        const sc = layout.displayW[i] / s.w;
        const want = Math.round(sc * 1000) / 1000;
        if (renderedScale.current.get(i) !== want) {
          renderedScale.current.set(i, want);
          const pi = i;
          void source.renderPage(pi, host, sc).then(() => {
            setRendered((prev) => (prev.has(pi) ? prev : new Set(prev).add(pi)));
          });
        }
      }
      if (!cancelled && measured.length) {
        setSizes((prev) => {
          const next = prev.slice();
          for (const [i, s] of measured) if (!next[i]) next[i] = s;
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [win, layout, sizes, tint, flow, source, highlightNonce]);

  // Lazily measure + render the single current page (paged).
  useEffect(() => {
    if (flow !== "paged") return;
    let cancelled = false;
    (async () => {
      const host = hostRefs.current.get(current);
      if (!host) return;
      let s = sizes[current];
      if (!s) {
        try {
          s = await source.pageSize(current);
        } catch {
          s = { w: 800, h: 1132 };
        }
        if (cancelled) return;
        setSizes((prev) => {
          if (prev[current]) return prev;
          const next = prev.slice();
          next[current] = s!;
          return next;
        });
      }
      const sc = layout.displayW[current] / s.w;
      const cur = current;
      void source.renderPage(cur, host, sc).then(() => {
        setRendered((prev) => (prev.has(cur) ? prev : new Set(prev).add(cur)));
      });
      emit(current);
    })();
    return () => {
      cancelled = true;
    };
  }, [flow, current, layout, sizes, tint, source, emit, highlightNonce]);

  // ---- Paged turn controller ------------------------------------------------

  const clampIdx = useCallback(
    (i: number) => Math.max(0, Math.min(pageCount - 1, i)),
    [pageCount],
  );

  // Swap in the peeked page. The overlay is held (fully covering) until the base
  // layer has painted the new page, so a turn never flashes a skeleton.
  const finalize = useCallback((d: 1 | -1) => {
    if (turnTimer.current) {
      window.clearTimeout(turnTimer.current);
      turnTimer.current = null;
    }
    const neighbor = peekNeighbor.current;
    turning.current = false;
    accum.current = 0;
    peekDir.current = 0;
    turnLockUntil.current = performance.now() + POST_LOCK_MS;
    pendingScroll.current = d > 0 ? "top" : "bottom";
    peekHold.current = neighbor;
    setCurrent(neighbor);
    setSwapped(true);
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      peekHold.current = null;
      setPeek(null);
      setPeekIdx(null);
      setPeekAnimating(false);
      setSwapped(false);
    }, 500);
  }, []);

  const commit = useCallback(
    (d: 1 | -1) => {
      if (idleTimer.current) {
        window.clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      turning.current = true;
      if (reducedRef.current) {
        finalize(d);
        return;
      }
      setPeekAnimating(true);
      setPeek({ dir: d, reveal: 1 });
      if (turnTimer.current) window.clearTimeout(turnTimer.current);
      turnTimer.current = window.setTimeout(() => finalize(d), ANIM_MS);
    },
    [finalize],
  );

  const cancelPeek = useCallback(() => {
    if (idleTimer.current) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    turning.current = false;
    accum.current = 0;
    peekDir.current = 0;
    if (reducedRef.current) {
      setPeek(null);
      setPeekIdx(null);
      setPeekAnimating(false);
      return;
    }
    setPeekAnimating(true);
    setPeek((p) => (p ? { ...p, reveal: 0 } : null));
    if (turnTimer.current) window.clearTimeout(turnTimer.current);
    turnTimer.current = window.setTimeout(() => {
      turnTimer.current = null;
      setPeek(null);
      setPeekIdx(null);
      setPeekAnimating(false);
    }, CANCEL_MS);
  }, []);

  const scheduleIdle = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      idleTimer.current = null;
      if (!turning.current) cancelPeek();
    }, IDLE_MS);
  }, [cancelPeek]);

  // Push the accumulated overscroll into the overlay, coalesced to one state
  // update per frame while the wheel streams events.
  const renderPeek = useCallback(() => {
    if (peekRaf.current) return;
    peekRaf.current = window.requestAnimationFrame(() => {
      peekRaf.current = 0;
      const d = peekDir.current;
      if (!d) return;
      const reveal = Math.min(1, accum.current / TURN_PX);
      setPeekAnimating(false);
      setPeek({ dir: d, reveal });
      if (reveal >= 1) commit(d);
    });
  }, [commit]);

  // Programmatic turn (arrow keys / edge click): slide a full peek 0→1, swap.
  const animateTurn = useCallback(
    (d: 1 | -1) => {
      const dest = clampIdx(currentRef.current + d);
      if (dest === currentRef.current) return;
      peekDir.current = d;
      peekNeighbor.current = dest;
      accum.current = TURN_PX;
      if (reducedRef.current) {
        finalize(d);
        return;
      }
      turning.current = true;
      setPeekReady(false);
      setPeekIdx(dest);
      setPeekAnimating(false);
      setPeek({ dir: d, reveal: 0 });
      window.requestAnimationFrame(() => {
        // Flush the reveal:0 mount (WKWebView otherwise coalesces the mount +
        // the reveal:1 change and the slide snaps — see two-frame gotcha).
        void peekHostRef.current?.offsetHeight;
        setPeekAnimating(true);
        setPeek({ dir: d, reveal: 1 });
        if (turnTimer.current) window.clearTimeout(turnTimer.current);
        turnTimer.current = window.setTimeout(() => finalize(d), ANIM_MS);
      });
    },
    [clampIdx, finalize],
  );

  const goToPage = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(pageCount - 1, i));
      if (flow === "scroll") {
        scrollRef.current?.scrollTo({
          top: layout.top[clamped],
          behavior: reducedMotion ? "auto" : "smooth",
        });
        return;
      }
      if (turning.current || peekDir.current) return; // a turn is already running
      const cur = currentRef.current;
      if (clamped === cur) return;
      if (Math.abs(clamped - cur) === 1) {
        animateTurn((clamped - cur) as 1 | -1);
      } else {
        pendingScroll.current = "top"; // multi-page jump: land at the top
        setCurrent(clamped);
      }
    },
    [flow, layout, pageCount, reducedMotion, animateTurn],
  );

  useImperativeHandle(ref, () => ({ goToPage }), [goToPage]);

  const flip = useCallback((delta: number) => goToPage(current + delta), [goToPage, current]);
  useEffect(() => {
    if (flow !== "paged") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") flip(dir === "rtl" ? +1 : -1);
      else if (e.key === "ArrowRight") flip(dir === "rtl" ? -1 : +1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow, dir, flip]);

  // Paged mode: land the swapped-in page at the right edge — top normally,
  // bottom when turning back. Also pins the first paint to the top so a page
  // taller than the viewport opens at its head rather than centered + clipped.
  useLayoutEffect(() => {
    if (flow !== "paged") return;
    const el = scrollRef.current;
    if (!el) return;
    const mode = pendingScroll.current;
    pendingScroll.current = null;
    el.scrollTop = mode === "bottom" ? el.scrollHeight : 0;
  }, [current, flow]);

  // Paged mode: wheel pans a tall page; at the edge it drags the neighbour in
  // (peek) and only turns past TURN_PX of push. Non-passive so we can swallow
  // the event once we take over. Subscribes once — reads live values via refs.
  useEffect(() => {
    if (flow !== "paged") return;
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // horizontal gesture
      if (turning.current) {
        e.preventDefault();
        return;
      }
      const down = e.deltaY > 0;
      const d: 1 | -1 = down ? 1 : -1;
      // `peekDir` is set synchronously, so back-to-back wheel events in one
      // frame accumulate instead of each restarting the peek (React state would
      // lag a frame). 0 means no peek is open.
      if (peekDir.current === 0) {
        const max = el.scrollHeight - el.clientHeight;
        const TOL = 4; // a page fit to the viewport is often 1-2px taller
        const atEdge =
          max <= TOL || (down ? el.scrollTop >= max - TOL : el.scrollTop <= TOL);
        if (!atEdge) return; // room to pan — let native scroll do it
        const dest = clampIdx(currentRef.current + d);
        if (dest === currentRef.current) return; // first / last page
        if (e.timeStamp < turnLockUntil.current || peekHold.current != null) {
          e.preventDefault(); // still settling the previous turn
          return;
        }
        e.preventDefault();
        if (turnTimer.current) {
          window.clearTimeout(turnTimer.current); // abort a spring-back mid-flight
          turnTimer.current = null;
        }
        peekDir.current = d;
        peekNeighbor.current = dest;
        accum.current = Math.abs(e.deltaY);
        setPeekReady(false);
        setPeekIdx(dest);
        renderPeek();
        scheduleIdle();
        return;
      }
      // A peek is in progress: grow it in its direction, shrink on reverse.
      e.preventDefault();
      accum.current += (d === peekDir.current ? 1 : -1) * Math.abs(e.deltaY);
      if (accum.current <= 0) {
        cancelPeek();
        return;
      }
      renderPeek();
      scheduleIdle();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.style.cursor = "";
    };
  }, [flow, clampIdx, renderPeek, scheduleIdle, cancelPeek]);

  // Paged mode on touch: a horizontal drag pans the filmstrip 1:1 with the
  // finger and snaps on release. The wheel path above never fires from a finger,
  // so without this a touch device could only turn pages by tapping an edge.
  // Vertical drags are left alone so the native scroller still pans a tall page.
  useEffect(() => {
    if (flow !== "paged") return;
    const el = scrollRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      touch.current = {
        x: t.clientX,
        y: t.clientY,
        t: e.timeStamp,
        axis: "",
        samples: [{ x: t.clientX, t: e.timeStamp }],
      };
      suppressClick.current = false;
      // A held finger must not be sprung back by the wheel path's idle timer.
      if (idleTimer.current) {
        window.clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const s = touch.current;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;

      if (s.axis === "") {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (s.axis === "y") return; // let the scroller pan a tall page

      // Zoomed in: pan the page horizontally first, only turn at the edge. The
      // same 4px tolerance the wheel path uses — a page fit to the viewport
      // routinely overflows by a pixel or two, which must not read as "zoomed"
      // and swallow every drag. RTL engines report scrollLeft negative, so
      // compare on distance from the origin edge.
      const TOL = 4;
      const maxX = overflowX.current;
      if (maxX > TOL) {
        const from = Math.abs(el.scrollLeft);
        const atEdge = dx > 0 ? from <= TOL : from >= maxX - TOL;
        if (!atEdge) {
          // We asked for `touch-action: pan-y` so the page-turn drag could
          // claim horizontal gestures, which also means the compositor will
          // NOT pan this axis for us. Drive it by hand, then rebase the origin
          // so the next move is measured from here (and a subsequent turn
          // starts from zero travel rather than inheriting the pan distance).
          e.preventDefault();
          // Clamp against the layout-derived range for the same reason maxX is
          // read from layout — scrollLeft's own bounds move during a turn.
          const next = el.scrollLeft - dx;
          el.scrollLeft = el.scrollLeft < 0 || next < 0
            ? Math.max(-maxX, Math.min(0, next))
            : Math.max(0, Math.min(maxX, next));
          s.x = t.clientX;
          s.samples.length = 0;
          s.samples.push({ x: t.clientX, t: e.timeStamp });
          return;
        }
      }
      if (turning.current || peekHold.current != null) {
        e.preventDefault(); // still settling the previous turn
        return;
      }

      // Dragging left advances an LTR book; RTL mirrors it.
      const d = ((dx < 0 ? 1 : -1) * (dir === "rtl" ? -1 : 1)) as 1 | -1;
      if (peekDir.current === 0) {
        const dest = clampIdx(currentRef.current + d);
        if (dest === currentRef.current) return; // first / last page
        peekDir.current = d;
        peekNeighbor.current = dest;
        setPeekReady(false);
        setPeekIdx(dest);
      } else if (peekDir.current !== d) {
        cancelPeek(); // dragged back past the origin
        return;
      }
      e.preventDefault();
      suppressClick.current = true;
      s.samples.push({ x: t.clientX, t: e.timeStamp });
      while (s.samples.length > 2 && e.timeStamp - s.samples[0].t > VELOCITY_WINDOW_MS) {
        s.samples.shift();
      }
      // renderPeek derives reveal as accum/TURN_PX, so expressing the travelled
      // fraction of a viewport in that unit makes the strip follow the finger.
      accum.current = Math.min(1, Math.abs(dx) / (el.clientWidth || 1)) * TURN_PX;
      renderPeek();
    };

    const onEnd = () => {
      const s = touch.current;
      const d = peekDir.current;
      const wasDrag = s.axis === "x";
      s.axis = "";
      if (!wasDrag || d === 0 || turning.current) return;
      const dragged = accum.current / TURN_PX; // 0..1 of a viewport
      // A flick only counts toward the turn it was already heading into —
      // `d` is the direction the peek opened in, so require the tail velocity
      // to point the same way before treating it as a throw.
      const vx = releaseVelocity(s.samples);
      const towards = dir === "rtl" ? d : -d; // strip travel sign for this turn
      const flicked = Math.sign(vx) === Math.sign(towards) &&
        Math.abs(vx) >= FLING_PX_MS;
      s.samples = [];
      if (dragged >= SNAP_FRACTION || flicked) commit(d);
      else cancelPeek();
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [flow, dir, clampIdx, renderPeek, cancelPeek, commit]);

  // Render the peeked page into the overlay host (once per turn — keyed on the
  // page index, not the reveal, so dragging doesn't re-render the pdf).
  useEffect(() => {
    if (peekIdx == null) return;
    const host = peekHostRef.current;
    if (!host) return;
    let cancelled = false;
    (async () => {
      let s = sizes[peekIdx];
      if (!s) {
        try {
          s = await source.pageSize(peekIdx);
        } catch {
          s = { w: 800, h: 1132 };
        }
        if (cancelled) return;
        setSizes((prev) => {
          if (prev[peekIdx]) return prev;
          const next = prev.slice();
          next[peekIdx] = s!;
          return next;
        });
      }
      const sc = (layout.displayW[peekIdx] || usableW) / s.w;
      await source.renderPage(peekIdx, host, sc);
      if (!cancelled) setPeekReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [peekIdx, layout, sizes, tint, source, usableW]);

  // Drop the covering overlay once the base layer has painted the new page.
  useEffect(() => {
    const hold = peekHold.current;
    if (hold == null || !rendered.has(hold)) return;
    peekHold.current = null;
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setPeek(null);
    setPeekIdx(null);
    setPeekAnimating(false);
    // MUST mirror the hold-timer's cleanup. This path fires first whenever the
    // incoming page is already rasterized — i.e. almost always — and leaving
    // `swapped` set here pinned it true for the rest of the session, which
    // froze the outgoing page in place on every subsequent turn.
    setSwapped(false);
  }, [rendered]);

  // ---- Floating scrollbar ---------------------------------------------------

  const updateBar = useCallback(() => {
    const el = scrollRef.current;
    const bar = barRef.current;
    if (!el || !bar) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 2) {
      bar.style.opacity = "0";
      return;
    }
    const trackH = clientHeight - PAD * 2;
    const thumbH = Math.max(28, (clientHeight / scrollHeight) * trackH);
    const top = (scrollTop / (scrollHeight - clientHeight)) * (trackH - thumbH);
    bar.style.height = `${thumbH}px`;
    bar.style.transform = `translateY(${PAD + Math.max(0, top)}px)`;
  }, []);

  const flashBar = useCallback(() => {
    const el = scrollRef.current;
    const bar = barRef.current;
    if (!el || !bar || el.scrollHeight <= el.clientHeight + 2) return;
    bar.style.opacity = "0.5";
    if (barIdle.current) window.clearTimeout(barIdle.current);
    barIdle.current = window.setTimeout(() => {
      if (barRef.current) barRef.current.style.opacity = "0";
    }, 800);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      flashBar();
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        updateBar();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [updateBar, flashBar]);

  useEffect(() => {
    updateBar();
  }, [updateBar, container.w, container.h, current, layout, flow]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      for (const t of [idleTimer, turnTimer, holdTimer, barIdle]) {
        if (t.current) window.clearTimeout(t.current);
      }
      if (peekRaf.current) window.cancelAnimationFrame(peekRaf.current);
    },
    [],
  );

  // Stable ref callback per page index — avoids detach/reattach churn (which
  // would otherwise re-trigger renders on every re-render).
  const hostCb = useCallback((i: number) => {
    let cb = refCbs.current.get(i);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) hostRefs.current.set(i, el);
        else {
          hostRefs.current.delete(i);
          renderedScale.current.delete(i);
        }
      };
      refCbs.current.set(i, cb);
    }
    return cb;
  }, []);

  // Paged mode: click the left / right edge (18%) to turn. Direction follows
  // reading order and matches the arrow keys — RTL left edge is "next".
  const edgeSideAt = useCallback((clientX: number): -1 | 0 | 1 => {
    const el = scrollRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const frac = (clientX - r.left) / r.width;
    if (frac <= 0.18) return -1;
    if (frac >= 0.82) return 1;
    return 0;
  }, []);
  const onPagedClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressClick.current) {
        // Trailing click of a drag that already turned the page.
        suppressClick.current = false;
        return;
      }
      const edge = edgeSideAt(e.clientX);
      if (edge !== 0) flip(edge * (dir === "rtl" ? -1 : 1));
    },
    [edgeSideAt, flip, dir],
  );
  const onPagedMove = useCallback(
    (e: React.MouseEvent) => {
      const el = scrollRef.current;
      if (el) el.style.cursor = edgeSideAt(e.clientX) === 0 ? "default" : "pointer";
    },
    [edgeSideAt],
  );

  const skeletonStyle = (
    w: number,
    h: number,
    animate: boolean,
  ): React.CSSProperties => ({
    width: w,
    height: h,
    // No outline on the page itself — the sheet of paper is the content, and a
    // rule around it just reads as chrome. The drop shadow is what separates
    // the page from the background, so it's kept wherever there's a gutter for
    // it to fall into; full-bleed (fit: width) has none, so it's dropped too.
    boxShadow: padX > 0 ? "0 8px 30px rgba(0,0,0,0.22)" : "none",
    backgroundColor: theme.chrome,
    backgroundImage: `linear-gradient(100deg, ${theme.chrome} 30%, ${theme.hover} 50%, ${theme.chrome} 70%)`,
    backgroundSize: "200% 100%",
    animation: animate && !reducedMotion ? "fx-shimmer 1.3s linear infinite" : "none",
  });

  const visible: number[] = [];
  if (flow === "scroll") {
    for (let i = win.start; i <= win.end; i++) visible.push(i);
  }

  // Keep the touch handler's overflow measure in sync (see `overflowX`).
  overflowX.current = Math.max(0, (layout.displayW[current] || 0) - contentW);

  const nIdx = peekIdx ?? 0;

  // A turn pans across a filmstrip of pages: BOTH layers move as one, the
  // incoming page entering from the edge while the outgoing leaves by exactly
  // the distance the incoming covers. Nothing is dealt on top of a frozen
  // page, so the motion reads as the viewport travelling along the strip.
  //
  // The strip runs sideways on mobile (matching the swipe) and vertically on
  // desktop (matching the wheel) — see the `turnAxis` prop. `mirror` flips a
  // horizontal strip for RTL books, where the next page sits to the left; the
  // same mapping edge-taps already use. A vertical strip is never mirrored:
  // "next" is down in both scripts. Once the base has swapped to the new page
  // (`swapped`) it sits at rest; the overlay still covers at that point, so
  // the reset is never visible.
  const horizontal = axis === "x";
  const mirror = horizontal && dir === "rtl" ? -1 : 1;
  const turnSpan = (horizontal ? container.w : container.h) || 1;
  const translate = (px: number) =>
    horizontal ? `translateX(${px}px)` : `translateY(${px}px)`;
  const turnActive = flow === "paged" && peek && !swapped;
  const baseShift = turnActive ? -peek.dir * mirror * peek.reveal * turnSpan : 0;
  const baseTurnStyle: React.CSSProperties = {
    transform: translate(baseShift),
    transition:
      peekAnimating && !swapped && !reducedMotion
        ? `transform ${ANIM_MS}ms ${TURN_EASE}`
        : "none",
  };

  return (
    <div
      dir={dir}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: theme.bg,
        // Confine the PDF duotone's mix-blend overlays to this subtree.
        isolation: duotone ? "isolate" : undefined,
        // DOCX cards read these; unset for PDF (which uses the duotone instead).
        ...(docxColors
          ? ({
              ["--reading-ink"]: docxColors.ink,
              ["--reading-paper"]: docxColors.paper,
            } as React.CSSProperties)
          : null),
      }}
    >
      <div
        ref={scrollRef}
        className="no-scrollbar"
        onClick={flow === "paged" ? onPagedClick : undefined}
        onMouseMove={flow === "paged" ? onPagedMove : undefined}
        style={{
          position: "absolute",
          inset: 0,
          overflow: "auto",
          overscrollBehavior: "contain",
          background: theme.bg,
          // Paged: claim horizontal gestures for the page-turn drag. Without
          // this the compositor can take the pan before the touch handler sees
          // it, and the strip never follows the finger.
          touchAction: flow === "paged" ? "pan-y" : undefined,
          // Paged: a scrollable flex box. The page uses margin:auto, so it
          // centers when it fits and pins to the top-start (fully scrollable,
          // head never clipped) when it's taller / wider than the viewport.
          ...(flow === "paged"
            ? { display: "flex", padding: `${PAD}px ${padX}px` }
            : null),
        }}
      >
        {flow === "scroll" ? (
          <div style={{ position: "relative", width: "100%", height: layout.totalH }}>
            {visible.map((i) => (
              <div
                key={i}
                ref={hostCb(i)}
                style={{
                  position: "absolute",
                  top: layout.top[i],
                  left: `calc(50% - ${layout.displayW[i] / 2}px)`,
                  filter: hostFilter,
                  ...skeletonStyle(layout.displayW[i], layout.displayH[i], !rendered.has(i)),
                }}
              />
            ))}
            {/* PDF duotone: two GPU-composited mix-blend overlays per rendered
                page, sized/positioned to match its host. `lighten`/`darken`
                (order + modes chosen by pdfDuotone for polarity) remap the
                grayscaled page's darks→ink and lights→paper. */}
            {duotone &&
              visible.flatMap((i) =>
                rendered.has(i)
                  ? duotoneOverlays(`s${i}`, {
                      position: "absolute",
                      top: layout.top[i],
                      left: `calc(50% - ${layout.displayW[i] / 2}px)`,
                      width: layout.displayW[i],
                      height: layout.displayH[i],
                    })
                  : [],
              )}
          </div>
        ) : (
          <>
            <div
              key={current}
              ref={hostCb(current)}
              style={{
                margin: "auto",
                flexShrink: 0,
                filter: hostFilter,
                ...baseTurnStyle,
                ...skeletonStyle(
                  layout.displayW[current] || 0,
                  layout.displayH[current] || 0,
                  !rendered.has(current),
                ),
              }}
            />
            {/* Paged duotone: mirror the host's flex-centered box exactly. */}
            {duotone && rendered.has(current) && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  padding: `${PAD}px ${padX}px`,
                  pointerEvents: "none",
                  // Travel with the page it tints, or the duotone would smear
                  // across a moving page mid-turn.
                  ...baseTurnStyle,
                }}
              >
                <div
                  style={{
                    position: "relative",
                    margin: "auto",
                    flexShrink: 0,
                    width: layout.displayW[current] || 0,
                    height: layout.displayH[current] || 0,
                  }}
                >
                  {duotoneOverlays("p", { position: "absolute", inset: 0 })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Peek overlay: the incoming page, sliding in from the edge as the turn
          progresses. Pointer-events off so the wheel keeps reaching the scroller
          underneath (which drives the peek). */}
      {flow === "paged" && peek && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            pointerEvents: "none",
            zIndex: 5,
            display: "flex",
            // Mirror the base scroller's box exactly (flex + PAD + margin:auto
            // on the child) so the page lands where the settled page sits and
            // the swap is invisible.
            padding: `${PAD}px ${padX}px`,
          }}
        >
          <div
            ref={peekHostRef}
            style={{
              margin: "auto",
              flexShrink: 0,
              transform: translate(peek.dir * mirror * (1 - peek.reveal) * turnSpan),
              transition:
                peekAnimating && !reducedMotion ? `transform ${ANIM_MS}ms ${TURN_EASE}` : "none",
              // The sliding peek page keeps the same tonal filter as the settled
              // pages (grayscale/invert for a color duotone; else the tint), so
              // it doesn't flash its original colors mid-turn. The colored blend
              // overlays are omitted here — the page picks them up once it lands.
              filter: hostFilter,
              ...skeletonStyle(
                layout.displayW[nIdx] || 0,
                layout.displayH[nIdx] || 0,
                !peekReady,
              ),
            }}
          />
        </div>
      )}

      {/* Floating scrollbar — driven imperatively (no re-render), fades out ~0.8s
          after scrolling stops. */}
      <div
        ref={barRef}
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          insetInlineEnd: 3,
          width: 6,
          height: 28,
          borderRadius: 3,
          background: theme.muted,
          opacity: 0,
          transition: "opacity 240ms ease",
          pointerEvents: "none",
          zIndex: 6,
        }}
      />
    </div>
  );
});
