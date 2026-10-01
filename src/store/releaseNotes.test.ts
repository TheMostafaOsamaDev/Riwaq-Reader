import { describe, expect, it } from "vitest";
import { parseReleaseNotes, pick } from "./releaseNotes";

const item = (kind: string, en = "a", ar = "ب") => ({ kind, en, ar });

describe("parseReleaseNotes", () => {
  it("keeps good items and drops malformed ones instead of failing", () => {
    // A running app must never crash on a slightly-off file; the release
    // validator is where strictness lives.
    const n = parseReleaseNotes({
      version: "0.6.0",
      date: "2026-10-15",
      items: [item("new"), item("feature"), { kind: "fixed" }, item("fixed")],
    });
    expect(n?.items.map((i) => i.kind)).toEqual(["new", "fixed"]);
  });
  it("is null with no usable items or no version", () => {
    expect(parseReleaseNotes({ version: "0.6.0", items: [] })).toBeNull();
    expect(parseReleaseNotes({ items: [item("new")] })).toBeNull();
    expect(parseReleaseNotes("<!DOCTYPE html>")).toBeNull();
  });
  it("drops a highlight or story missing either language", () => {
    const n = parseReleaseNotes({
      version: "0.6.0",
      date: "x",
      highlight: { title: { en: "t" }, body: { en: "b", ar: "ب" } },
      stories: [{ title: { en: "t", ar: "ت" }, body: { en: "b", ar: "ب" } }],
      items: [item("new")],
    });
    expect(n?.highlight).toBeUndefined();
    expect(n?.stories).toHaveLength(1);
  });
});

describe("pick", () => {
  it("falls back to English when the locale's string is empty", () => {
    expect(pick({ en: "Hi", ar: "" }, "ar")).toBe("Hi");
    expect(pick({ en: "Hi", ar: "أهلا" }, "ar")).toBe("أهلا");
  });
});
