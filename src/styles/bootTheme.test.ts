import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { THEMES, type ThemeKey } from "./tokens";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";

/**
 * index.html carries a hand-written copy of the theme background/ink colours
 * in its inline first-paint bootstrap. It has to: the script runs before any
 * module loads, so it cannot import THEMES. That duplication is the price of
 * painting the right colour on the very first frame instead of flashing the
 * sepia default and correcting after mount.
 *
 * These tests are the guard rail — change a theme colour in tokens.ts without
 * updating index.html and the launch flash comes back silently. Here it fails
 * the build instead.
 */

const html = readFileSync(
  fileURLToPath(new URL("../../index.html", import.meta.url)),
  "utf8",
);

/** Pull `key: { bg: "#...", ink: "#..." }` pairs out of the inline BOOT_THEMES
 *  literal. Deliberately a regex rather than an eval: the point is to read what
 *  actually ships in the HTML, not to re-execute it. */
function parseBootThemes(): Record<string, { bg: string; ink: string }> {
  const block = html.match(/var BOOT_THEMES = \{([\s\S]*?)\n\s*\};/);
  if (!block) throw new Error("BOOT_THEMES literal not found in index.html");
  const out: Record<string, { bg: string; ink: string }> = {};
  const entry = /(\w+):\s*\{\s*bg:\s*"([^"]+)",\s*ink:\s*"([^"]+)"\s*\}/g;
  for (let m = entry.exec(block[1]); m; m = entry.exec(block[1])) {
    out[m[1]] = { bg: m[2], ink: m[3] };
  }
  return out;
}

describe("index.html first-paint bootstrap", () => {
  const boot = parseBootThemes();

  it("covers every theme in THEMES", () => {
    expect(Object.keys(boot).sort()).toEqual(Object.keys(THEMES).sort());
  });

  it.each(Object.keys(THEMES) as ThemeKey[])(
    "matches tokens.ts for the %s theme",
    (key) => {
      expect(boot[key]).toEqual({
        bg: THEMES[key].bg,
        ink: THEMES[key].ink,
      });
    },
  );

  it("falls back to the same theme as DEFAULT_TWEAKS", () => {
    const fallback = html.match(/var DEFAULT_THEME = "(\w+)";/);
    expect(fallback?.[1]).toBe(DEFAULT_TWEAKS.theme);
  });

  it("reads the same localStorage key useTweaks writes", () => {
    expect(html).toContain('localStorage.getItem("leaflet:tweaks:v1")');
  });

  it("loads no remote stylesheet — the app has to start offline", () => {
    expect(html).not.toMatch(/<link[^>]+href="https?:\/\//);
  });
});
