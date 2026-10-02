import { useEffect, useState } from "react";

/** How long a button that just changed what it does ignores clicks. */
export const ARM_MS = 1000;

const UNARMED = Symbol("unarmed");

/** False for `ms` after `key` changes (and after mount), then true.
 *
 *  For a button whose action changes in place: Update becomes Restart now
 *  the moment a fast download ends, Next becomes Start reading. A
 *  double-click, or the first click on an inactive macOS window (which only
 *  activates it) followed by the real one, would otherwise land on the new
 *  action. Seen in the Task 14 macOS run: Riwaq restarted about 2 s after
 *  the download with nobody pressing Restart now.
 *
 *  The answer is false in the very render where `key` changes, not one
 *  effect later, so there is no frame where the new action is live. */
export function useArmed(key: unknown, ms: number = ARM_MS): boolean {
  const [armedFor, setArmedFor] = useState<unknown>(UNARMED);
  useEffect(() => {
    const t = setTimeout(() => setArmedFor(() => key), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return Object.is(armedFor, key);
}
