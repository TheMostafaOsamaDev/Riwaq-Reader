// The disk side of the session log, and the error hooks that feed it.
//
// Everything here crosses the Tauri IPC bridge, so none of it is on the
// critical boot path — breadcrumbs.ts covers that case precisely because
// this module cannot.
//
// This is also the only module in the feature that imports plugin-fs. That
// is deliberate: keeping the bridge behind one door is what lets the
// recorder, the redactor, the session naming and the bundle formatter all be
// tested with no bridge at all.

import {
  BaseDirectory,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { drain, record } from "./recorder";
import {
  DIAG_DIR,
  nextSessionNumber,
  sessionFileName,
  sessionsToDelete,
  sortSessions,
} from "./sessions";

let current: string | null = null;
/**
 * Set synchronously by the first caller, before anything is awaited.
 *
 * `current` cannot do this job: it is assigned only after `mkdir` and the
 * directory listing have both resolved, and StrictMode's double invoke is
 * synchronous within one passive-effect flush — so both calls sail past a
 * `current` check and run the whole body twice. With real IPC the second run
 * can compute the NEXT session number (the extra file this exists to
 * prevent), and its `append: false` write can truncate a file the first run
 * has already flushed into.
 */
let starting: Promise<void> | null = null;

/**
 * The file's ceiling. The ring in recorder.ts bounds MEMORY (2000 events),
 * not the disk: every flush appends, so nothing stopped one long session
 * from growing without limit. That is academic on the cheap tier, which
 * emits a handful of events per launch, and real with detailed diagnostics
 * on — devLog's `snapshotReader` payload is ~4-5 KB and fires several times
 * per chapter turn, so an afternoon's reading would append hundreds of MB.
 */
const MAX_SESSION_BYTES = 4 * 1024 * 1024;

/** Bytes appended to `current` so far, and whether the ceiling was hit. */
let written = 0;
let capped = false;

const encoder = new TextEncoder();
/** Bytes, not UTF-16 code units — an unhashed error message can be Arabic,
 *  where the two differ by 2x. */
function byteLength(s: string): number {
  return encoder.encode(s).length;
}

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function listNames(): Promise<string[]> {
  try {
    const entries = await readDir(DIAG_DIR, { baseDir: BaseDirectory.AppData });
    return entries.map((e) => e.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Open this session's file and retire anything past the retention cap.
 *
 * One file per launch, however many times this is called: a second file per
 * launch halves the window RETAIN exists to provide, turning three past
 * launches into one, so the launch someone is trying to read about ages out
 * early.
 */
export function startSession(): Promise<void> {
  if (!hasTauri()) return Promise.resolve();
  if (starting) return starting;
  starting = (async () => {
    try {
      await mkdir(DIAG_DIR, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
      const names = await listNames();
      for (const old of sessionsToDelete(names)) {
        try {
          await remove(`${DIAG_DIR}/${old}`, {
            baseDir: BaseDirectory.AppData,
          });
        } catch {
          // A file we cannot delete is not worth failing the session over.
        }
      }
      current = `${DIAG_DIR}/${sessionFileName(nextSessionNumber(names))}`;
      written = 0;
      capped = false;
      await writeTextFile(current, "", { baseDir: BaseDirectory.AppData });
    } catch {
      current = null;
    }
  })();
  return starting;
}

/**
 * Drain the buffer to disk. Safe to call when there is nothing to write.
 *
 * Named `flushSession`, not `flushNow`: lib/devLog.ts exports a live
 * `flushNow` of its own with different semantics (it cancels a pending timer
 * and writes the dev debug file), and with both in the project an editor's
 * auto-import offered the wrong one at every call site.
 */
export async function flushSession(): Promise<void> {
  if (!hasTauri() || !current) return;
  // Still drain past the ceiling, so the ring is not left holding payloads
  // that will never be written.
  const events = drain();
  if (capped || events.length === 0) return;

  // Measured and appended per line rather than per batch: rejecting a whole
  // over-budget batch would throw away up to a flush interval of events, and
  // accepting it would overshoot the ceiling by however large it happened
  // to be.
  const lines: string[] = [];
  let hitCap = false;
  for (const e of events) {
    const line = `${JSON.stringify(e)}\n`;
    const size = byteLength(line);
    if (written + size > MAX_SESSION_BYTES) {
      hitCap = true;
      break;
    }
    lines.push(line);
    written += size;
  }
  if (hitCap) {
    capped = true;
    // Same shape devLog.ts uses for its own event ceiling, so a reader who
    // has seen one recognises the other. `tier` keeps the line uniform with
    // every other line in this file.
    lines.push(
      `${JSON.stringify({
        t: events[events.length - 1]?.t ?? 0,
        kind: "log:capped",
        tier: "cheap",
        data: MAX_SESSION_BYTES,
      })}\n`,
    );
  }

  try {
    await writeTextFile(current, lines.join(""), {
      baseDir: BaseDirectory.AppData,
      append: true,
    });
  } catch {
    // A failed write must never take the app down with it.
  }
}

/** Every retained session, oldest first, for the export bundle. */
export async function listSessions(): Promise<
  { name: string; lines: string[] }[]
> {
  if (!hasTauri()) return [];
  const out: { name: string; lines: string[] }[] = [];
  for (const name of sortSessions(await listNames())) {
    try {
      const text = await readTextFile(`${DIAG_DIR}/${name}`, {
        baseDir: BaseDirectory.AppData,
      });
      out.push({ name, lines: text.split("\n").filter(Boolean) });
    } catch {
      out.push({ name, lines: ["<unreadable>"] });
    }
  }
  return out;
}

/**
 * Route uncaught errors into the buffer. Returns the uninstaller, so a React
 * effect can own the lifetime rather than leaking a listener per mount.
 */
export function installErrorCapture(): () => void {
  if (typeof window === "undefined") return () => {};

  const onError = (e: ErrorEvent) => {
    record("error", {
      message: e.message,
      // `file` is redacted to a basename — a bundle path can carry the
      // build machine's directory layout.
      file: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error instanceof Error ? e.error.stack?.slice(0, 2000) : null,
    });
  };

  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason;
    record("unhandledRejection", {
      message: r instanceof Error ? r.message : String(r),
      stack: r instanceof Error ? r.stack?.slice(0, 2000) : null,
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
