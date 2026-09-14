import { describe, expect, it } from "vitest";
import {
  BOOT_KEY,
  BOOT_PREV_KEY,
  classifyLaunch,
  markBoot,
  readPreviousLaunch,
  rotateBootRecord,
  type BootRecord,
  type MarkStore,
} from "./breadcrumbs";

function store(seed: Record<string, string> = {}): MarkStore & {
  data: Record<string, string>;
} {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

function rec(marks: BootRecord["marks"]): BootRecord {
  return { id: "s1", at: 1000, marks };
}

describe("classifyLaunch", () => {
  it("calls a launch that reached `mounted` healthy", () => {
    const v = classifyLaunch(
      rec({ html: 0, module: 40, render: 90, mounted: 210 }),
    )!;
    expect(v.ok).toBe(true);
    expect(v.reached).toBe("mounted");
    expect(v.stalledAt).toBe(null);
    expect(v.durationMs).toBe(210);
  });

  // The blank-launch signature: React was handed the tree and no frame
  // ever reached the screen.
  it("reports a blank launch that died between render and mounted", () => {
    const v = classifyLaunch(rec({ html: 0, module: 40, render: 90 }))!;
    expect(v.ok).toBe(false);
    expect(v.reached).toBe("render");
    expect(v.stalledAt).toBe("mounted");
  });

  it("reports a blank launch that never parsed the bundle", () => {
    const v = classifyLaunch(rec({ html: 0 }))!;
    expect(v.ok).toBe(false);
    expect(v.reached).toBe("html");
    expect(v.stalledAt).toBe("module");
  });

  it("reports a blank launch that parsed but never rendered", () => {
    const v = classifyLaunch(rec({ html: 0, module: 40 }))!;
    expect(v.ok).toBe(false);
    expect(v.reached).toBe("module");
    expect(v.stalledAt).toBe("render");
  });

  it("returns null for no previous launch", () => {
    expect(classifyLaunch(null)).toBe(null);
  });
});

describe("markBoot", () => {
  it("accumulates marks into one record with offsets from the first", () => {
    const s = store();
    markBoot("html", s, () => 1000);
    markBoot("module", s, () => 1100);
    const saved = JSON.parse(s.data[BOOT_KEY]) as BootRecord;
    expect(saved.at).toBe(1000);
    expect(saved.marks).toEqual({ html: 0, module: 100 });
  });

  it("never throws when storage is unavailable", () => {
    const broken: MarkStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => markBoot("html", broken, () => 1)).not.toThrow();
  });
});

describe("rotateBootRecord", () => {
  it("moves the current record to prev and starts a fresh one", () => {
    const s = store();
    markBoot("html", s, () => 1000);
    markBoot("module", s, () => 1100);
    const prev = rotateBootRecord(s, () => 2000);
    expect(prev?.marks).toEqual({ html: 0, module: 100 });
    expect(s.data[BOOT_PREV_KEY]).toBeDefined();
    expect(s.data[BOOT_KEY]).toBeUndefined();
  });

  it("survives a corrupt record", () => {
    const s = store({ [BOOT_KEY]: "{{{not json" });
    expect(() => rotateBootRecord(s, () => 2000)).not.toThrow();
    expect(rotateBootRecord(s, () => 2000)).toBe(null);
  });
});

describe("readPreviousLaunch", () => {
  it("classifies the rotated-out record", () => {
    const s = store();
    markBoot("html", s, () => 1000);
    markBoot("module", s, () => 1040);
    markBoot("render", s, () => 1090);
    rotateBootRecord(s, () => 5000);
    const v = readPreviousLaunch(s);
    expect(v?.ok).toBe(false);
    expect(v?.stalledAt).toBe("mounted");
  });
});
