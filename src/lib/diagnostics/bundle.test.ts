import { describe, expect, it } from "vitest";
import type { LaunchVerdict } from "./breadcrumbs";
import { buildBundle, bundleFileName, type BundleInput } from "./bundle";

const healthy: LaunchVerdict = {
  ok: true,
  reached: "mounted",
  stalledAt: null,
  durationMs: 210,
  at: 1_700_000_000_000,
  marks: { html: 0, module: 40, render: 90, mounted: 210 },
};

const blank: LaunchVerdict = {
  ok: false,
  reached: "render",
  stalledAt: "mounted",
  durationMs: 90,
  at: 1_700_000_000_000,
  marks: { html: 0, module: 40, render: 90 },
};

// Deliberately the reverse of `blank`'s reached/stalledAt pair, so a test
// that merely greps for the word "render" or "mounted" anywhere in the
// output (present regardless, via the per-mark timeline) can't pass by
// accident — only checking the composed head sentence catches a swap.
const stalledEarlier: LaunchVerdict = {
  ok: false,
  reached: "module",
  stalledAt: "render",
  durationMs: 40,
  at: 1_700_000_000_000,
  marks: { html: 0, module: 40 },
};

const nothingRecorded: LaunchVerdict = {
  ok: false,
  reached: null,
  stalledAt: "html",
  durationMs: null,
  at: 1_700_000_000_000,
  marks: {},
};

function input(over: Partial<BundleInput> = {}): BundleInput {
  return {
    app: { version: "0.3.0", platform: "android", ua: "Mozilla/5.0 (…)" },
    verbose: false,
    launches: [healthy],
    sessions: [],
    ...over,
  };
}

describe("buildBundle", () => {
  it("leads with the app header so the reader knows the build", () => {
    const out = buildBundle(input());
    expect(out).toContain("Riwaq diagnostics");
    expect(out).toContain("0.3.0");
    expect(out).toContain("android");
  });

  it("states plainly when a launch failed to reach the screen", () => {
    const out = buildBundle(input({ launches: [blank] }));
    expect(out).toContain("BLANK LAUNCH");
    // The per-mark timeline below always prints every BOOT_MARKS name
    // ("render", "mounted", ...) regardless of the verdict, so asserting
    // those words appear anywhere would pass even if the head sentence
    // were wrong. Assert the composed head clause itself, contiguously.
    expect(out).toContain(
      "BLANK LAUNCH: reached render, never reached mounted",
    );
  });

  it("does not mix up which stage was reached vs. which was never reached", () => {
    // reached "module" / stalledAt "render" — the reverse pairing of
    // `blank` above. A swap bug (reached <-> stalledAt) would make this
    // print "reached render, ..." instead.
    const out = buildBundle(input({ launches: [stalledEarlier] }));
    expect(out).toContain("BLANK LAUNCH: reached module, never reached render");
    expect(out).not.toContain("BLANK LAUNCH: reached render,");
  });

  it("says so when every recorded launch was healthy", () => {
    const out = buildBundle(input());
    expect(out).not.toContain("BLANK LAUNCH");
    expect(out).toContain("reached mounted");
  });

  it("renders the mark timeline with offsets", () => {
    const out = buildBundle(input());
    expect(out).toContain("html +0ms");
    expect(out).toContain("mounted +210ms");
  });

  it("includes session log lines verbatim", () => {
    const out = buildBundle(
      input({
        sessions: [
          { name: "session-2.jsonl", lines: ['{"t":0,"kind":"nav"}'] },
        ],
      }),
    );
    expect(out).toContain("session-2.jsonl");
    expect(out).toContain('{"t":0,"kind":"nav"}');
  });

  it("notes when detailed diagnostics were off, so a thin log is explained", () => {
    expect(buildBundle(input())).toContain("detailed diagnostics: off");
  });

  it("produces something readable with no data at all", () => {
    const out = buildBundle(input({ launches: [], sessions: [] }));
    expect(out).toContain("Riwaq diagnostics");
    expect(out).toContain("no launches recorded");
  });

  it("prints 'reached nothing' rather than the literal null for a launch that recorded nothing", () => {
    const out = buildBundle(input({ launches: [nothingRecorded] }));
    expect(out).toContain("BLANK LAUNCH: reached nothing, never reached html");
    expect(out).not.toContain("null");
  });

  it("summarizes blank-launch count in the header so it's visible at a glance in a long export", () => {
    const out = buildBundle(
      input({ launches: [blank, healthy, stalledEarlier] }),
    );
    expect(out).toContain("launches: 3 recorded, 2 blank");
    expect(out).toContain("*** 2 OF 3 LAUNCHES FAILED TO REACH THE SCREEN ***");
  });

  it("omits the shouting summary line when every launch was healthy", () => {
    const out = buildBundle(input({ launches: [healthy, healthy] }));
    expect(out).toContain("launches: 2 recorded, 0 blank");
    expect(out).not.toContain("***");
  });
});

