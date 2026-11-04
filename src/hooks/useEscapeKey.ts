import { useEffect, useRef } from "react";

/** While `active`, Esc calls `onEscape` — unless something nearer the focus
 *  already handled it with preventDefault, as an open dropdown inside a sheet
 *  does. Listens on window, so handlers on the document run first and the
 *  innermost layer wins. */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onEscapeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
