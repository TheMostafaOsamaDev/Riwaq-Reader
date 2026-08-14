import { useEffect } from "react";

/**
 * Minimal local shape for the Wake Lock sentinel. `WakeLockSentinel` is not
 * guaranteed to be in lib.dom for this tsconfig, and the underlying API (or the
 * native plugin) may be missing on some platforms, so we type defensively.
 */
interface WakeLockSentinelLike {
  release?: () => Promise<void> | void;
}

/**
 * Keep the screen awake while `active` is true.
 *
 * The wake-lock sentinel auto-releases when the tab/app is hidden, so we
 * re-acquire it on `visibilitychange` when the document becomes visible again.
 * Every access to the API is wrapped in try/catch because neither the browser
 * API nor the native plugin is guaranteed to exist.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const req = async () => {
      try {
        const s: WakeLockSentinelLike | undefined = await (
          navigator as any
        ).wakeLock?.request("screen");
        // The effect may have torn down (or `active` flipped false) while this
        // request was in flight. If so, the cleanup already ran and saw a null
        // sentinel — release this now-orphaned lock immediately instead of
        // leaking it (screen would stay awake forever).
        if (cancelled) {
          void s?.release?.();
          return;
        }
        sentinel = s ?? null;
      } catch {
        // API/plugin unavailable or request rejected — never throw.
      }
    };
    void req();

    const onVis = () => {
      if (document.visibilityState === "visible" && !cancelled) void req();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      try {
        void sentinel?.release?.();
      } catch {
        // Ignore release failures.
      }
    };
  }, [active]);
}
