// The session event buffer.
//
// This is lib/devLog.ts's machinery with the `import.meta.env.DEV` gate
// replaced by a tier check, so release builds record too. The cheap tier is
// plain objects and no DOM reads, which is what makes it safe to leave on
// for every user forever; the verbose tier carries devLog's geometry
// snapshot and stays behind a Settings switch because that walk costs a
// getComputedStyle per ancestor.

import { redactValue } from "./redact";

export type Tier = "cheap" | "verbose";

export interface DiagEvent {
  /** ms since the first event of this session. */
  t: number;
  kind: string;
  tier: Tier;
  data: unknown;
}

export interface Recorder {
  record(kind: string, data?: unknown, tier?: Tier): void;
  drain(): DiagEvent[];
  size(): number;
  setVerbose(on: boolean): void;
  isVerbose(): boolean;
}

/** Generous enough to cover a launch and a reading session, small enough
 *  that holding it costs nothing worth measuring. */
const DEFAULT_MAX = 2000;

export function createRecorder(opts?: {
  max?: number;
  now?: () => number;
}): Recorder {
  const max = opts?.max ?? DEFAULT_MAX;
  const now = opts?.now ?? Date.now;
  let events: DiagEvent[] = [];
  // `undefined` until the first event, rather than a `0` sentinel: a clock
  // that legitimately returns 0 on more than one of the first few calls
  // (e.g. performance.now() early in a session) would otherwise re-trigger
  // the "first event" branch and silently reset the origin.
  let started: number | undefined;
  let verbose = false;

  return {
    record(kind, data, tier = "cheap") {
      if (tier === "verbose" && !verbose) return;
      try {
        const t = now();
        if (started === undefined) started = t;
        events.push({
          t: t - started,
          kind,
          tier,
          data: data === undefined ? null : redactValue(data),
        });
        // Ring: drop from the front so the most recent history survives,
        // which is the half that explains what just went wrong.
        if (events.length > max) events.splice(0, events.length - max);
      } catch {
        // A diagnostic must never take the app down with it.
      }
    },
    drain() {
      const out = events;
      events = [];
      return out;
    },
    size() {
      return events.length;
    },
    setVerbose(on) {
      verbose = on;
    },
    isVerbose() {
      return verbose;
    },
  };
}

/** The app-wide instance. */
const shared = createRecorder();

export const record: Recorder["record"] = (kind, data, tier) =>
  shared.record(kind, data, tier);
export const drain: Recorder["drain"] = () => shared.drain();
export const setVerbose: Recorder["setVerbose"] = (on) => shared.setVerbose(on);
export const isVerbose: Recorder["isVerbose"] = () => shared.isVerbose();
