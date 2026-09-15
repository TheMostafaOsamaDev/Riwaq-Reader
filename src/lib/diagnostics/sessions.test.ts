import { describe, expect, it } from "vitest";
import {
  nextSessionNumber,
  parseSessionNumber,
  sessionFileName,
  sessionsToDelete,
  sortSessions,
} from "./sessions";

describe("session file naming", () => {
  it("names a session file by its number", () => {
    expect(sessionFileName(7)).toBe("session-7.jsonl");
  });

  it("parses the number back out", () => {
    expect(parseSessionNumber("session-7.jsonl")).toBe(7);
  });

  it("ignores files that are not session logs", () => {
    expect(parseSessionNumber("reader-debug.log")).toBe(null);
    expect(parseSessionNumber("session-.jsonl")).toBe(null);
  });
});

describe("nextSessionNumber", () => {
  it("starts at 1 on a fresh install", () => {
    expect(nextSessionNumber([])).toBe(1);
  });

  it("continues past the highest existing number", () => {
    expect(
      nextSessionNumber(["session-1.jsonl", "session-9.jsonl", "junk.txt"]),
    ).toBe(10);
  });
});

describe("retention", () => {
  it("keeps nothing to delete while under the cap", () => {
    expect(
      sessionsToDelete([
        "session-1.jsonl",
        "session-2.jsonl",
        "session-3.jsonl",
      ]),
    ).toEqual([]);
  });

  it("deletes the oldest past the cap of 3", () => {
    const existing = [
      "session-1.jsonl",
      "session-2.jsonl",
      "session-3.jsonl",
      "session-4.jsonl",
      "session-5.jsonl",
    ];
    expect(sessionsToDelete(existing)).toEqual([
      "session-1.jsonl",
      "session-2.jsonl",
    ]);
  });

  it("sorts numerically, not lexically", () => {
    // "session-10" sorts before "session-9" as a string, which would delete
    // the wrong file every time the count crosses ten.
    expect(sortSessions(["session-10.jsonl", "session-9.jsonl"])).toEqual([
      "session-9.jsonl",
      "session-10.jsonl",
    ]);
  });

  it("ignores unrelated files when deciding what to delete", () => {
    expect(sessionsToDelete(["notes.txt", "session-1.jsonl"])).toEqual([]);
  });
});
