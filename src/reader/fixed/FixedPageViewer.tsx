// The fixed-layout viewer: renders a FixedPageSource's pages as either a
// virtualized continuous scroll of page-cards or one page at a time. Handles
// fit-width / fit-page + zoom, RTL page-flip, lazy per-window size measurement
// with height reservation (no layout shift), skeleton placeholders, and reports
// progress + resume location.

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
import type { Theme } from "../../styles/tokens";
import type {
  FixedFit,
  FixedFlow,
  FixedPageTint,
  ReaderProgress,
} from "../../types/reader";
import type { FixedPageSource } from "./FixedPageSource";

const PAD = 20;
const GAP = 18;
const MAX_W = 860; // cap page display width so wide screens stay readable + light

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
  dir: "ltr" | "rtl";
  theme: Theme;
  resume?: { page: number; pageOffset?: number };
  onProgress?: (p: ReaderProgress) => void;
  onLocationChange?: (page: number, pageOffset: number) => void;
  /** Localized page-counter label, e.g. "٧ / ٢٩٨". */
  formatCounter?: (page1: number, total: number) => string;
  reducedMotion?: boolean;
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
    dir,
    theme,
    resume,
    onProgress,
    onLocationChange,
    formatCounter,
    reducedMotion,
  } = props;
  const pageCount = source.pageCount;

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

  const contentW = Math.max(0, container.w - PAD * 2);
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
  }, [win, layout, sizes, tint, flow, source]);

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
  }, [flow, current, layout, sizes, tint, source, emit]);

  const goToPage = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(pageCount - 1, i));
      if (flow === "scroll") {
        scrollRef.current?.scrollTo({
          top: layout.top[clamped],
          behavior: reducedMotion ? "auto" : "smooth",
        });
      } else {
        setCurrent(clamped);
      }
    },
    [flow, layout, pageCount, reducedMotion],
  );

  useImperativeHandle(ref, () => ({ goToPage }), [goToPage]);

  const flip = useCallback(
    (delta: number) => goToPage(current + delta),
    [goToPage, current],
  );
  useEffect(() => {
    if (flow !== "paged") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") flip(dir === "rtl" ? +1 : -1);
      else if (e.key === "ArrowRight") flip(dir === "rtl" ? -1 : +1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow, dir, flip]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
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

  const skeletonStyle = (
    w: number,
    h: number,
    animate: boolean,
  ): React.CSSProperties => ({
    width: w,
    height: h,
    borderRadius: 4,
    border: `1px solid ${theme.rule}`,
    boxShadow: "0 8px 30px rgba(0,0,0,0.22)",
    backgroundColor: theme.chrome,
    backgroundImage: `linear-gradient(100deg, ${theme.chrome} 30%, ${theme.hover} 50%, ${theme.chrome} 70%)`,
    backgroundSize: "200% 100%",
    animation: animate && !reducedMotion ? "fx-shimmer 1.3s linear infinite" : "none",
  });

  const visible: number[] = [];
  if (flow === "scroll") {
    for (let i = win.start; i <= win.end; i++) visible.push(i);
  }

  return (
    <div
      ref={scrollRef}
      dir={dir}
      style={{
        position: "absolute",
        inset: 0,
        overflow: flow === "scroll" ? "auto" : "hidden",
        background: theme.bg,
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
                filter: tintFilter(tint),
                ...skeletonStyle(layout.displayW[i], layout.displayH[i], !rendered.has(i)),
              }}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            key={current}
            ref={hostCb(current)}
            style={{
              filter: tintFilter(tint),
              ...skeletonStyle(
                layout.displayW[current] || 0,
                layout.displayH[current] || 0,
                !rendered.has(current),
              ),
            }}
          />
          {/* Tap zones: start side = next in RTL / prev in LTR. */}
          <div
            onClick={() => flip(dir === "rtl" ? +1 : -1)}
            style={{ position: "absolute", insetInlineStart: 0, top: 0, bottom: 0, width: "18%", cursor: "pointer" }}
          />
          <div
            onClick={() => flip(dir === "rtl" ? -1 : +1)}
            style={{ position: "absolute", insetInlineEnd: 0, top: 0, bottom: 0, width: "18%", cursor: "pointer" }}
          />
        </div>
      )}
    </div>
  );
});
