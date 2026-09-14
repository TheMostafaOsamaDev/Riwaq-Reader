// @vitest-environment happy-dom
//
// The $APPDATA/debug log is written by one gate and emptied by another, and
// the two must agree. This coupling has now broken twice in one branch:
//
//   1. when the file write was moved to the verbose tier while the ⌘⇧L
//      workflow that reads the file was not, so a dev session wrote nothing;
//   2. when the write went back to `import.meta.env.DEV` but the session
//      start — the only thing that empties the file — stayed on the verbose
//      tier alone, so a dev session appended to a file that was never
//      truncated, with every `t` restarting at 0 inside one file.
//
// (2) is the exact failure devLog's own truncateForSession comment says must
// never happen, and a comment did not prevent it. These tests do.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mkdir = vi.fn(async () => {});
const writeTextFile = vi.fn(
  async (_p: string, _c: string, _o?: { append?: boolean }) => {},
);

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  mkdir,
  writeTextFile,
}));

const LOG_PATH = "debug/reader-debug.log";

describe("devLog file gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  it("truncates and writes under the same condition, with verbose off", async () => {
    // Precondition: a vacuous pass here would be worse than a failure.
    expect(import.meta.env.DEV).toBe(true);
    const { isVerbose } = await import("./diagnostics/recorder");
    expect(isVerbose()).toBe(false);

    const { log, logSessionStart, flushNow } = await import("./devLog");

    logSessionStart();
    await vi.waitFor(() =>
      expect(writeTextFile).toHaveBeenCalledWith(
        LOG_PATH,
        "",
        expect.objectContaining({ append: false }),
      ),
    );

    log("after", { x: 1 });
    await flushNow();

    const appended = writeTextFile.mock.calls.filter(
      (c) => (c[2] as { append?: boolean } | undefined)?.append === true,
    );
    expect(appended.length).toBeGreaterThan(0);
    expect(appended.map((c) => c[1]).join("")).toContain('"kind":"after"');
  });
});

/** Every shipped source file — tests excluded, since a test cannot be the
 *  caller that matters here. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !name.includes(".test.")) out.push(path);
  }
  return out;
}

describe("devLog session-start gate", () => {
  const callers = sourceFiles("src").filter(
    (f) =>
      f !== join("src", "lib", "devLog.ts") &&
      readFileSync(f, "utf8").includes("logSessionStart("),
  );

  // The single-caller fact is what makes the guard check below sufficient.
  // A second caller is not wrong, but it would need the same reasoning
  // applied to it — so it fails here rather than silently widening the hole.
  it("has exactly one caller", () => {
    expect(callers).toEqual([join("src", "components", "DesktopReader.tsx")]);
  });

  it("is not gated more narrowly than the file write it truncates", () => {
    const src = readFileSync(callers[0], "utf8");
    const call = src.indexOf("logSessionStart({");
    expect(call).toBeGreaterThan(-1);
    // The early-return guard of the effect that makes the call. Comments are
    // stripped first: the first draft of this test matched the whole region
    // and passed against a deliberately narrowed guard, because the comment
    // explaining the coupling named both gates. A test that a comment can
    // satisfy is the same false green this file exists to stop.
    const guard = (src.slice(0, call).split("useEffect(() => {").pop() ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//"))
      .find((l) => l.startsWith("if (") && l.includes("return"));

    expect(guard).toBeDefined();
    // devLog writes the file on `import.meta.env.DEV` alone, so this effect
    // must run whenever that is true — otherwise nothing empties the file.
    expect(guard).toContain("import.meta.env.DEV");
    // ...and whenever the verbose tier is on, so a release build with the
    // Settings switch flipped records a session header at all.
    expect(guard).toContain("isVerbose()");
  });
});
