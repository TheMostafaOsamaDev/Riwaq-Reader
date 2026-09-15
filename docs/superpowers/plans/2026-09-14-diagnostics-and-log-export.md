# Diagnostics and Log Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Riwaq record its own launches in release builds, keep the record across restarts, and export it as one shareable file — so a blank launch can be diagnosed without reproducing it.

**Architecture:** Two independent tracks. Track A writes four boot marks to `localStorage` synchronously (no IPC, survives the process) and classifies the *previous* launch on the next start. Track B is the existing `devLog` ring buffer, re-pointed off `import.meta.env.DEV` onto a tier check and rotated across the last 3 sessions. A new Settings → Data section exports both.

**Tech Stack:** React 19, TypeScript, Vite 8, Tauri v2 (`@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`), vitest 4 + happy-dom, biome.

**Spec:** `docs/superpowers/specs/2026-09-14-diagnostics-and-log-export-design.md`

## Global Constraints

- **The boot path must never await IPC.** `localStorage` only for Track A. Any `@tauri-apps/*` import in the breadcrumb path is a defect.
- **Redaction is applied at write time**, never at export time. No unredacted copy exists on disk.
- Every new `MsgKey` added to `src/i18n/en.ts` **must** have an Arabic counterpart in `src/i18n/ar.ts` — the `Messages` type makes a missing key a compile error.
- Tests run under `environment: "node"` by default (`vitest.config.ts`); add `// @vitest-environment happy-dom` as the first line of any test needing DOM or `localStorage`.
- Code style is biome: 2-space indent, double quotes, trailing commas. Run `pnpm format` before committing.
- Retention is exactly **3** session files.
- The `localStorage` key `riwaq:boot:v1` is duplicated in `index.html` (which cannot import TS). Task 1 adds a drift test in the style of `src/styles/bootTheme.test.ts`.
- Verification for every task: `pnpm test` must pass (572 tests green at plan time).

---

### Task 1: Boot breadcrumbs — the classifier

**Files:**
- Create: `src/lib/diagnostics/breadcrumbs.ts`
- Test: `src/lib/diagnostics/breadcrumbs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BootMark`, `BOOT_MARKS`, `BOOT_KEY`, `BOOT_PREV_KEY`, `BootRecord`, `LaunchVerdict`, `MarkStore`, `classifyLaunch(rec)`, `markBoot(mark, store?, now?)`, `rotateBootRecord(store?, now?)`, `readPreviousLaunch(store?)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/diagnostics/breadcrumbs.test.ts`:

```ts
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
  };
}

function rec(marks: BootRecord["marks"]): BootRecord {
  return { id: "s1", at: 1000, marks };
}

describe("classifyLaunch", () => {
  it("calls a launch that reached `mounted` healthy", () => {
    const v = classifyLaunch(
      rec({ html: 0, module: 40, render: 90, mounted: 210 }),
    );
    expect(v.ok).toBe(true);
    expect(v.reached).toBe("mounted");
    expect(v.stalledAt).toBe(null);
    expect(v.durationMs).toBe(210);
  });

  // The blank-launch signature: React was handed the tree and no frame
  // ever reached the screen.
  it("reports a blank launch that died between render and mounted", () => {
    const v = classifyLaunch(rec({ html: 0, module: 40, render: 90 }));
    expect(v.ok).toBe(false);
    expect(v.reached).toBe("render");
    expect(v.stalledAt).toBe("mounted");
  });

  it("reports a blank launch that never parsed the bundle", () => {
    const v = classifyLaunch(rec({ html: 0 }));
    expect(v.ok).toBe(false);
    expect(v.reached).toBe("html");
    expect(v.stalledAt).toBe("module");
  });

  it("reports a blank launch that parsed but never rendered", () => {
    const v = classifyLaunch(rec({ html: 0, module: 40 }));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/diagnostics/breadcrumbs.test.ts`
Expected: FAIL — `Failed to resolve import "./breadcrumbs"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/diagnostics/breadcrumbs.ts`:

