import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Z, Z_LOCAL, scrimUnder } from "./tokens";

/**
 * The stacking scale is only worth having if it stays the only place layers
 * are decided. These are the guard rails for that.
 *
 * Before it existed, thirty-one distinct z-index values were tuned one at a
 * time at the point of use, and the comments explaining them had drifted off
 * the numbers they described. Nothing here stops you adding a layer — it stops
 * a layer being added somewhere the next person will not think to look.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

describe("stacking scale", () => {
  it("is the only place a z-index is chosen", () => {
    // `zIndex: 12` in a style object, `zIndex={12}` as a prop, `z-index: 12`
    // in an inline style string — every way the codebase has spelled one.
    const literal = /\bzIndex\s*[:=]\s*\{?\d|z-index\s*:\s*\d/;
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (file.endsWith(join("styles", "tokens.ts"))) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (literal.test(line)) {
          offenders.push(`${file.slice(SRC.length)}:${i + 1}  ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      "Use a name from `Z` (app-wide layers) or `Z_LOCAL` (ordering inside " +
        "one component) in styles/tokens.ts instead of a bare number:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("reads top to bottom in stacking order", () => {
    // So the declaration order in tokens.ts can be trusted as the diagram.
    const values = Object.values(Z);
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });

  it("keeps the local band clear of the app band", () => {
    // `Z_LOCAL` orders siblings inside one component's own stacking context
    // and is never comparable with an app layer. Keeping the numbers disjoint
    // means a value that escapes its band is still obviously wrong.
    const highestLocal = Math.max(...Object.values(Z_LOCAL));
    const lowestApp = Math.min(...Object.values(Z));
    expect(highestLocal).toBeLessThan(lowestApp);
  });

  it("puts a scrim directly under the surface it dims", () => {
    // The relationship the old 8999/9499 literals were spelling out by hand.
    expect(scrimUnder(Z.modal)).toBeLessThan(Z.modal);
    expect(scrimUnder(Z.menu)).toBeLessThan(Z.menu);
    // And nothing else may be wedged into that gap.
    const between = Object.values(Z).filter(
      (v) => v > scrimUnder(Z.modal) && v < Z.modal,
    );
    expect(between).toEqual([]);
  });

  it("agrees with the one z-index global.css sets for itself", () => {
    // The overlay-scrollbar host is the single layer that lives outside the
    // app band, and it is declared in CSS because it has no React component.
    const css = readFileSync(join(SRC, "styles", "global.css"), "utf8");
    const block = css.match(/#riwaq-scrollbars\s*\{([^}]*)\}/);
    expect(block, "#riwaq-scrollbars rule not found in global.css").toBeTruthy();
    const declared = block![1].match(/z-index:\s*(\d+)/);
    expect(declared, "#riwaq-scrollbars has no z-index").toBeTruthy();
    expect(Number(declared![1])).toBe(Z.scrollbars);
  });

  it("keeps the scrollbar host above every app layer", () => {
    const highestApp = Math.max(
      ...Object.entries(Z)
        .filter(([name]) => name !== "scrollbars")
        .map(([, v]) => v),
    );
    expect(Z.scrollbars).toBeGreaterThan(highestApp);
  });
});
