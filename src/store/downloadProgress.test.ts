import { beforeEach, describe, expect, it } from "vitest";
import {
  burstPct,
  endBurst,
  getDownloadProgress,
  rebaseBurst,
  reportBurst,
  subscribeDownloadProgress,
} from "./downloadProgress";

beforeEach(() => {
  endBurst();
});

describe("burstPct", () => {
  it("measures the whole burst, not the chapter in flight", () => {
    // The bug: with 2 workers, every running chapter sits near the
    // start of its own 0..1 life, so averaging just the running jobs
    // pinned the readout at ~4% no matter how much of the queue was
    // already done.
    const runningPartials = [0.05, 0.02];
    const averageOfRunning = (0.05 + 0.02) / 2;
    expect(Math.round(averageOfRunning * 100)).toBe(4);

    const partial = runningPartials.reduce((a, b) => a + b, 0);
    expect(burstPct(0, partial, 200)).toBe(0);
    expect(burstPct(40, partial, 200)).toBe(20);
    expect(burstPct(150, partial, 200)).toBe(75);
  });

  it("still moves for a lone chapter, where nothing has resolved yet", () => {
    expect(burstPct(0, 0.05, 1)).toBe(5);
    expect(burstPct(0, 0.35, 1)).toBe(35);
    expect(burstPct(0, 0.95, 1)).toBe(95);
  });

  it("stays inside 0..100 and tolerates an empty burst", () => {
    expect(burstPct(0, 0, 0)).toBe(0);
    expect(burstPct(5, 0, 3)).toBe(100);
    expect(burstPct(-1, 0, 4)).toBe(0);
  });
});

describe("reportBurst", () => {
  it("never ticks backward when a chapter finishes and the next restarts", () => {
    // 10 chapters, one worker. The running chapter climbs to 0.95,
    // resolves, and the next starts over at 0.02 — the readout must
    // not fall back.
    const seen: number[] = [];
    seen.push(reportBurst({ active: 10, resolved: 0, partial: 0.95, total: 10 }));
    seen.push(reportBurst({ active: 9, resolved: 1, partial: 0.02, total: 10 }));
    seen.push(reportBurst({ active: 9, resolved: 1, partial: 0.35, total: 10 }));
    expect(seen).toEqual([10, 10, 14]);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
  });

  it("holds the high-water mark while active, and lets a new burst start over", () => {
    reportBurst({ active: 4, resolved: 2, partial: 0, total: 4 });
    expect(getDownloadProgress().pct).toBe(50);
    rebaseBurst();
    expect(reportBurst({ active: 8, resolved: 0, partial: 0.1, total: 8 })).toBe(1);
  });

  it("does not raise the high-water mark once the burst has settled", () => {
    reportBurst({ active: 4, resolved: 2, partial: 0, total: 4 });
    // Terminal emission: every job resolved, nothing active.
    reportBurst({ active: 0, resolved: 4, partial: 0, total: 4 });
    // A burst that resumes without a summary having been shown must
    // not inherit 100%.
    expect(reportBurst({ active: 2, resolved: 2, partial: 0, total: 4 })).toBe(50);
  });

  it("publishes the reading to subscribers", () => {
    const seen: number[] = [];
    const off = subscribeDownloadProgress((p) => seen.push(p.pct));
    reportBurst({ active: 4, resolved: 1, partial: 0, total: 4 });
    reportBurst({ active: 4, resolved: 1, partial: 0, total: 4 });
    reportBurst({ active: 3, resolved: 2, partial: 0, total: 4 });
    off();
    reportBurst({ active: 2, resolved: 3, partial: 0, total: 4 });
    // Duplicate readings don't re-notify; nothing lands after unsubscribe.
    expect(seen).toEqual([25, 50]);
    expect(getDownloadProgress()).toMatchObject({ active: 2, resolved: 3, total: 4, pct: 75 });
  });

  it("clears to idle when the burst ends", () => {
    reportBurst({ active: 4, resolved: 3, partial: 0, total: 4 });
    endBurst();
    expect(getDownloadProgress()).toEqual({ active: 0, resolved: 0, total: 0, pct: 0 });
  });
});
