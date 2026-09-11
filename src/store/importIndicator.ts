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

import { useSyncExternalStore } from "react";
import {
  isImportActive,
  useImportProgress,
  type ProgressState,
} from "./importProgress";
import {
  activeLibraryAddCount,
  subscribe as subscribeQueue,
  getState as getQueueState,
} from "./downloadQueue";

export interface ImportIndicator {
  /** Render a spinner instead of the "+" glyph. */
  busy: boolean;
  /** 0..1 for a determinate ring, or null for indeterminate. */
  ratio: number | null;
  /** What a tap does. "none" while the file dialog is up — there is no run
   *  to show yet, and re-opening the picker would be wrong. */
  action: "pick" | "details" | "none";
  /** Why the ring is spinning. A library add's cover fetch has nothing to
   *  do with "importing" — callers need this to label the busy state
   *  honestly instead of defaulting to the import copy. Meaningless while
   *  `busy` is false. */
  reason: "import" | "add" | "local";
}

const IDLE: ImportIndicator = {
  busy: false,
  ratio: null,
  action: "pick",
  reason: "import",
};

/** useSyncExternalStore compares snapshots with Object.is, and the queue's
 *  state object is a module-scope const that is mutated in place — its
 *  identity never changes, so an object snapshot would never re-render.
 *  A count is a primitive: it compares by value, so the ring updates
 *  exactly when the number of in-flight adds changes. */
const getActiveAddCount = () => activeLibraryAddCount(getQueueState().jobs);

export function importIndicator(
  progress: ProgressState,
  localImporting: boolean,
  addsActive: number,
): ImportIndicator {
  // A real import knows its ratio, so it wins the ring even when an add is
  // also in flight.
  if (isImportActive(progress)) {
    return {
      busy: true,
      ratio: progress.overall,
      action: "details",
      reason: "import",
    };
  }
  // One cover fetch has no meaningful fraction, so the ring is
  // indeterminate rather than pretending to a percentage.
  //
  // `action` is "pick", not "details": an add has no stepper to open —
  // ImportProgress renders null while the *import* store is idle, which it
  // is here — so "details" left the FAB/Import button advertising "Open
  // details" and doing nothing when pressed. The ring is ambient status
  // only; picking another file to import is still perfectly legitimate
  // while a cover fetches in the background. Do not change this back to
  // "details" without first giving the add its own detail view to open.
  if (addsActive > 0)
    return { busy: true, ratio: null, action: "pick", reason: "add" };
  // Local-only: the picker is open, or a commit is still finishing after the
  // reporter already settled.
  if (localImporting)
    return { busy: true, ratio: null, action: "none", reason: "local" };
  return IDLE;
}

/** Hook form. Subscribes to both the import store and the download queue via
 *  useSyncExternalStore. Chapter downloads are deliberately excluded — the
 *  Downloads page is their indicator; the ring would otherwise flicker
 *  through every chapter of a long burst. */
export function useImportIndicator(localImporting: boolean): ImportIndicator {
  const progress = useImportProgress();
  const adds = useSyncExternalStore(
    subscribeQueue,
    getActiveAddCount,
    getActiveAddCount,
  );
  return importIndicator(progress, localImporting, adds);
}
