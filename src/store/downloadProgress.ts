// Shared "how far along is the current download burst" reading.
//
// A burst is one continuous stretch of queue activity: it opens when
// work starts arriving on an idle queue and closes when the queue
// drains. Both the system notification and the in-app Downloads pill
// have to answer the same question about it, and they must answer it
// with the same number — a tray notification reading 60% next to a
// sidebar reading 4% is its own bug.
//
// The number is a fraction of the BURST, not of the job in flight.
// Averaging the running jobs' own 0..1 progress is the trap: with
// bounded worker concurrency there are only ever a couple of running
// jobs, each one restarts near zero the moment its predecessor
// resolves, and the average therefore sits near the low end of a
// single chapter's life forever — the readout parks around 4%,
// twitches upward, and drops straight back however much of the queue
// is already on disk.
//
// So: resolved jobs count whole, the jobs in flight contribute their
// fraction, and the total is the burst's high-water job count. The
// partial term keeps a lone chapter's download moving (it would
// otherwise read 0% until the instant it finished); the per-burst
// high-water clamp keeps the readout from ever ticking backward when
// a job's partial progress is handed off to a fresh job at zero.
//
// The notifier owns burst accounting (it's the module that knows when
// a burst begins and ends) and feeds this store; everyone else reads.

/** Where the current burst stands. `pct` is the display number: 0..100,
 *  monotone for as long as the burst is active. */
export interface DownloadProgress {
  /** Jobs queued or running right now. An active import counts as one. */
  active: number;
  /** Jobs resolved — done, failed, or cancelled — since the burst began. */
  resolved: number;
  /** Denominator: the burst's high-water count of active + resolved. */
  total: number;
  /** 0..100, clamped to the burst's high-water mark. */
  pct: number;
}

/** One reading of the queue, before the high-water clamp is applied. */
export interface BurstReading {
  active: number;
  resolved: number;
  /** Summed 0..1 progress of everything currently in flight. */
  partial: number;
  total: number;
}

const IDLE: DownloadProgress = { active: 0, resolved: 0, total: 0, pct: 0 };

let current: DownloadProgress = IDLE;
let maxPct = 0;
const listeners = new Set<(p: DownloadProgress) => void>();

/**
 * Raw burst percentage: resolved jobs whole, in-flight jobs by fraction,
 * over the burst total. Clamped to 0..100 — `resolved` comes from
 * eviction-proof lifetime counters minus a per-burst baseline, so a
 * clearTerminals() racing a rebase can briefly overshoot the total.
 */
export function burstPct(resolved: number, partial: number, total: number): number {
  if (total <= 0) return 0;
  const raw = ((resolved + partial) / total) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function getDownloadProgress(): DownloadProgress {
  return current;
}

export function subscribeDownloadProgress(
  fn: (p: DownloadProgress) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Publish one reading and return the percentage to display.
 *
 * The high-water clamp only rises while the burst is active. A settled
 * burst (nothing active) reports its true standing without pinning the
 * mark at 100 — otherwise a burst that resumed before its completion
 * summary landed would inherit "100%" and stay there.
 */
export function reportBurst(reading: BurstReading): number {
  const raw = burstPct(reading.resolved, reading.partial, reading.total);
  let pct = raw;
  if (reading.active > 0) {
    if (raw > maxPct) maxPct = raw;
    pct = maxPct;
  }
  const next: DownloadProgress = {
    active: reading.active,
    resolved: reading.resolved,
    total: reading.total,
    pct,
  };
  if (
    next.active !== current.active ||
    next.resolved !== current.resolved ||
    next.total !== current.total ||
    next.pct !== current.pct
  ) {
    current = next;
    for (const fn of listeners) fn(next);
  }
  return pct;
}

/** A fresh burst is starting on top of a finished one: drop the
 *  high-water mark so the new burst climbs from its own zero. */
export function rebaseBurst(): void {
  maxPct = 0;
}

/** The queue went fully idle. Clear the reading so the UI stops
 *  showing a stale percentage. */
export function endBurst(): void {
  maxPct = 0;
  if (current !== IDLE) {
    current = IDLE;
    for (const fn of listeners) fn(IDLE);
  }
}