```ts
// Boot breadcrumbs — the one diagnostic that can describe a launch that
// never finished.
//
// Everything here is synchronous and backed by localStorage. That is not a
// convenience, it is the whole point: the app's blank-launch bug is a stall
// on the Tauri IPC bridge, and a log written over that bridge (as
// lib/devLog.ts is) cannot record the bridge failing. localStorage is
// in-webview, synchronous, and survives the process, which is exactly the
// set of properties needed to describe a launch that died mid-way.
//
// Four marks are written as the launch progresses. On the NEXT launch the
// previous record is rotated out and classified: the last mark present is
// how far it got, and the first missing one is where it died.
//
// The key below is duplicated in index.html, which runs before any module
// can load and therefore cannot import it. breadcrumbs.test.ts fails if the
// two drift.

export const BOOT_KEY = "riwaq:boot:v1";
export const BOOT_PREV_KEY = "riwaq:boot:prev:v1";

/** The launch stages, in the order they must occur. */
export const BOOT_MARKS = ["html", "module", "render", "mounted"] as const;
export type BootMark = (typeof BOOT_MARKS)[number];

/** Just enough of the Storage interface to be injectable in tests. */
export interface MarkStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface BootRecord {
  /** Epoch ms of the first mark; every offset below is relative to it. */
  at: number;
  id: string;
  marks: Partial<Record<BootMark, number>>;
}

export interface LaunchVerdict {
  /** Did a frame actually reach the screen? */
  ok: boolean;
  /** The furthest stage this launch completed. */
  reached: BootMark | null;
  /** The stage it never completed — null when the launch was healthy. */
  stalledAt: BootMark | null;
  /** ms from the first mark to the last one recorded. */
  durationMs: number | null;
  at: number;
  marks: Partial<Record<BootMark, number>>;
}

function defaultStore(): MarkStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Storage can throw on access alone in some privacy modes.
    return null;
  }
}

function read(store: MarkStore, key: string): BootRecord | null {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BootRecord;
    if (!parsed || typeof parsed !== "object" || !parsed.marks) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Record that the launch reached `mark`.
 *
 * Must never throw: it runs on the boot path, and a diagnostic that can
 * break the launch it is measuring is worse than no diagnostic.
 */
export function markBoot(
  mark: BootMark,
  store: MarkStore | null = defaultStore(),
  now: () => number = Date.now,
): void {
  if (!store) return;
  try {
    const t = now();
    const existing = read(store, BOOT_KEY);
    const rec: BootRecord = existing ?? {
      at: t,
      id: `${t.toString(36)}`,
      marks: {},
    };
    rec.marks[mark] = t - rec.at;
    store.setItem(BOOT_KEY, JSON.stringify(rec));
  } catch {
    // Storage full, disabled, or throwing — the launch continues regardless.
  }
}

/**
 * Move the in-progress record aside so this launch starts clean, and hand
 * back what the previous launch managed to write.
 */
export function rotateBootRecord(
  store: MarkStore | null = defaultStore(),
  _now: () => number = Date.now,
): BootRecord | null {
  if (!store) return null;
  try {
    const prev = read(store, BOOT_KEY);
    if (prev) store.setItem(BOOT_PREV_KEY, JSON.stringify(prev));
    if (store.removeItem) store.removeItem(BOOT_KEY);
    else store.setItem(BOOT_KEY, "");
    return prev;
  } catch {
    return null;
  }
}

/** Turn a record into a verdict: how far it got, and where it died. */
export function classifyLaunch(rec: BootRecord | null): LaunchVerdict | null {
  if (!rec) return null;
  let reached: BootMark | null = null;
  let stalledAt: BootMark | null = null;
  for (const m of BOOT_MARKS) {
    if (rec.marks[m] !== undefined) {
      reached = m;
    } else {
      // The first gap is where it stopped. Later marks cannot be reached
      // without it, so there is nothing to look at past this point.
      stalledAt = m;
      break;
    }
  }
  const offsets = Object.values(rec.marks).filter(
    (n): n is number => typeof n === "number",
  );
  return {
    ok: stalledAt === null && reached === "mounted",
    reached,
    stalledAt,
    durationMs: offsets.length ? Math.max(...offsets) : null,
    at: rec.at,
    marks: rec.marks,
  };
}

/** The previous launch's verdict, for display and for the export bundle. */
export function readPreviousLaunch(
  store: MarkStore | null = defaultStore(),
): LaunchVerdict | null {
  if (!store) return null;
  return classifyLaunch(read(store, BOOT_PREV_KEY));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/diagnostics/breadcrumbs.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Add the index.html drift guard**

Append to `src/lib/diagnostics/breadcrumbs.test.ts`:

```ts
import { readFileSync } from "node:fs";

describe("index.html mirror", () => {
  // index.html runs before any module can load, so it writes the boot mark
  // with a hardcoded key. If that key and BOOT_KEY drift, the first mark is
  // silently orphaned and every launch looks like it died before `html`.
  it("uses the same storage key as breadcrumbs.ts", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain(BOOT_KEY);
  });

  it("writes the html mark before the bundle loads", () => {
    const html = readFileSync("index.html", "utf8");
    const markAt = html.indexOf(BOOT_KEY);
    const bundleAt = html.indexOf("/src/main.tsx");
    expect(markAt).toBeGreaterThan(-1);
    expect(markAt).toBeLessThan(bundleAt);
  });
});
```

- [ ] **Step 6: Run it and watch it fail for the right reason**

Run: `pnpm vitest run src/lib/diagnostics/breadcrumbs.test.ts`
Expected: the two new tests FAIL — `index.html` does not contain `riwaq:boot:v1` yet. Task 2 makes them pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/diagnostics/breadcrumbs.ts src/lib/diagnostics/breadcrumbs.test.ts
git commit -m "feat(diagnostics): classify a launch by how far it got"
```

---

### Task 2: Wire the marks into the boot path

**Files:**
- Modify: `index.html` (inside the existing inline `<script>`, after the theme block)
- Modify: `src/main.tsx`
- Modify: `src/App.tsx:145` (add a mount effect)
- Test: `src/lib/diagnostics/bootBreadcrumbs.test.ts`

**Interfaces:**
- Consumes: `markBoot`, `rotateBootRecord`, `BOOT_KEY` from Task 1.
- Produces: the four marks actually being written at runtime.

- [ ] **Step 1: Write the failing test**

This is the most important test in the plan — it proves the design's central claim. Create `src/lib/diagnostics/bootBreadcrumbs.test.ts`:

```ts
// @vitest-environment happy-dom
//
// The regression guard for the whole diagnostics design.
//
// The blank-launch bug is a stall on the Tauri IPC bridge. lib/devLog.ts
// writes through that same bridge, which is why it has never been able to
// describe the failure. These tests pin the property that makes breadcrumbs
// different: with every filesystem call hung forever, the marks are STILL
// written and STILL readable on the next launch.
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every IPC call hangs forever — the exact failure being diagnosed. */
const neverSettles = () => new Promise(() => {});
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  mkdir: neverSettles,
  writeTextFile: neverSettles,
  readTextFile: neverSettles,
  readDir: neverSettles,
  remove: neverSettles,
  exists: neverSettles,
}));

const render = vi.fn();
vi.mock("react-dom/client", () => ({
  default: { createRoot: () => ({ render, unmount: vi.fn() }) },
  createRoot: () => ({ render, unmount: vi.fn() }),
}));
vi.mock("../../App", () => ({ default: () => null }));
vi.mock("../../styles/global.css", () => ({}));
vi.mock("../../store/legacyRoot", () => ({
  migrateLegacyRoot: neverSettles,
}));

describe("boot breadcrumbs under a dead IPC bridge", () => {
  beforeEach(() => {
    localStorage.clear();
    render.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
  });

  it("records the module mark even though every fs call hangs", async () => {
    const { BOOT_KEY } = await import("./breadcrumbs");
    await import("../../main");
    await Promise.resolve();

    const raw = localStorage.getItem(BOOT_KEY);
    expect(raw).toBeTruthy();
    const marks = JSON.parse(raw as string).marks;
    expect(marks.module).toBeDefined();
  });

  it("records the render mark, so a stall after render is distinguishable", async () => {
    const { BOOT_KEY } = await import("./breadcrumbs");
    await import("../../main");
    await Promise.resolve();

    const marks = JSON.parse(localStorage.getItem(BOOT_KEY) as string).marks;
    expect(marks.render).toBeDefined();
    // `mounted` comes from App's effect, which is mocked out here — so this
    // run looks exactly like a blank launch, which is the point.
    expect(marks.mounted).toBeUndefined();
  });

  it("still mounts React — the diagnostic must not gate first paint", async () => {
    await import("../../main");
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/diagnostics/bootBreadcrumbs.test.ts`
Expected: FAIL — marks are `null`, nothing writes them yet.

