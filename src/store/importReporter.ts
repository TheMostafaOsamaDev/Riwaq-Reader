// Turns the import pipeline's coarse phase/ratio callbacks into a single
// 0..1 number, and mirrors it into the shared import-progress store.
//
// One number, two consumers:
//   * the library's import button, which renders it as a determinate ring;
//   * `downloadNotifier`, which already turns an active import into an
//     Android progress notification (`status.notif.importingTitle`).
//
// Weights are rough but honest about where the time actually goes. Copying
// bytes dominates for a big book — a 200 MB EPUB spends seconds there and
// milliseconds parsing — so a bar that jumps to 90% during the copy and then
// sits still would be a lie.

import {
  finishImport,
  failStep,
  setMinimized,
  setOverall,
  setStepLabel,
  startImport,
} from "./importProgress";
import type { ImportReporter } from "./library";
import type { StageProgress } from "./nativeStaging";

/** Share of one file's progress owned by each phase, in order. */
const WEIGHTS = {
  copy: 0.55,
  parse: 0.1,
  write: 0.35,
} as const;

const STEP_ID = "device-import";

/**
 * Fraction (0..1) of a single file that's done, given the phase and how far
 * into that phase we are. Exported for tests — the monotonicity of this
 * function is the whole point, a bar that goes backwards is worse than no
 * bar.
 */
export function fileFraction(
  phase: "copy" | "parse" | "write",
  ratio: number,
): number {
  const r = Math.min(1, Math.max(0, ratio));
  if (phase === "copy") return WEIGHTS.copy * r;
  if (phase === "parse") return WEIGHTS.copy + WEIGHTS.parse * r;
  return WEIGHTS.copy + WEIGHTS.parse + WEIGHTS.write * r;
}

export interface ImportProgressView {
  /** 0..1 across every file in the run. */
  overall: number;
  /** 1-based index of the file being worked on. */
  index: number;
  total: number;
  /** Display name of the current file, when we have one. */
  name: string;
}

/**
 * Build a reporter for one import run.
 *
 * `onUpdate` receives every change so a component can render it locally;
 * the shared store is updated in step so the notification tracks it too.
 * The run starts minimized — the caller's own affordance (a button spinner)
 * is the primary feedback, and the full-screen stepper would be too much
 * ceremony for picking a file.
 */
export function createImportReporter(
  onUpdate: (view: ImportProgressView) => void,
  label: string,
): ImportReporter {
  let index = 0;
  let total = 1;
  let name = "";
  let phase: "copy" | "parse" | "write" = "copy";

  const push = (fraction: number) => {
    const overall = total > 0 ? (index + fraction) / total : fraction;
    const view: ImportProgressView = {
      overall: Math.min(1, Math.max(0, overall)),
      index: index + 1,
      total,
      name,
    };
    onUpdate(view);
    setOverall(view.overall);
    if (name) setStepLabel(STEP_ID, name);
  };

  startImport([{ id: STEP_ID, label }]);
  setMinimized(true);

  return {
    file(i, t, fileName) {
      index = i;
      total = Math.max(1, t);
      name = fileName;
      phase = "copy";
      push(0);
    },
    phase(next) {
      phase = next;
      // Entering a phase means everything before it is done.
      push(fileFraction(next, 0));
    },
    progress(p: StageProgress) {
      // Rust reports "extract" for the unpack pass, which is the tail of our
      // "write" phase; anything else is the byte copy.
      const mapped = p.phase === "extract" ? "write" : "copy";
      if (mapped !== phase && mapped === "copy") return; // stale event
      push(fileFraction(mapped, p.ratio));
    },
  };
}

/** Mark the run finished so the store (and the notification) settle. */
export function finishImportRun(bookId: string | null): void {
  finishImport(bookId ?? "");
}

/** Mark the run failed; the store keeps the message visible. */
export function failImportRun(message: string): void {
  failStep(STEP_ID, message);
}
