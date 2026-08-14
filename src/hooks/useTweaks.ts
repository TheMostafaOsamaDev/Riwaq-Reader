import { useCallback, useEffect, useState } from "react";
import type { Tweaks } from "../types/reader";

const STORAGE_KEY = "leaflet:tweaks:v1";

export const DEFAULT_TWEAKS: Tweaks = {
  uiLang: "system",
  theme: "sepia",
  fontFamily: "serif",
  fontSize: 17,
  lineHeight: 1.6,
  letterSpacing: 0,
  textAlign: "auto",
  readingMode: "paginated-2",
  contentWidth: 100,
  mobileTapNav: true,
  mobileTapZoneWidth: 33,
  mobileTapStride: 90,
  uiFont: "readex",
  paragraphSpacing: 1.1,
  hyphenation: false,
  pageTurnAnimation: true,
  keepScreenAwake: false,
  startupView: "library",
  confirmDelete: true,
  reduceMotion: "auto",
  maxConcurrentDownloads: 2,
  wifiOnlyDownloads: false,
  fixedFlow: "scroll",
  fixedFit: "width",
  fixedPageTint: "none",
};

function load(): Tweaks {
  if (typeof localStorage === "undefined") return DEFAULT_TWEAKS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TWEAKS;
    const parsed = JSON.parse(raw);
    // Migrate the old `columns: 1 | 2` field into the new `readingMode`
    // shape — pre-readingMode users had two-column scroll if they picked
    // `columns: 2`, otherwise single-column scroll.
    if (parsed && typeof parsed === "object" && parsed.readingMode === undefined) {
      if (parsed.columns === 2) parsed.readingMode = "paginated-2";
      else if (parsed.columns === 1) parsed.readingMode = "scroll";
      delete parsed.columns;
    }
    // The old manual `rtl` toggle is gone — direction is now derived from
    // the book's language tag at render time. Drop the field so the
    // spread merge with DEFAULT_TWEAKS doesn't keep a stale boolean.
    if (parsed && typeof parsed === "object" && "rtl" in parsed) {
      delete parsed.rtl;
    }
    // pageWidth (px scroll-mode cap) was superseded by contentWidth (%);
    // strip it so the spread doesn't keep a stale field.
    if (parsed && typeof parsed === "object" && "pageWidth" in parsed) {
      delete parsed.pageWidth;
    }
    return { ...DEFAULT_TWEAKS, ...parsed };
  } catch {
    return DEFAULT_TWEAKS;
  }
}

export function useTweaks() {
  const [t, setT] = useState<Tweaks>(() => load());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    } catch {
      // ignore persistence failure — it's not load-bearing
    }
  }, [t]);

  const setTweak = useCallback(
    <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
      setT((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const applyTweaks = useCallback((partial: Partial<Tweaks>) => {
    setT((prev) => {
      const next: Tweaks = { ...prev };
      for (const k of Object.keys(partial) as (keyof Tweaks)[]) {
        const v = partial[k];
        // Only accept a known key whose value matches the default's type (and,
        // for numbers, is finite). Guards Import Settings against corrupt or
        // foreign JSON — e.g. a string where a number is expected, or NaN,
        // which would otherwise poison a downstream effect (chrome font,
        // download concurrency).
        if (
          k in DEFAULT_TWEAKS &&
          v !== undefined &&
          typeof v === typeof DEFAULT_TWEAKS[k] &&
          !(typeof v === "number" && !Number.isFinite(v))
        ) {
          (next as unknown as Record<string, unknown>)[k] = v;
        }
      }
      return next;
    });
  }, []);

  return [t, setTweak, applyTweaks] as const;
}