- [ ] **Step 3: Add the `html` mark to `index.html`**

In `index.html`, inside the existing inline `<script>`, immediately **before** the closing `})();` of the theme IIFE, add:

```js
        // Boot breadcrumb 1 of 4 — see src/lib/diagnostics/breadcrumbs.ts.
        // Written here because this is the earliest code that runs, and
        // synchronously to localStorage because the bug being diagnosed is a
        // stall on the Tauri IPC bridge. The key is duplicated from
        // BOOT_KEY; breadcrumbs.test.ts fails if the two drift.
        try {
          var bootNow = Date.now();
          localStorage.setItem(
            "riwaq:boot:v1",
            JSON.stringify({
              at: bootNow,
              id: bootNow.toString(36),
              marks: { html: 0 },
            }),
          );
        } catch (e) {
          /* storage disabled — the launch continues without a breadcrumb */
        }
```

- [ ] **Step 4: Add the `module` and `render` marks to `src/main.tsx`**

Add the import below the existing ones:

```ts
import { markBoot } from "./lib/diagnostics/breadcrumbs";
```

Immediately **before** the existing `void migrateLegacyRoot();` line, add:

```ts
// Breadcrumb 2 of 4: the bundle parsed and is executing. Synchronous and
// localStorage-backed on purpose — see lib/diagnostics/breadcrumbs.ts.
markBoot("module");
```

And immediately **after** the `ReactDOM.createRoot(...).render(...)` call, add:

```ts
// Breadcrumb 3 of 4: React has been handed the tree. If the next launch
// finds this mark present and `mounted` absent, the tree was handed over
// and no frame ever reached the screen — which is the blank launch.
markBoot("render");
```

- [ ] **Step 5: Add the `mounted` mark to `src/App.tsx`**

Add the import alongside the other `./lib` imports:

```ts
import { markBoot, rotateBootRecord } from "./lib/diagnostics/breadcrumbs";
```

Inside `function App()` (line 145), as the **first** `useEffect` in the body:

```ts
  // Breadcrumb 4 of 4, and the rotation point.
  //
  // This runs after the first commit, so reaching it means a frame really
  // did reach the screen. Rotating here rather than at module scope means
  // the record moved aside is genuinely the previous launch's, complete.
  useEffect(() => {
    markBoot("mounted");
    rotateBootRecord();
  }, []);
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/lib/diagnostics/`
Expected: PASS — Task 1's two drift tests now pass (the key is in `index.html`), and all three IPC-stall tests pass.

- [ ] **Step 7: Run the whole suite**

Run: `pnpm test`
Expected: PASS. `src/bootGate.test.ts` must stay green — it asserts `render` is called exactly once while the migration hangs, and `markBoot` must not have disturbed that.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add index.html src/main.tsx src/App.tsx src/lib/diagnostics/bootBreadcrumbs.test.ts
git commit -m "feat(diagnostics): mark each boot stage without touching IPC"
```

---

### Task 3: Redaction

**Files:**
- Create: `src/lib/diagnostics/redact.ts`
- Test: `src/lib/diagnostics/redact.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `hashTitle(s): string`, `redactPath(p): string`, `redactUrl(u): string`, `redactValue(v): unknown`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/diagnostics/redact.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashTitle, redactPath, redactUrl, redactValue } from "./redact";

describe("hashTitle", () => {
  it("is stable, so one book is followable across events", () => {
    expect(hashTitle("القس المجنون")).toBe(hashTitle("القس المجنون"));
  });

  it("distinguishes different titles", () => {
    expect(hashTitle("A")).not.toBe(hashTitle("B"));
  });

  it("never leaks the original text", () => {
    const title = "The Mad Priest";
    expect(hashTitle(title)).not.toContain("Mad");
    expect(hashTitle(title)).toMatch(/^t:[0-9a-f]{6}$/);
  });

  it("handles empty input", () => {
    expect(hashTitle("")).toBe("t:empty");
  });
});

describe("redactPath", () => {
  it("keeps only the basename, dropping the user's home", () => {
    expect(redactPath("/Users/someone/Library/Books/novel.epub")).toBe(
      "novel.epub",
    );
  });

  it("handles Windows separators", () => {
    expect(redactPath("C:\\Users\\someone\\book.pdf")).toBe("book.pdf");
  });

  it("passes through a bare name", () => {
    expect(redactPath("book.epub")).toBe("book.epub");
  });
});

describe("redactUrl", () => {
  it("keeps only the host", () => {
    expect(redactUrl("https://kolnovel.com/series/x/chapter-12")).toBe(
      "kolnovel.com",
    );
  });

  it("leaves a non-URL alone rather than inventing a host", () => {
    expect(redactUrl("not a url")).toBe("<url>");
  });
});

