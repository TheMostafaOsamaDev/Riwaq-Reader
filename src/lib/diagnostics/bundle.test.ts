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
    expect(out).toContain("render");
    expect(out).toContain("mounted");
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
});

describe("bundleFileName", () => {
  it("dates the file so several exports can coexist", () => {
    expect(bundleFileName(new Date("2026-09-14T10:00:00Z"))).toBe(
      "riwaq-diagnostics-2026-09-14.txt",
    );
  });
});
