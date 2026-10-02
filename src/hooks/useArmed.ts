import { useEffect, useRef, useState } from "react";

/** How long a button that just changed what it does ignores clicks. */
export const ARM_MS = 1000;

/** False for `ms` after every transition into `key` (and after mount),
 *  then true.
 *
 *  For a button whose action changes in place, or that appears where
 *  another one just was: Update becomes Restart now when a fast download
 *  ends, Next becomes Start reading. In the Task 14 macOS run Riwaq
 *  restarted about 2 s after a download finished, which nobody can explain
 *  yet. The suspicion is a second click or some other stray input landing
 *  on the old Update spot. Restart now is protected three ways: it is a
 *  separate element in a different place, it waits out this delay, and the
 *  store's restart() refuses a call within ARM_MS of becoming ready.
 *
 *  Every change of `key` counts, including a return to an earlier value
 *  (A → B → A re-arms), and the answer is false in the very render where
 *  `key` changes, so there is no frame where the new action is live. */
export function useArmed(key: unknown, ms: number = ARM_MS): boolean {
  // Bumped, during render, on every change of key. Comparing against the
  // last key seen (not the last key armed) is what makes A → B → A re-arm.
  const seen = useRef<{ key: unknown; n: number }>({ key, n: 0 });
  if (!Object.is(seen.current.key, key)) {
    seen.current = { key, n: seen.current.n + 1 };
  }
  const n = seen.current.n;
  const [armedN, setArmedN] = useState(-1);
  useEffect(() => {
    const t = setTimeout(() => setArmedN(n), ms);
    return () => clearTimeout(t);
  }, [n, ms]);
  return armedN === n;
}