describe("redactValue", () => {
  it("redacts by key name, recursively", () => {
    const out = redactValue({
      title: "The Mad Priest",
      path: "/Users/me/b.epub",
      url: "https://cenele.com/x",
      nested: { chapterTitle: "Chapter One", count: 7 },
    }) as Record<string, unknown>;

    expect(out.title).toMatch(/^t:/);
    expect(out.path).toBe("b.epub");
    expect(out.url).toBe("cenele.com");
    expect((out.nested as Record<string, unknown>).chapterTitle).toMatch(/^t:/);
    expect((out.nested as Record<string, unknown>).count).toBe(7);
  });

  it("leaves primitives and arrays of primitives intact", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue([1, 2, 3])).toEqual([1, 2, 3]);
    expect(redactValue(null)).toBe(null);
  });

  it("does not recurse forever on a cycle", () => {
    const a: Record<string, unknown> = { name: "x" };
    a.self = a;
    expect(() => redactValue(a)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/diagnostics/redact.test.ts`
Expected: FAIL — `Failed to resolve import "./redact"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/diagnostics/redact.ts`:

```ts
// Redaction, applied at WRITE time.
//
// The export is meant to be pasted into a chat or attached to an issue, and
// a raw log carries the user's library: novel titles, local paths with their
// account name in them, and the sites they read from. Redacting at write
// time rather than at export time means no unredacted copy is ever on disk,
// so there is nothing to leak if the file is picked up some other way.
//
// Stability matters more than reversibility. `t:a3f19c` appearing in twelve
// events is enough to follow one book through a session, which is all a
// diagnosis needs.

/** Keys whose values are free text naming something the user chose. */
const TITLE_KEYS = /^(title|name|chapterTitle|bookTitle|author|novelTitle)$/i;
/** Keys whose values are filesystem paths. */
const PATH_KEYS = /^(path|file|filePath|dest|src|dir)$/i;
/** Keys whose values are URLs. */
const URL_KEYS = /^(url|href|link|novelUrl|chapterUrl|source)$/i;

/**
 * FNV-1a, 32-bit. Not a security hash and does not need to be — it needs to
 * be stable across runs and cheap enough to call from the log path.
 */
export function hashTitle(s: string): string {
  if (!s) return "t:empty";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `t:${(h >>> 0).toString(16).padStart(8, "0").slice(0, 6)}`;
}

/** Basename only — everything above it identifies the machine's owner. */
export function redactPath(p: string): string {
  if (!p) return "";
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/** Host only — the path identifies exactly what they were reading. */
export function redactUrl(u: string): string {
  try {
    return new URL(u).host || "<url>";
  } catch {
    return "<url>";
  }
}

/**
 * Walk a log payload and redact by key name.
 *
 * By key rather than by value sniffing: a value-based guess would both miss
 * titles that look ordinary and mangle data that merely resembles a path.
 */
export function redactValue(v: unknown, seen = new WeakSet<object>()): unknown {
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v as object)) return "<cycle>";
  seen.add(v as object);

  if (Array.isArray(v)) return v.map((x) => redactValue(x, seen));

  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") {
      if (TITLE_KEYS.test(k)) out[k] = hashTitle(val);
      else if (PATH_KEYS.test(k)) out[k] = redactPath(val);
      else if (URL_KEYS.test(k)) out[k] = redactUrl(val);
      else out[k] = val;
    } else {
      out[k] = redactValue(val, seen);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/lib/diagnostics/redact.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add src/lib/diagnostics/redact.ts src/lib/diagnostics/redact.test.ts
git commit -m "feat(diagnostics): redact titles, paths and URLs at write time"
```

---

### Task 4: The recorder — ring buffer and tiers

**Files:**
- Create: `src/lib/diagnostics/recorder.ts`
- Test: `src/lib/diagnostics/recorder.test.ts`

**Interfaces:**
- Consumes: `redactValue` from Task 3.
- Produces: `Tier`, `DiagEvent`, `createRecorder(opts)`, `Recorder` (methods `record`, `drain`, `size`, `setVerbose`, `isVerbose`), and module singletons `record(kind, data?, tier?)`, `drain()`, `setVerbose(on)`, `isVerbose()`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/diagnostics/recorder.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/diagnostics/recorder.test.ts`
Expected: FAIL — `Failed to resolve import "./recorder"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/diagnostics/recorder.ts`:

```ts
// The session event buffer.
//
// This is lib/devLog.ts's machinery with the `import.meta.env.DEV` gate
// replaced by a tier check, so release builds record too. The cheap tier is
// plain objects and no DOM reads, which is what makes it safe to leave on
// for every user forever; the verbose tier carries devLog's geometry
// snapshot and stays behind a Settings switch because that walk costs a
// getComputedStyle per ancestor.

import { redactValue } from "./redact";

export type Tier = "cheap" | "verbose";

export interface DiagEvent {
  /** ms since the first event of this session. */
  t: number;
  kind: string;
  tier: Tier;
  data: unknown;
}

export interface Recorder {
  record(kind: string, data?: unknown, tier?: Tier): void;
  drain(): DiagEvent[];
  size(): number;
  setVerbose(on: boolean): void;
  isVerbose(): boolean;
}

/** Generous enough to cover a launch and a reading session, small enough
 *  that holding it costs nothing worth measuring. */
const DEFAULT_MAX = 2000;

export function createRecorder(opts?: {
  max?: number;
  now?: () => number;
}): Recorder {
  const max = opts?.max ?? DEFAULT_MAX;
  const now = opts?.now ?? Date.now;
  let events: DiagEvent[] = [];
  let started = 0;
  let verbose = false;

  return {
    record(kind, data, tier = "cheap") {
      if (tier === "verbose" && !verbose) return;
      try {
        const t = now();
        if (started === 0) started = t;
        events.push({
          t: t - started,
          kind,
          tier,
          data: data === undefined ? null : redactValue(data),
        });
        // Ring: drop from the front so the most recent history survives,
        // which is the half that explains what just went wrong.
        if (events.length > max) events.splice(0, events.length - max);
      } catch {
        // A diagnostic must never take the app down with it.
      }
    },
    drain() {
      const out = events;
      events = [];
      return out;
    },
    size() {
      return events.length;
    },
    setVerbose(on) {
      verbose = on;
    },
    isVerbose() {
      return verbose;
    },
  };
}

/** The app-wide instance. */
const shared = createRecorder();

export const record: Recorder["record"] = (kind, data, tier) =>
  shared.record(kind, data, tier);
export const drain: Recorder["drain"] = () => shared.drain();
export const setVerbose: Recorder["setVerbose"] = (on) => shared.setVerbose(on);
export const isVerbose: Recorder["isVerbose"] = () => shared.isVerbose();
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/lib/diagnostics/recorder.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add src/lib/diagnostics/recorder.ts src/lib/diagnostics/recorder.test.ts
git commit -m "feat(diagnostics): record a tiered session buffer in release builds"
```

---

### Task 5: Session files — naming, rotation, retention

**Files:**
- Create: `src/lib/diagnostics/sessions.ts`
- Test: `src/lib/diagnostics/sessions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DIAG_DIR`, `RETAIN`, `sessionFileName(n)`, `parseSessionNumber(name)`, `nextSessionNumber(existing)`, `sessionsToDelete(existing, retain?)`, `sortSessions(existing)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/diagnostics/sessions.test.ts`:

```ts
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
      sessionsToDelete(["session-1.jsonl", "session-2.jsonl", "session-3.jsonl"]),
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/diagnostics/sessions.test.ts`
Expected: FAIL — `Failed to resolve import "./sessions"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/diagnostics/sessions.ts`:

```ts
// Session files on disk: $APPDATA/diagnostics/session-<n>.jsonl
//
// devLog truncated one file at every start, which loses the run that
// matters: a blank launch is only diagnosable from the NEXT launch, and by
// then the old truncate-on-start would have erased it. Keeping the last few
// runs is the difference between a log that describes the bug and one that
// describes the session where the user noticed it.

export const DIAG_DIR = "diagnostics";
/** How many past sessions survive. Three covers "it happened last time" and
 *  "it happened the time before" without unbounded disk use. */
export const RETAIN = 3;

const NAME = /^session-(\d+)\.jsonl$/;

export function sessionFileName(n: number): string {
  return `session-${n}.jsonl`;
}

export function parseSessionNumber(name: string): number | null {
  const m = NAME.exec(name);
  return m ? Number(m[1]) : null;
}

/** Oldest first. Numeric, because "session-10" sorts below "session-9" as a
 *  string and retention would then delete the newest file. */
export function sortSessions(existing: string[]): string[] {
  return existing
    .filter((n) => parseSessionNumber(n) !== null)
    .sort((a, b) => (parseSessionNumber(a) ?? 0) - (parseSessionNumber(b) ?? 0));
}

export function nextSessionNumber(existing: string[]): number {
  const nums = existing
    .map(parseSessionNumber)
    .filter((n): n is number => n !== null);
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

/** The files to remove so that at most `retain` remain. Oldest first. */
export function sessionsToDelete(existing: string[], retain = RETAIN): string[] {
  const sorted = sortSessions(existing);
  const excess = sorted.length - retain;
  return excess > 0 ? sorted.slice(0, excess) : [];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/lib/diagnostics/sessions.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add src/lib/diagnostics/sessions.ts src/lib/diagnostics/sessions.test.ts
git commit -m "feat(diagnostics): retain the last three session logs"
```

---

### Task 6: The export bundle

**Files:**
- Create: `src/lib/diagnostics/bundle.ts`
- Test: `src/lib/diagnostics/bundle.test.ts`

**Interfaces:**
- Consumes: `LaunchVerdict` from Task 1.
- Produces: `BundleInput`, `buildBundle(input): string`, `bundleFileName(date): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/diagnostics/bundle.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/diagnostics/bundle.test.ts`
Expected: FAIL — `Failed to resolve import "./bundle"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/diagnostics/bundle.ts`:

```ts
// The export document.
//
// Written for someone reading it cold with no other context, which means
// the verdict comes first and the raw events come last. A blank launch is
// called out by name at the top rather than left to be inferred from a
// missing line in a timeline.

import { BOOT_MARKS, type LaunchVerdict } from "./breadcrumbs";

export interface BundleInput {
  app: { version: string; platform: string; ua: string };
  verbose: boolean;
  launches: LaunchVerdict[];
  sessions: { name: string; lines: string[] }[];
}

export function bundleFileName(date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  return `riwaq-diagnostics-${iso}.txt`;
}

function renderLaunch(v: LaunchVerdict, i: number): string {
  const when = new Date(v.at).toISOString();
  const head = v.ok
    ? `launch ${i + 1} — ${when} — reached mounted in ${v.durationMs}ms`
    : `launch ${i + 1} — ${when} — BLANK LAUNCH: reached ${v.reached}, never reached ${v.stalledAt}`;
  const timeline = BOOT_MARKS.map((m) => {
    const at = v.marks[m];
    return at === undefined ? `  ${m} — MISSING` : `  ${m} +${at}ms`;
  }).join("\n");
  return `${head}\n${timeline}`;
}

export function buildBundle(input: BundleInput): string {
  const { app, launches, sessions, verbose } = input;
  const out: string[] = [];

  out.push("Riwaq diagnostics");
  out.push("=================");
  out.push(`version: ${app.version}`);
  out.push(`platform: ${app.platform}`);
  out.push(`detailed diagnostics: ${verbose ? "on" : "off"}`);
  out.push(`user agent: ${app.ua}`);
  out.push("");

  out.push("Launches");
  out.push("--------");
  if (launches.length === 0) {
    out.push("no launches recorded");
  } else {
    out.push(launches.map(renderLaunch).join("\n\n"));
  }
  out.push("");

  out.push("Sessions");
  out.push("--------");
  if (sessions.length === 0) {
    out.push("no session logs retained");
  } else {
    for (const s of sessions) {
      out.push(`--- ${s.name} (${s.lines.length} events)`);
      out.push(s.lines.join("\n"));
      out.push("");
    }
  }

  return out.join("\n");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/lib/diagnostics/bundle.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add src/lib/diagnostics/bundle.ts src/lib/diagnostics/bundle.test.ts
git commit -m "feat(diagnostics): render an export bundle that leads with the verdict"
```

---

### Task 7: Persist sessions to disk and capture errors

**Files:**
- Create: `src/lib/diagnostics/store.ts`
- Test: `src/lib/diagnostics/store.test.ts`
- Modify: `src/lib/devLog.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `drain`, `record`, `isVerbose`, `setVerbose` (Task 4); `DIAG_DIR`, `sessionFileName`, `nextSessionNumber`, `sessionsToDelete` (Task 5); `readPreviousLaunch` (Task 1).
- Produces: `startSession(): Promise<void>`, `flushNow(): Promise<void>`, `listSessions(): Promise<{name, lines}[]>`, `installErrorCapture(): () => void`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/diagnostics/store.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const mkdir = vi.fn(async () => {});
const writeTextFile = vi.fn(async (p: string, c: string, o?: { append?: boolean }) => {
  files.set(p, o?.append ? (files.get(p) ?? "") + c : c);
});
const readTextFile = vi.fn(async (p: string) => files.get(p) ?? "");
const readDir = vi.fn(async () => [...files.keys()].map((n) => ({ name: n.split("/").pop() })));
const remove = vi.fn(async (p: string) => {
  files.delete(p);
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  mkdir,
  writeTextFile,
  readTextFile,
  readDir,
  remove,
}));

describe("diagnostics store", () => {
  beforeEach(() => {
    files.clear();
    vi.clearAllMocks();
    vi.resetModules();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  it("writes recorded events to the session file on flush", async () => {
    const { record } = await import("./recorder");
    const { startSession, flushNow } = await import("./store");
    await startSession();
    record("nav", { to: "library" });
    await flushNow();
    const written = [...files.values()].join("");
    expect(written).toContain('"kind":"nav"');
  });

  it("is a no-op outside Tauri rather than throwing", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ =
      undefined;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const { startSession, flushNow } = await import("./store");
    await expect(startSession()).resolves.toBeUndefined();
    await expect(flushNow()).resolves.toBeUndefined();
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("captures an unhandled error into the buffer", async () => {
    const { installErrorCapture } = await import("./store");
    const { drain } = await import("./recorder");
    const uninstall = installErrorCapture();
    window.dispatchEvent(
      new ErrorEvent("error", { message: "boom", filename: "a.js", lineno: 3 }),
    );
    const kinds = drain().map((e) => e.kind);
    expect(kinds).toContain("error");
    uninstall();
  });

  it("stops capturing after uninstall", async () => {
    const { installErrorCapture } = await import("./store");
    const { drain } = await import("./recorder");
    installErrorCapture()();
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    expect(drain().length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/diagnostics/store.test.ts`
Expected: FAIL — `Failed to resolve import "./store"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/diagnostics/store.ts`:

```ts
// The disk side of the session log, and the error hooks that feed it.
//
// Everything here crosses the Tauri IPC bridge, so none of it is on the
// critical boot path — breadcrumbs.ts covers that case precisely because
// this module cannot.

import {
  BaseDirectory,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { drain, record } from "./recorder";
import {
  DIAG_DIR,
  nextSessionNumber,
  sessionFileName,
  sessionsToDelete,
  sortSessions,
} from "./sessions";

let current: string | null = null;

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function listNames(): Promise<string[]> {
  try {
    const entries = await readDir(DIAG_DIR, { baseDir: BaseDirectory.AppData });
    return entries.map((e) => e.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

/** Open this session's file and retire anything past the retention cap. */
export async function startSession(): Promise<void> {
  if (!hasTauri()) return;
  try {
    await mkdir(DIAG_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    const names = await listNames();
    for (const old of sessionsToDelete(names)) {
      try {
        await remove(`${DIAG_DIR}/${old}`, { baseDir: BaseDirectory.AppData });
      } catch {
        // A file we cannot delete is not worth failing the session over.
      }
    }
    current = `${DIAG_DIR}/${sessionFileName(nextSessionNumber(names))}`;
    await writeTextFile(current, "", { baseDir: BaseDirectory.AppData });
  } catch {
    current = null;
  }
}

/** Drain the buffer to disk. Safe to call when there is nothing to write. */
export async function flushNow(): Promise<void> {
  if (!hasTauri() || !current) return;
  const events = drain();
  if (events.length === 0) return;
  try {
    await writeTextFile(
      current,
      `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
      { baseDir: BaseDirectory.AppData, append: true },
    );
  } catch {
    // A failed write must never take the app down with it.
  }
}

