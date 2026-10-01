import { describe, expect, it } from "vitest";
import {
  IMAGE_CAP,
  validateReleaseNotes,
} from "../../scripts/release-notes.mjs";

const ok = () => ({
  version: "0.6.0",
  date: "2026-10-15",
  highlight: {
    image: "0.6.0-cards.webp",
    title: { en: "Make the library yours", ar: "اجعل المكتبة على ذوقك" },
    body: { en: "Four styles.", ar: "أربعة أنماط." },
  },
  items: [
    {
      kind: "new",
      en: "Updates install inside the app",
      ar: "التحديثات داخل التطبيق",
    },
    { kind: "fixed", en: "No double import", ar: "لا استيراد مزدوج" },
  ],
});
const sizes = (m: Record<string, number>) => (n: string) => m[n];
const run = (
  n: unknown,
  img: Record<string, number> = { "0.6.0-cards.webp": 1000 },
) => validateReleaseNotes(n, { version: "0.6.0", imageBytes: sizes(img) });

describe("validateReleaseNotes", () => {
  it("accepts a well-formed file", () => {
    expect(run(ok())).toEqual([]);
  });
  it("rejects a version that disagrees with the file name", () => {
    expect(run({ ...ok(), version: "0.6.1" })).toContainEqual(
      expect.stringContaining("version"),
    );
  });
  it("rejects a line with no Arabic", () => {
    const n = ok();
    n.items[0].ar = "";
    expect(run(n).join()).toMatch(/items\[0\]\.ar/);
  });
  it("rejects English pasted into the Arabic field", () => {
    const n = ok();
    n.items[1].ar = "No double import";
    expect(run(n).join()).toMatch(/items\[1\]\.ar.*Arabic/);
  });
  it("rejects an unknown kind and unknown keys", () => {
    const n = ok() as Record<string, unknown>;
    (n.items as Record<string, unknown>[])[0].kind = "feature";
    n.extra = 1;
    const errs = run(n).join("\n");
    expect(errs).toMatch(/kind/);
    expect(errs).toMatch(/extra/);
  });
  it("rejects a missing or oversized image", () => {
    expect(run(ok(), {}).join()).toMatch(/0\.6\.0-cards\.webp.*missing/);
    expect(run(ok(), { "0.6.0-cards.webp": IMAGE_CAP + 1 }).join()).toMatch(
      /150 KB/,
    );
  });
  it("rejects an empty items list and a bad date", () => {
    expect(run({ ...ok(), items: [] }).join()).toMatch(/items/);
    expect(run({ ...ok(), date: "15/10/2026" }).join()).toMatch(/date/);
  });
  it("rejects non-object items and returns an array", () => {
    const errs = run({ ...ok(), items: [null] });
    expect(Array.isArray(errs)).toBe(true);
    expect(errs.join()).toMatch(/items\[0\]/);
  });
});