// Only one previous boot record is retained (index.html keeps depth 1), and
// SettingsPage passes `readPreviousLaunch()` alone — so `launches` holds 0 or
// 1 entry. Launch blank, relaunch, relaunch again, then export: the live
// verdict is the healthy middle launch, while the blank one survives only as
// the `previousLaunchBlank` event the middle launch wrote into its session
// file. The evidence is already inside the bundle; before this the summary
// could not see it and said "0 blank" directly above it.
describe("buildBundle — blank launches recorded only in the session logs", () => {
  const blankEvent = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      t: 12,
      kind: "previousLaunchBlank",
      tier: "cheap",
      data: {
        reached: "render",
        stalledAt: "mounted",
        durationMs: 90,
        ...over,
      },
    });

  it("surfaces the banner even when the live verdict is healthy", () => {
    const out = buildBundle(
      input({
        launches: [healthy],
        sessions: [{ name: "session-3.jsonl", lines: [blankEvent()] }],
      }),
    );
    expect(out).toContain(
      "launches: 1 recorded, 0 blank (+1 more blank in the retained session logs)",
    );
    expect(out).toContain(
      "*** 1 BLANK LAUNCH — 0 OF THE 1 RECORDED BELOW, 1 MORE REPORTED IN THE RETAINED SESSION LOGS ***",
    );
  });

  it("says where each blank launch came from when both sources have one", () => {
    const out = buildBundle(
      input({
        launches: [stalledEarlier],
        sessions: [{ name: "session-3.jsonl", lines: [blankEvent()] }],
      }),
    );
    expect(out).toContain(
      "*** 2 BLANK LAUNCHES — 1 OF THE 1 RECORDED BELOW, 1 MORE REPORTED IN THE RETAINED SESSION LOGS ***",
    );
  });

  // The current session logs a `previousLaunchBlank` built from the SAME boot
  // record `readPreviousLaunch()` returns, so in the ordinary case the two
  // describe ONE launch. Counting both would replace an under-report with an
  // over-report.
  it("does not count the live verdict twice when the current session logged it", () => {
    const out = buildBundle(
      input({
        launches: [blank],
        sessions: [{ name: "session-4.jsonl", lines: [blankEvent()] }],
      }),
    );
    expect(out).toContain("launches: 1 recorded, 1 blank");
    expect(out).not.toContain("retained session logs");
    expect(out).toContain("*** 1 OF 1 LAUNCHES FAILED TO REACH THE SCREEN ***");
  });

  it("still counts a logged blank that is not the live one", () => {
    const out = buildBundle(
      input({
        launches: [blank],
        sessions: [
          {
            name: "session-4.jsonl",
            lines: [blankEvent(), blankEvent({ stalledAt: "render" })],
          },
        ],
      }),
    );
    expect(out).toContain("*** 2 BLANK LAUNCHES —");
  });

  it("ignores a healthy session log and a half-written tail line", () => {
    const out = buildBundle(
      input({
        launches: [healthy],
        sessions: [
          {
            name: "session-3.jsonl",
            lines: ['{"t":0,"kind":"nav","data":{}}', '{"kind":"previousLau'],
          },
        ],
      }),
    );
    expect(out).toContain("launches: 1 recorded, 0 blank");
    expect(out).not.toContain("***");
  });
});

describe("bundleFileName", () => {
  it("dates the file so several exports can coexist", () => {
    expect(bundleFileName(new Date("2026-09-14T10:00:00Z"))).toBe(
      "riwaq-diagnostics-2026-09-14.txt",
    );
  });
});