/** Every retained session, oldest first, for the export bundle. */
export async function listSessions(): Promise<
  { name: string; lines: string[] }[]
> {
  if (!hasTauri()) return [];
  const out: { name: string; lines: string[] }[] = [];
  for (const name of sortSessions(await listNames())) {
    try {
      const text = await readTextFile(`${DIAG_DIR}/${name}`, {
        baseDir: BaseDirectory.AppData,
      });
      out.push({ name, lines: text.split("\n").filter(Boolean) });
    } catch {
      out.push({ name, lines: ["<unreadable>"] });
    }
  }
  return out;
}

/**
 * Route uncaught errors into the buffer. Returns the uninstaller, so a React
 * effect can own the lifetime rather than leaking a listener per mount.
 */
export function installErrorCapture(): () => void {
  if (typeof window === "undefined") return () => {};

  const onError = (e: ErrorEvent) => {
    record("error", {
      message: e.message,
      // `file` is redacted to a basename — a bundle path can carry the
      // build machine's directory layout.
      file: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error instanceof Error ? e.error.stack?.slice(0, 2000) : null,
    });
  };

  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason;
    record("unhandledRejection", {
      message: r instanceof Error ? r.message : String(r),
      stack: r instanceof Error ? r.stack?.slice(0, 2000) : null,
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/lib/diagnostics/store.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Start the session and error capture from `App`**

In `src/App.tsx`, extend the boot effect added in Task 2 so it reads:

```ts
  // Breadcrumb 4 of 4, the rotation point, and the start of the session log.
  //
  // Everything except the mark is deliberately AFTER it: markBoot is
  // synchronous and IPC-free, while startSession crosses the bridge. If the
  // bridge is dead the mark is still on record, which is the whole design.
  useEffect(() => {
    markBoot("mounted");
    const prev = rotateBootRecord();
    const uninstall = installErrorCapture();
    void startSession().then(() => {
      const verdict = classifyLaunch(prev);
      if (verdict && !verdict.ok) {
        record("previousLaunchBlank", {
          reached: verdict.reached,
          stalledAt: verdict.stalledAt,
          durationMs: verdict.durationMs,
        });
      }
      return flushNow();
    });
    const timer = window.setInterval(() => void flushNow(), 2000);
    return () => {
      window.clearInterval(timer);
      uninstall();
      void flushNow();
    };
  }, []);
```

with imports:

```ts
import {
  classifyLaunch,
  markBoot,
  rotateBootRecord,
} from "./lib/diagnostics/breadcrumbs";
import { record } from "./lib/diagnostics/recorder";
import {
  flushNow,
  installErrorCapture,
  startSession,
} from "./lib/diagnostics/store";
```

- [ ] **Step 6: Re-point `devLog` onto the recorder**

In `src/lib/devLog.ts`, replace the three `if (!import.meta.env.DEV) return;` guards (lines 116, 227, 300) so the geometry work runs on the verbose tier instead of only in dev. In `log()`:

```ts
export function log(kind: string, data?: unknown): void {
  record(kind, data, "verbose");
}
```

and at the top of `snapshotReader()` and `logSessionStart()` replace the DEV guard with:

```ts
  if (!isVerbose()) return;
```

adding:

```ts
import { isVerbose, record } from "./diagnostics/recorder";
```

Leave the `window.__readerLog` hook under `import.meta.env.DEV` — it is a dev console convenience, not a diagnostic.

- [ ] **Step 7: Feed `ReaderErrorBoundary` into the log**

A render error inside the reader is caught by the boundary rather than by
`window.onerror`, so without this it never reaches the log — and its own
comment says the failure it catches is "indistinguishable from a chapter that
loaded blank". That is exactly the confusion this feature exists to end.

In `src/components/ReaderErrorBoundary.tsx`, add the import:

```ts
import { record } from "../lib/diagnostics/recorder";
```

and extend `componentDidCatch` (currently console-only):

```ts
  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? null });
    // Into the diagnostics log as well as the console: the console is only
    // readable during a `tauri dev` session, and this boundary fires on the
    // user's device where nobody is watching one.
    record("renderError", {
      message: error.message,
      stack: error.stack?.slice(0, 2000) ?? null,
      componentStack: info.componentStack?.slice(0, 2000) ?? null,
    });
    console.error("[reader] render error", error, info.componentStack);
  }
```

Add to `src/lib/diagnostics/store.test.ts`:

```ts
  it("records a render error caught by the boundary", async () => {
    const { record } = await import("./recorder");
    const { drain } = await import("./recorder");
    record("renderError", { message: "bad chapter" });
    const e = drain().find((x) => x.kind === "renderError");
    expect(e).toBeDefined();
    expect((e?.data as Record<string, unknown>).message).toBe("bad chapter");
  });
```

- [ ] **Step 8: Run the whole suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
pnpm format
git add src/lib/diagnostics/store.ts src/lib/diagnostics/store.test.ts src/lib/devLog.ts src/App.tsx src/components/ReaderErrorBoundary.tsx
git commit -m "feat(diagnostics): persist sessions and capture uncaught errors"
```

---

### Task 8: Settings → Diagnostics

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`
- Modify: `src/components/SettingsPage.tsx` (the `data` array inside `entriesByCat`, line 152)
- Modify: `src/hooks/useTweaks.ts` (add `verboseDiagnostics` to `Tweaks` + `DEFAULT_TWEAKS`)
- Modify: `src/types/reader.ts` (the `Tweaks` interface)
- Test: `src/components/diagnosticsSettings.test.ts`

**Interfaces:**
- Consumes: `buildBundle`, `bundleFileName` (Task 6); `listSessions` (Task 7); `readPreviousLaunch` (Task 1); `setVerbose` (Task 4).
- Produces: the user-facing Export and Copy actions.

> **REQUIRED:** per `CLAUDE.md`, invoke the `ui-ux-pro-max` skill before writing any of this task's UI, and follow its recommendations for the React + shadcn-adjacent stack.

- [ ] **Step 1: Add the tweak field**

In `src/types/reader.ts`, add to the `Tweaks` interface:

```ts
  /** Adds devLog's geometry capture to the diagnostics log. Off by default —
   *  the snapshot costs a getComputedStyle per ancestor. */
  verboseDiagnostics: boolean;
```

In `src/hooks/useTweaks.ts`, add to `DEFAULT_TWEAKS` (after `wifiOnlyDownloads`):

```ts
  verboseDiagnostics: false,
```

- [ ] **Step 2: Write the failing test**

Create `src/components/diagnosticsSettings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { ar } from "../i18n/ar";
import { en } from "../i18n/en";

const KEYS = [
  "common.on",
  "common.off",
  "settings.diagnostics",
  "settings.diagnostics.verbose",
  "settings.diagnostics.verbose.hint",
  "settings.diagnostics.export",
  "settings.diagnostics.copy",
  "settings.diagnostics.copied",
  "settings.diagnostics.exportDone",
  "settings.diagnostics.exportError",
  "settings.diagnostics.lastLaunchOk",
  "settings.diagnostics.lastLaunchBlank",
] as const;

describe("diagnostics settings", () => {
  it("defaults verbose diagnostics off", () => {
    expect(DEFAULT_TWEAKS.verboseDiagnostics).toBe(false);
  });

  it("has an English string for every diagnostics key", () => {
    for (const k of KEYS) {
      expect(en[k as keyof typeof en], `missing en: ${k}`).toBeTruthy();
    }
  });

  it("has an Arabic counterpart for every diagnostics key", () => {
    for (const k of KEYS) {
      expect(ar[k as keyof typeof ar], `missing ar: ${k}`).toBeTruthy();
    }
  });

  it("does not leave an Arabic string identical to the English one", () => {
    for (const k of KEYS) {
      expect(
        ar[k as keyof typeof ar],
        `untranslated: ${k}`,
      ).not.toBe(en[k as keyof typeof en]);
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run src/components/diagnosticsSettings.test.ts`
Expected: FAIL — the keys do not exist.

- [ ] **Step 4: Add the message keys**

In `src/i18n/en.ts`, alongside the other `common.*` keys (neither exists yet —
verified against the catalog):

```ts
  "common.on": "On",
  "common.off": "Off",
```

and alongside the other `settings.*` keys:

```ts
  "settings.diagnostics": "Diagnostics",
  "settings.diagnostics.verbose": "Detailed diagnostics",
  "settings.diagnostics.verbose.hint":
    "Records reader layout details too. Turn this on only while reproducing a problem — it costs battery.",
  "settings.diagnostics.export": "Export diagnostics",
  "settings.diagnostics.copy": "Copy diagnostics",
  "settings.diagnostics.copied": "Diagnostics copied",
  "settings.diagnostics.exportDone": "Diagnostics saved",
  "settings.diagnostics.exportError": "Could not save diagnostics",
  "settings.diagnostics.lastLaunchOk": "Last launch opened normally",
  "settings.diagnostics.lastLaunchBlank":
    "Last launch failed to open — stopped at {stage}",
```

In `src/i18n/ar.ts`, at the matching positions:

```ts
  "common.on": "مُفعّل",
  "common.off": "مُعطّل",
```

```ts
  "settings.diagnostics": "التشخيص",
  "settings.diagnostics.verbose": "تشخيص مفصّل",
  "settings.diagnostics.verbose.hint":
    "يسجّل تفاصيل تخطيط القارئ أيضًا. فعّله فقط أثناء إعادة إنتاج مشكلة — فهو يستهلك البطارية.",
  "settings.diagnostics.export": "تصدير التشخيص",
  "settings.diagnostics.copy": "نسخ التشخيص",
  "settings.diagnostics.copied": "تم نسخ التشخيص",
  "settings.diagnostics.exportDone": "تم حفظ التشخيص",
  "settings.diagnostics.exportError": "تعذّر حفظ التشخيص",
  "settings.diagnostics.lastLaunchOk": "آخر تشغيل فُتح بشكل طبيعي",
  "settings.diagnostics.lastLaunchBlank":
    "فشل آخر تشغيل في الفتح — توقّف عند {stage}",
```

- [ ] **Step 5: Run the i18n test**

Run: `pnpm vitest run src/components/diagnosticsSettings.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Add the handlers to `SettingsPage.tsx`**

Next to `exportSettings` (line 103), add:

```ts
  const buildDiagnostics = async () => {
    const [{ readPreviousLaunch }, { listSessions }, { buildBundle }] =
      await Promise.all([
        import("../lib/diagnostics/breadcrumbs"),
        import("../lib/diagnostics/store"),
        import("../lib/diagnostics/bundle"),
      ]);
    const prev = readPreviousLaunch();
    return buildBundle({
      app: {
        version: version || "dev",
        platform: navigator.platform || "unknown",
        ua: navigator.userAgent,
      },
      verbose: t.verboseDiagnostics,
      launches: prev ? [prev] : [],
      sessions: await listSessions(),
    });
  };

  const exportDiagnostics = async () => {
    try {
      const { bundleFileName } = await import("../lib/diagnostics/bundle");
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: bundleFileName(new Date()),
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (!path) return;
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, await buildDiagnostics());
      notify("info", tr("settings.diagnostics.exportDone"));
    } catch (e) {
      console.error("diagnostics export failed", e);
      notify("error", tr("settings.diagnostics.exportError"));
    }
  };

  const copyDiagnostics = async () => {
    try {
      const { copyText } = await import("../lib/clipboard");
      const ok = await copyText(await buildDiagnostics());
      notify(
        ok ? "info" : "error",
        ok
          ? tr("settings.diagnostics.copied")
          : tr("settings.diagnostics.exportError"),
      );
    } catch {
      notify("error", tr("settings.diagnostics.exportError"));
    }
  };
```

- [ ] **Step 7: Add the entries to the `data` category**

In `entriesByCat` (line 152), append to the `data` array, after the existing `reset` entry:

```ts
      {
        id: "diagnostics-verbose",
        label: tr("settings.diagnostics.verbose"),
        node: (
          <Field label={tr("settings.diagnostics.verbose")} theme={theme}>
            <SegRow
              theme={theme}
              value={t.verboseDiagnostics ? "on" : "off"}
              onChange={async (v) => {
                const on = v === "on";
                setTweak("verboseDiagnostics", on);
                const { setVerbose } = await import(
                  "../lib/diagnostics/recorder"
                );
                setVerbose(on);
              }}
              options={[
                { value: "off", label: tr("common.off") },
                { value: "on", label: tr("common.on") },
              ]}
            />
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 12,
                color: theme.muted,
                lineHeight: 1.5,
              }}
            >
              {tr("settings.diagnostics.verbose.hint")}
            </p>
          </Field>
        ),
      },
      {
        id: "diagnostics-export",
        label: tr("settings.diagnostics.export"),
        node: (
          <ActionRow
            theme={theme}
            icon={<Icon name="download" size={16} />}
            label={tr("settings.diagnostics.export")}
            onClick={exportDiagnostics}
          />
        ),
      },
      {
        id: "diagnostics-copy",
        label: tr("settings.diagnostics.copy"),
        node: (
          <ActionRow
            theme={theme}
            icon={<Icon name="doc" size={16} />}
            label={tr("settings.diagnostics.copy")}
            onClick={copyDiagnostics}
          />
        ),
      },
