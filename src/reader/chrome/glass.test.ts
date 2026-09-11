import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEMES } from "../../styles/tokens";
import { GLASS_CLASS, glassBar } from "./glass";

describe("glassBar", () => {
  it("fills with the theme's translucent chrome, not the opaque one", () => {
    const bar = glassBar(THEMES.dark, "top");
    expect(bar.style.background).toBe(THEMES.dark.chromeGlass);
    expect(bar.style.background).not.toBe(THEMES.dark.chrome);
  });

  it("carries the blur class", () => {
    expect(glassBar(THEMES.dark, "top").className).toBe(GLASS_CLASS);
  });

  it("hands the opaque chrome to the no-backdrop-filter fallback", () => {
    // The @supports rule in global.css reads this variable. Without it the
    // fallback lands on `transparent` and the bar shows raw, unblurred text
    // through a translucent scrim — the one outcome that is actually
    // unreadable, and a sheerer fill only makes it worse.
    const bar = glassBar(THEMES.sepia, "bottom");
    expect(bar.style["--riwaq-chrome-opaque"]).toBe(THEMES.sepia.chrome);
  });

  it("puts the hairline on the edge facing the page", () => {
    // A frosted bar with no edge dissolves into the text it floats over, so
    // each bar gets a rule on its inward side only — and only that side, or
    // the two bars would draw a line along the outer screen edge too.
    const top = glassBar(THEMES.light, "top");
    expect(top.style.borderBottom).toBe(`0.5px solid ${THEMES.light.rule}`);
    expect(top.style.borderTop).toBeUndefined();

    const bottom = glassBar(THEMES.light, "bottom");
    expect(bottom.style.borderTop).toBe(
      `0.5px solid ${THEMES.light.ruleStrong}`,
    );
    expect(bottom.style.borderBottom).toBeUndefined();
  });

  it("gives every theme a glass fill, sheer and inside the measured band", () => {
    // A theme missing `chromeGlass` would render a bar with no fill at all —
    // transparent over the text — rather than failing loudly.
    //
    // The band, not the exact value, is what is pinned: FLOOR is the bottom of
    // the sweep behind the number, so below it nothing was measured either way
    // — going lower means measuring again, not guessing again. CEILING is the
    // lowest of the flat alphas this replaced (oled's was 0.82). Drifting back
    // up is not a contrast bug, so nothing else would catch it, but it is the
    // change undone. Measurements live on `chromeGlass` in styles/tokens.ts,
    // next to the values they describe, rather than in a second copy here.
    const FLOOR = 0.5;
    const CEILING = 0.78;

    for (const [key, theme] of Object.entries(THEMES)) {
      expect(glassBar(theme, "top").style.background, key).toMatch(/^rgba\(/);
      const alpha = Number(theme.chromeGlass.match(/,\s*([\d.]+)\)$/)?.[1]);
      expect(alpha, `${key} below the measured floor`).toBeGreaterThanOrEqual(
        FLOOR,
      );
      expect(alpha, `${key} back at the flat build`).toBeLessThan(CEILING);
    }
  });

  it("uses one alpha for every theme", () => {
    // The rule behind the four values, and the thing the band above cannot
    // say: a per-theme exception has to be argued for, not inherited. The set
    // this replaced carried 0.78/0.78/0.78/0.82 and that 0.82 was never
    // explained, so it survived every retune by being copied. Measuring says
    // oled reads the same at either — its `chrome` is already its `paper` —
    // which is exactly why the exception was invisible and worth deleting.
    const alphas = Object.values(THEMES).map(
      (t) => t.chromeGlass.split(",")[3],
    );
    expect(new Set(alphas).size).toBe(1);
  });

  it("keeps each glass fill the same colour as its own chrome", () => {
    // `chromeGlass` is `chrome` re-typed as decimal channels, so the two can
    // drift silently: edit `chrome` alone and the bar keeps blurring the old
    // hue at the new theme's name, with nothing to catch it. Cheaper to assert
    // the relationship than to restructure the token into a computed one.
    for (const [key, theme] of Object.entries(THEMES)) {
      const rgb = theme.chrome
        .replace("#", "")
        .match(/../g)
        ?.map((h) => Number.parseInt(h, 16));
      expect(theme.chromeGlass, key).toContain(`rgba(${rgb?.join(",")},`);
    }
  });
});

/**
 * The blur lives in a stylesheet, not a token, because its no-support fallback
 * needs `@supports` and inline styles cannot express that. So it is the half of
 * the material nothing in TS can see — and the half whose documentation went
 * stale first. Same guard rail as styles/bootTheme.test.ts puts on index.html:
 * read what actually ships and fail the build when it moves silently.
 */
describe(".riwaq-chrome-glass", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../../styles/global.css", import.meta.url)),
    "utf8",
  );
  const rule = css.match(/\.riwaq-chrome-glass \{([^}]*)\}/)?.[1] ?? "";

  it("blurs wide enough to smear words rather than merely soften them", () => {
    // Narrower and individual words stay readable THROUGH the bar, which puts
    // them in competition with the title sitting on top of it — the failure
    // the radius exists to prevent, and one contrast ratios do not describe.
    // Only a lower bound is pinned: wider costs nothing measurable, so there
    // is no reason to fail a future retune that goes up.
    const radii = [...rule.matchAll(/blur\((\d+)px\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(radii.length, "no blur in .riwaq-chrome-glass").toBeGreaterThan(0);
    for (const r of radii) expect(r).toBeGreaterThanOrEqual(32);
  });

  it("ships the -webkit- pair, since WKWebView is half the app's platforms", () => {
    // macOS and iOS both run this in WKWebView; dropping the prefixed
    // declaration would leave those two with no blur at all and no fallback,
    // because `@supports` would still report support.
    expect(rule).toContain("-webkit-backdrop-filter:");
    expect(rule).toContain("backdrop-filter:");
  });
});
