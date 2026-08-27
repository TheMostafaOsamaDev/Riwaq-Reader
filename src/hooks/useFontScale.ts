import { useEffect, useMemo, useState } from "react";
import {
  loadSpecFor,
  measureFontScale,
  type MetricScript,
} from "../styles/fontMetrics";

/** Apparent-size multiplier for `stack`, measured off the face the browser
 *  actually resolved. See `styles/fontMetrics.ts` for why this is measured
 *  rather than tabulated.
 *
 *  Measures immediately so the first paint isn't blocked, then re-measures
 *  once the stack's faces have loaded — until they do, the browser reports
 *  the FALLBACK face's metrics, which would score a self-hosted font like
 *  Lateef as needing no correction at all. */
export function useFontScale(stack: string, script: MetricScript): number {
  const [loadedTick, setLoadedTick] = useState(0);

  useEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonts) return;
    let live = true;
    const [spec, text] = loadSpecFor(stack, script);
    // `fonts.load` rejects on a stack naming a family with no @font-face rule
    // (Literata, Atkinson Hyperlegible) — that's the normal case for the
    // system-font stacks, not an error, so settle either way and re-measure.
    Promise.resolve(fonts.load(spec, text))
      .catch(() => undefined)
      .then(() => {
        if (live) setLoadedTick((n) => n + 1);
      });
    return () => {
      live = false;
    };
  }, [stack, script]);

  return useMemo(
    () => measureFontScale(stack, script),
    // loadedTick is the re-measure trigger: same stack, now-loaded faces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stack, script, loadedTick],
  );
}