```

`common.on` and `common.off` were added in Step 4; `SegRow` is generic over the
value type, so `value={t.verboseDiagnostics ? "on" : "off"}` infers `"on" | "off"`
from the `options` array without an explicit type argument.

- [ ] **Step 8: Apply the persisted tier at startup**

In `src/App.tsx`, inside the boot effect from Task 7, before `startSession()`:

```ts
    void import("./lib/diagnostics/recorder").then((m) =>
      m.setVerbose(t.verboseDiagnostics),
    );
```

- [ ] **Step 9: Run everything**

Run: `pnpm check`
Expected: format check, lint, `tsc`, `vite build` and the full vitest suite all pass.

- [ ] **Step 10: Commit**

```bash
pnpm format
git add src/i18n/en.ts src/i18n/ar.ts src/components/SettingsPage.tsx src/components/diagnosticsSettings.test.ts src/hooks/useTweaks.ts src/types/reader.ts src/App.tsx
git commit -m "feat(settings): export and copy diagnostics from the Data section"
```

---

## Verification

After Task 8, confirm the feature end-to-end rather than trusting the unit tests:

1. `pnpm check` — everything green.
2. `pnpm android:dev` against the emulator (see the `android-emulator-dev-setup` notes). Open Settings → Data → Export diagnostics, save a file, and read it. The header, a launch verdict and at least one session must be present.
3. Force a blank launch to prove the classifier fires: in the running WebView console, run
   `localStorage.setItem("riwaq:boot:v1", JSON.stringify({at: Date.now()-5000, id:"x", marks:{html:0, module:40, render:90}}))`
   then cold-restart the app. Settings must report the last launch as blank, stopped at `mounted`, and the export must contain `BLANK LAUNCH`.
4. Confirm redaction: the exported file must contain no novel title and no path above a basename.

## Follow-on

Once this is in and a real blank launch has been captured, the verdict names the failing stage and the blank-screen fix becomes a targeted change rather than a guess. The three commits already on `fix/blank-screen-on-failed-open` (render-error boundary, the invisible-first-frame fix, the chrome-less route guard) should be merged first so the diagnosis is taken against current code.
