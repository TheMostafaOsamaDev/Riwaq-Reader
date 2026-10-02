import { useState } from "react";

/** Call `reseed` the moment `key` changes, during the render that sees it.
 *
 *  For state that a remounted child reads only once, at mount — a reader's
 *  resume hint. A layout flip swaps MobileReader for DesktopReader (or remounts
 *  the PDF reader in its other slot), and the fresh reader scrolls to the hint
 *  it was handed. `reseed` should set that hint from the live position.
 *
 *  It runs during render, not in an effect: React re-runs this component with
 *  the new state before rendering any children, so the incoming reader never
 *  mounts with the stale value. An effect would let it mount, scroll to the
 *  old place, and report that place back as the reading position. `reseed`
 *  must only set state on the calling component. */
export function useReseedOnChange<K>(key: K, reseed: () => void): void {
  const [seenKey, setSeenKey] = useState(key);
  if (!Object.is(seenKey, key)) {
    setSeenKey(key);
    reseed();
  }
}
