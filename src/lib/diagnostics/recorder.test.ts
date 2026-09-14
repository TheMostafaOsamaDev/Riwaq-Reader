import { describe, expect, it } from "vitest";
import { createRecorder } from "./recorder";

describe("createRecorder", () => {
  it("records cheap-tier events by default", () => {
    const r = createRecorder({ now: () => 0 });
    r.record("nav", { to: "library" });
    expect(r.size()).toBe(1);
    expect(r.drain()[0].kind).toBe("nav");
  });

  it("drops verbose events while the verbose tier is off", () => {
    const r = createRecorder({ now: () => 0 });
    r.record("geometry", { huge: true }, "verbose");
    expect(r.size()).toBe(0);
  });

  it("keeps verbose events once the tier is on", () => {
    const r = createRecorder({ now: () => 0 });
    r.setVerbose(true);
    r.record("geometry", { huge: true }, "verbose");
    expect(r.size()).toBe(1);
  });

  it("evicts the oldest event past the cap", () => {
    const r = createRecorder({ max: 3, now: () => 0 });
    for (const k of ["a", "b", "c", "d"]) r.record(k);
    const kinds = r.drain().map((e) => e.kind);
    expect(kinds).toEqual(["b", "c", "d"]);
  });

  it("redacts payloads as they are recorded, not at drain", () => {
    const r = createRecorder({ now: () => 0 });
    r.record("open", { title: "The Mad Priest" });
    const data = r.drain()[0].data as Record<string, unknown>;
    expect(data.title).toMatch(/^t:/);
  });

  it("stamps each event with an offset from the first", () => {
    let t = 1000;
    const r = createRecorder({ now: () => t });
    r.record("a");
    t = 1250;
    r.record("b");
    const [a, b] = r.drain();
    expect(a.t).toBe(0);
    expect(b.t).toBe(250);
  });

  it("empties the buffer on drain, so a flush cannot double-write", () => {
    const r = createRecorder({ now: () => 0 });
    r.record("a");
    r.drain();
    expect(r.size()).toBe(0);
  });

  it("never throws on an unserialisable payload", () => {
    const r = createRecorder({ now: () => 0 });
    expect(() => r.record("weird", { fn: () => 1 })).not.toThrow();
  });

  it("keeps correct offsets when the clock legitimately starts at 0", () => {
    // A `0 === 0` sentinel for "not yet started" is ambiguous with a clock
    // that legitimately returns 0 on more than one of the first few calls
    // (e.g. performance.now() early in a session). If the recorder used a
    // bare `started === 0` check, the second event here would re-trigger
    // the "first event" branch and silently reset the origin.
    let t = 0;
    const r = createRecorder({ now: () => t });
    r.record("a"); // t=0 -> offset 0, and establishes the origin
    r.record("b"); // t=0 -> offset 0, must NOT re-establish the origin
    t = 5;
    r.record("c"); // t=5 -> offset 5 from the true origin (0)
    const [a, b, c] = r.drain();
    expect(a.t).toBe(0);
    expect(b.t).toBe(0);
    expect(c.t).toBe(5);
  });
});
