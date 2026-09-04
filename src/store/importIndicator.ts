// What the single import indicator shows.
//
// There used to be two: a floating circular chip (ImportProgress's Dock,
// which under RTL rendered at the bottom *left*) and the ring inside the
// bottom bar's centre FAB. The chip is gone; this is the FAB's brain.
//
// It reads the shared import-progress store rather than the library's local
// state, which buys two things. Source/Store imports light it up — they
// never touch that local state, so the chip used to be their only
// indicator. And progress ticks stop re-rendering the library tree: the
// store emits ~50 times per import, and Library is a big tree with a cover
// grid in it, so subscribing in the leaf component is much cheaper.

import { isImportActive, useImportProgress, type ProgressState } from "./importProgress";

export interface ImportIndicator {
  /** Render a spinner instead of the "+" glyph. */
  busy: boolean;
  /** 0..1 for a determinate ring, or null for indeterminate. */
  ratio: number | null;
  /** What a tap does. "none" while the file dialog is up — there is no run
   *  to show yet, and re-opening the picker would be wrong. */
  action: "pick" | "details" | "none";
}

const IDLE: ImportIndicator = { busy: false, ratio: null, action: "pick" };

export function importIndicator(
  progress: ProgressState,
  localImporting: boolean,
): ImportIndicator {
  if (isImportActive(progress)) {
    return { busy: true, ratio: progress.overall, action: "details" };
  }
  // Local-only: the picker is open, or a commit is still finishing after the
  // reporter already settled.
  if (localImporting) return { busy: true, ratio: null, action: "none" };
  return IDLE;
}

/** Hook form. Subscribes to the store via useSyncExternalStore. */
export function useImportIndicator(localImporting: boolean): ImportIndicator {
  return importIndicator(useImportProgress(), localImporting);
}
