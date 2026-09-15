// Boot breadcrumbs — the one diagnostic that can describe a launch that
// never finished.
//
// Everything here is synchronous and backed by localStorage. That is not a
// convenience, it is the whole point: the app's blank-launch bug is a stall
// on the Tauri IPC bridge, and a log written over that bridge (as
// lib/devLog.ts is) cannot record the bridge failing. localStorage is
// in-webview, synchronous, and survives the process, which is exactly the
// set of properties needed to describe a launch that died mid-way.
//
// Four marks are written as the launch progresses. On the NEXT launch the
// previous record is rotated out and classified: the last mark present is
// how far it got, and the first missing one is where it died.
//
// The rotation itself lives in index.html's inline script, not here. It has
// to: a launch that stalls never reaches a module, so it can never move its
// own record aside, and any rotation done from the bundle would run AFTER
// index.html had already overwritten the record it was meant to save. The
// first line of JS on the page moves the old record to BOOT_PREV_KEY and
// only then writes the fresh one; everything here just reads the result.
//
// The keys below are duplicated in index.html, which runs before any module
// can load and therefore cannot import them. breadcrumbs.test.ts fails if
// they drift, and it executes that block rather than a copy of it.

export const BOOT_KEY = "riwaq:boot:v1";
export const BOOT_PREV_KEY = "riwaq:boot:prev:v1";

/** The launch stages, in the order they must occur. */
export const BOOT_MARKS = ["html", "module", "render", "mounted"] as const;
export type BootMark = (typeof BOOT_MARKS)[number];

/** Just enough of the Storage interface to be injectable in tests. Nothing
 *  here ever deletes a key — the rotation in index.html overwrites both, so
 *  `removeItem` would be dead surface. */
export interface MarkStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BootRecord {
  /** Epoch ms of the first mark; every offset below is relative to it. */
  at: number;
  id: string;
  marks: Partial<Record<BootMark, number>>;
}

export interface LaunchVerdict {
  /** Did a frame actually reach the screen? */
  ok: boolean;
  /** The furthest stage this launch completed. */
  reached: BootMark | null;
  /** The stage it never completed — null when the launch was healthy. */
  stalledAt: BootMark | null;
  /** ms from the first mark to the last one recorded. */
  durationMs: number | null;
  at: number;
  marks: Partial<Record<BootMark, number>>;
}

function defaultStore(): MarkStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Storage can throw on access alone in some privacy modes.
    return null;
  }
}

function read(store: MarkStore, key: string): BootRecord | null {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BootRecord;
    if (!parsed || typeof parsed !== "object" || !parsed.marks) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Record that the launch reached `mark`.
 *
 * Must never throw: it runs on the boot path, and a diagnostic that can
 * break the launch it is measuring is worse than no diagnostic.
 */
export function markBoot(
  mark: BootMark,
  store: MarkStore | null = defaultStore(),
  now: () => number = Date.now,
): void {
  if (!store) return;
  try {
    const t = now();
    const existing = read(store, BOOT_KEY);
    const rec: BootRecord = existing ?? {
      at: t,
      id: `${t.toString(36)}`,
      marks: {},
    };
    rec.marks[mark] = t - rec.at;
    store.setItem(BOOT_KEY, JSON.stringify(rec));
  } catch {
    // Storage full, disabled, or throwing — the launch continues regardless.
  }
}

/** Turn a record into a verdict: how far it got, and where it died. */
export function classifyLaunch(rec: BootRecord | null): LaunchVerdict | null {
  if (!rec) return null;
  let reached: BootMark | null = null;
  let stalledAt: BootMark | null = null;
  for (const m of BOOT_MARKS) {
    if (rec.marks[m] !== undefined) {
      reached = m;
    } else {
      // The first gap is where it stopped. Later marks cannot be reached
      // without it, so there is nothing to look at past this point.
      stalledAt = m;
      break;
    }
  }
  const offsets = Object.values(rec.marks).filter(
    (n): n is number => typeof n === "number",
  );
  return {
    ok: stalledAt === null && reached === "mounted",
    reached,
    stalledAt,
    durationMs: offsets.length ? Math.max(...offsets) : null,
    at: rec.at,
    marks: rec.marks,
  };
}

/** The previous launch's verdict, for display and for the export bundle. */
export function readPreviousLaunch(
  store: MarkStore | null = defaultStore(),
): LaunchVerdict | null {
  if (!store) return null;
  return classifyLaunch(read(store, BOOT_PREV_KEY));
}
