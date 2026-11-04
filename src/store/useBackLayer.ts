import { useEffect, useRef } from "react";
import { pushLayer } from "./navigation";

/** While `active`, the screen's history gets an entry of its own, so the
 *  system Back (and a mouse back button) calls `onBack` instead of leaving
 *  the screen — the way a native sheet or dialog closes on Back. See
 *  `pushLayer` for how the entry is kept and dropped. */
export function useBackLayer(active: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!active) return;
    return pushLayer(() => onBackRef.current());
  }, [active]);
}
