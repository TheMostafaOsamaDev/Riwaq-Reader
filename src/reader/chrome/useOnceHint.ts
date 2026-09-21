// A hint that shows once per install and then never again.
//
// Both readers have one: desktop's says to move the pointer to an edge, the
// phone's says to tap anywhere. Only the wording and the storage key differ,
// so the policy — shown once, auto-dismissed after FOCUS_HINT_MS, blocked
// storage counts as already seen — lives here rather than in a copy per
// platform. A third surface gets it for free.

import { useCallback, useEffect, useRef, useState } from "react";
import { migrateStorageKey } from "../../lib/legacyStorage";

/** How long a hint stays up, in ms. Matches `.riwaq-focus-hint`'s keyframe. */
export const FOCUS_HINT_MS = 3200;

function readSeen(key: string): boolean {
  // Private-mode / blocked-storage webviews throw on access; treating that as
  // "already seen" is the quiet failure — better a missing hint than a crash.
  try {
    migrateStorageKey(key);
    return localStorage.getItem(key) === "1";
  } catch {
    return true;
  }
}

function writeSeen(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Nothing to do — the hint simply shows again next time.
  }
}

export interface OnceHint {
  /** Whether the hint should be on screen. Never true twice in an install:
   *  `show` is guarded, so this is a flag rather than a counter. */
  visible: boolean;
  /** Call when the thing the hint explains has just happened. */
  show: () => void;
  /** Call when it stops being relevant — leaving focus mode, say — so the
   *  pill does not hang around over restored chrome for the rest of its
   *  timer. */
  dismiss: () => void;
}

export function useOnceHint(key: string): OnceHint {
  const [visible, setVisible] = useState(false);
  const timer = useRef(0);
  // Whether this key has been shown before, read from storage at most once
  // per mount — the answer only changes when `show` itself changes it, and
  // the first read would otherwise land on the tap that starts the chrome
  // fade. Held per instance rather than in a module map, so it cannot
  // outlive the storage it caches.
  const seen = useRef<boolean | null>(null);

  // Unmount once the keyframe has finished — `forwards` would otherwise leave
  // an invisible pill in the tree (and in the a11y tree) for good.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = useCallback(() => {
    if (seen.current === null) seen.current = readSeen(key);
    if (seen.current) return;
    seen.current = true;
    writeSeen(key);
    setVisible(true);
    timer.current = window.setTimeout(() => setVisible(false), FOCUS_HINT_MS);
  }, [key]);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setVisible(false);
  }, []);

  return { visible, show, dismiss };
}
