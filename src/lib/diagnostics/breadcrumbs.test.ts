import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOOT_KEY,
  BOOT_PREV_KEY,
  classifyLaunch,
  markBoot,
  readPreviousLaunch,
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

  it("reports a launch that recorded nothing at all", () => {
    const v = classifyLaunch(rec({}))!;
    expect(v.ok).toBe(false);
    expect(v.reached).toBe(null);
    expect(v.stalledAt).toBe("html");
    expect(v.durationMs).toBe(null);
  });

  // A mark past a gap is meaningless — the stages are strictly ordered, so
  // `render` without `module` means the record is damaged, not that the
  // launch skipped a stage. The first gap is still the answer.
  it("ignores marks recorded past a gap", () => {
    const v = classifyLaunch(rec({ html: 0, render: 90 }))!;
    expect(v.reached).toBe("html");
    expect(v.stalledAt).toBe("module");
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

/**
 * index.html's breadcrumb block, lifted out of the file and run for real.
 *
 * The rotation happens in index.html and nowhere else — it has to, because a
 * launch that stalls never reaches a module, so nothing written in JS would
 * ever run to move the record aside. That makes index.html the only place
 * this behaviour exists, and re-implementing it here would test a copy
 * instead of the shipped code: the bug this guards against (an unconditional
 * overwrite destroying the stalled launch's record, unread) lived in the
 * HTML while every hand-built classifyLaunch test below stayed green.
 *
 * Unlike styles/bootTheme.test.ts, which regex-reads the colour literals,
 * the claim here is about behaviour across two launches, and only executing
 * it can check that.
 */
function runIndexHtmlBootBlock(s: MarkStore): void {
  const html = readFileSync("index.html", "utf8");
  const block = html.match(
    /\/\/ Boot breadcrumb 1 of 4[\s\S]*?\n(\s*)\} catch \(e\) \{[\s\S]*?\n\1\}/,
  );
  if (!block) throw new Error("boot breadcrumb block not found in index.html");
  new Function("localStorage", block[0])(s);
}

describe("cross-launch rotation", () => {
  // The sequence the whole feature exists for, driven end to end rather than
  // asserted against a record built by hand.
  it("hands a stalled launch's record to the launch after it", () => {
    const s = store();
    // Launch N: reached render, then the bridge stalled and no frame ever
    // arrived, so `mounted` is never written and nothing rotates it.
    markBoot("html", s, () => 1000);
    markBoot("module", s, () => 1040);
    markBoot("render", s, () => 1090);

    // Launch N+1, first line of JS on the page.
    runIndexHtmlBootBlock(s);

    const v = readPreviousLaunch(s);
    expect(v?.ok).toBe(false);
    expect(v?.reached).toBe("render");
    expect(v?.stalledAt).toBe("mounted");

    // ...and the new launch starts from a clean record of its own.
    const fresh = JSON.parse(s.data[BOOT_KEY]) as BootRecord;
    expect(fresh.marks).toEqual({ html: 0 });
  });

  it("reports a healthy previous launch as healthy", () => {
    const s = store();
    markBoot("html", s, () => 1000);
    markBoot("module", s, () => 1040);
    markBoot("render", s, () => 1090);
    markBoot("mounted", s, () => 1210);

    runIndexHtmlBootBlock(s);

    const v = readPreviousLaunch(s);
    expect(v?.ok).toBe(true);
    expect(v?.reached).toBe("mounted");
    expect(v?.durationMs).toBe(210);
  });

  it("has nothing to report on a first-ever launch", () => {
    const s = store();
    runIndexHtmlBootBlock(s);
    expect(s.data[BOOT_PREV_KEY]).toBeUndefined();
    expect(readPreviousLaunch(s)).toBe(null);
  });

  it("keeps only the immediately previous launch", () => {
    const s = store();
    markBoot("html", s, () => 1000);
    runIndexHtmlBootBlock(s); // launch 2 rotates launch 1 (stalled at module)
    markBoot("module", s, () => 2000);
    markBoot("render", s, () => 2010);
    markBoot("mounted", s, () => 2020);
    runIndexHtmlBootBlock(s); // launch 3 rotates launch 2 (healthy)
    expect(readPreviousLaunch(s)?.ok).toBe(true);
  });

  it("survives a corrupt record rather than losing the launch", () => {
    const s = store({ [BOOT_KEY]: "{{{not json" });
    expect(() => runIndexHtmlBootBlock(s)).not.toThrow();
    // The corrupt blob is moved aside verbatim and classified as unreadable
    // (null), which is the same answer as "no previous launch".
    expect(readPreviousLaunch(s)).toBe(null);
    expect(s.data[BOOT_KEY]).toContain('"html":0');
  });
});

describe("index.html mirror", () => {
  // index.html runs before any module can load, so it writes the boot mark
  // with a hardcoded key. If that key and BOOT_KEY drift, the first mark is
  // silently orphaned and every launch looks like it died before `html`.
  it("uses the same storage key as breadcrumbs.ts", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain(BOOT_KEY);
  });

  // Same hazard for the rotation target: a drifted prev key means every
  // launch reads "no previous launch" and the blank-launch report is empty.
  it("uses the same prev-record key as breadcrumbs.ts", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain(BOOT_PREV_KEY);
  });

  // Order matters more than presence: reading the old record AFTER writing
  // the new one would hand every launch its own marks back.
  it("saves the old record before overwriting it", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html.indexOf(BOOT_PREV_KEY)).toBeLessThan(
      html.lastIndexOf(BOOT_KEY),
    );
  });

  it("writes the html mark before the bundle loads", () => {
    const html = readFileSync("index.html", "utf8");
    const markAt = html.indexOf(BOOT_KEY);
    const bundleAt = html.indexOf("/src/main.tsx");
    expect(markAt).toBeGreaterThan(-1);
    expect(markAt).toBeLessThan(bundleAt);
  });
});
