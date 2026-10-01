// Connects the background importer (store/backgroundImport.ts) to the app:
// the real pipeline, the reader, and the incoming-files buffer.
//
// Lives in App, which is mounted for the app's whole life, rather than in the
// Library, which is not — that difference is the entire fix. See the module
// comment in store/backgroundImport.ts.

import { type RefObject, useEffect, useRef } from "react";
import {
  configureBackgroundImport,
  enqueueImport,
} from "../store/backgroundImport";
import { onIncoming, takeIncoming } from "../store/incomingFiles";
import {
  createImportReporter,
  failImportRun,
  finishImportRun,
} from "../store/importReporter";
import { isImportBusy } from "../store/importProgress";
import { importPaths, sweepStaleStaging } from "../store/library";
import { getState as getNavState } from "../store/navigation";
import type { Tr } from "../i18n";

/** Long enough that the sweep never competes with first paint or with the
 *  cold-start drain of a file the launch itself delivered. */
const SWEEP_DELAY_MS = 8000;

/** `openBookRef` is App's own (it always holds the current openBook), and
 *  `tr` is passed in rather than read from context because App sits above
 *  its own I18nProvider. */
export function useBackgroundImportHost(
  openBookRef: RefObject<((bookId: string) => Promise<void>) | null>,
  tr: Tr,
): void {
  // The deps below are wired once, on mount; this keeps them on the current
  // locale.
  const trRef = useRef(tr);
  trRef.current = tr;

  useEffect(() => {
    configureBackgroundImport({
      importPaths,
      startRun() {
        const reporter = createImportReporter(
          trRef.current("sidebar.importing"),
        );
        return {
          reporter,
          finish: () => finishImportRun(null),
          // Not revealed: the toast reports the failure, and the stepper
          // must not pop over the reader to say it again.
          fail: failImportRun,
        };
      },
      open: (id) => openBookRef.current?.(id),
      // A fresh snapshot object per navigation (see store/navigation.ts), so
      // identity is exactly "has the user moved".
      navToken: () => getNavState().snapshot,
    });

    const drain = () => {
      const paths = takeIncoming();
      if (paths.length > 0) enqueueImport(paths);
    };
    drain();
    const off = onIncoming(drain);

    // Staged copies a killed import left behind. Skipped while anything is
    // importing: the mtime rule already protects a live run, this just keeps
    // the sweep's I/O out of its way. The next launch catches what it skips.
    const startedAt = performance.timeOrigin;
    const sweep = window.setTimeout(() => {
      if (!isImportBusy()) void sweepStaleStaging(startedAt);
    }, SWEEP_DELAY_MS);

    return () => {
      off();
      window.clearTimeout(sweep);
    };
  }, [openBookRef]);
}
