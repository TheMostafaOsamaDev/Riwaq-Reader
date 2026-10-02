import { useCallback, useEffect, useState } from "react";
import type { Tweaks } from "../types/reader";
import {
  FONT_STACKS,
  LEGACY_FONT_FAMILY,
  UI_FONT_STACKS,
} from "../styles/tokens";
import { appVersion } from "virtual:whats-new";
import { migrateStorageKey } from "../lib/legacyStorage";
import { isHeroStyle } from "../components/library/heroModel";

const STORAGE_KEY = "riwaq:tweaks:v1";

export const DEFAULT_TWEAKS: Tweaks = {
  uiLang: "system",
  theme: "sepia",
  heroStyle: "ambient",
  fontFamily: "readex",
  fontSize: 17,
  lineHeight: 1.6,
  letterSpacing: 0,
  textAlign: "auto",
  readingMode: "scroll",
  focusMode: false,
  contentWidth: 100,
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
  verboseDiagnostics: false,
  fixedFlow: "scroll",
  fixedFit: "width",
  fixedPageTint: "none",
  updateOverMobile: "ask",
};

const UPDATE_OVER_MOBILE: readonly unknown[] = ["ask", "always", "wifi"];

/** Would Import Settings take value `v` for tweak `k`? Only a known key whose
 *  value matches the default's type (and, for numbers, is finite). Guards
 *  against corrupt or foreign JSON — e.g. a string where a number is
 *  expected, or NaN, which would otherwise poison a downstream effect
 *  (chrome font, download concurrency). */
export function acceptsTweak(k: string, v: unknown): boolean {
  return (
    k in DEFAULT_TWEAKS &&
    v !== undefined &&
    typeof v === typeof DEFAULT_TWEAKS[k as keyof Tweaks] &&
    !(typeof v === "number" && !Number.isFinite(v)) &&
    // A string of the right type can still name a value that does not
    // exist (an export from a newer build, or a hand edit).
    !(k === "heroStyle" && !isHeroStyle(v)) &&
    !(k === "updateOverMobile" && !UPDATE_OVER_MOBILE.includes(v))
  );
}

export function loadTweaks(): Tweaks {
  if (typeof localStorage === "undefined") return DEFAULT_TWEAKS;
  try {
    migrateStorageKey(STORAGE_KEY);
    const raw = localStorage.getItem(STORAGE_KEY);
    // Nothing stored = a brand-new user with nothing to compare against, so
    // this version counts as already seen and they skip the update tour.
    if (!raw) return { ...DEFAULT_TWEAKS, lastSeenWhatsNew: appVersion };
    const parsed = JSON.parse(raw);
    // Migrate the old `columns: 1 | 2` field into the new `readingMode`
    // shape — pre-readingMode users had two-column scroll if they picked
    // `columns: 2`, otherwise single-column scroll.
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.readingMode === undefined
    ) {
      if (parsed.columns === 2) parsed.readingMode = "paginated-2";
      else if (parsed.columns === 1) parsed.readingMode = "scroll";
      delete parsed.columns;
    }
    // The "Check for updates" toggle was removed (2026-10-02): the daily
    // check is always on. Strip a stored `false` so it can't resurface.
    if (parsed && typeof parsed === "object") {
      delete parsed.autoCheckUpdates;
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
    // Tap-to-turn is gone — the reading surface is scroll-only now, and a tap
    // anywhere on it toggles the chrome. Strip the three settings it owned so
    // the spread below doesn't carry them forward on every save.
    if (parsed && typeof parsed === "object") {
      delete parsed.mobileTapNav;
      delete parsed.mobileTapZoneWidth;
      delete parsed.mobileTapStride;
    }
    const merged = { ...DEFAULT_TWEAKS, ...parsed };
    // Retired `fontFamily` values get pointed at a real bundled family
    // rather than at nothing: `serif`/`sans`/`dyslexic` named faces that were
    // never bundled (so they already resolved to Readex Pro or a system
    // fallback), and `thmanyah` names one that was dropped. Anything
    // unrecognised falls back to the default so a corrupt or hand-edited
    // value can't leave the reader unstyled.
    const legacy = LEGACY_FONT_FAMILY[merged.fontFamily];
    if (legacy) merged.fontFamily = legacy;
    if (!(merged.fontFamily in FONT_STACKS)) {
      merged.fontFamily = DEFAULT_TWEAKS.fontFamily;
    }
    // Cairo/Tajawal were removed as UI (chrome) fonts — coerce a stale
    // persisted value (or any unknown one) back to the default so the picker
    // and the chrome font stay valid.
    if (!(merged.uiFont in UI_FONT_STACKS)) merged.uiFont = "readex";
    if (!isHeroStyle(merged.heroStyle)) {
      merged.heroStyle = DEFAULT_TWEAKS.heroStyle;
    }
    if (!UPDATE_OVER_MOBILE.includes(merged.updateOverMobile)) {
      merged.updateOverMobile = DEFAULT_TWEAKS.updateOverMobile;
    }
    return merged;
  } catch {
    return DEFAULT_TWEAKS;
  }
}

export function useTweaks() {
  const [t, setT] = useState<Tweaks>(() => loadTweaks());

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
        if (acceptsTweak(k, v)) {
          (next as unknown as Record<string, unknown>)[k] = v;
        }
      }
      return next;
    });
  }, []);

  return [t, setTweak, applyTweaks] as const;
}
