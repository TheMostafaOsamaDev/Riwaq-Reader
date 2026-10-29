import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_COLORS,
  HIGHLIGHT_COLOR_ORDER,
  hlBg,
  readingSurfaces,
  resolveTextColor,
  sanitizeTextColors,
  TEXT_COLORS,
  THEMES,
} from "./tokens";

const KEYS = ["light", "sepia", "dark", "oled"] as const;

type Rgb = [number, number, number];

/** `#rrggbb` → [r, g, b], or `rgba(r,g,b,a)` → [r, g, b] plus its alpha. */
function rgbOf(color: string): { rgb: Rgb; alpha: number } {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { rgb: [n >> 16, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = color.match(/^rgba\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)$/);
  if (!rgba) throw new Error(`not a colour this test reads: ${color}`);
  return {
    rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
    alpha: Number(rgba[4]),
  };
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string | Rgb, b: string | Rgb): number {
  const la = luminance(typeof a === "string" ? rgbOf(a).rgb : a);
  const lb = luminance(typeof b === "string" ? rgbOf(b).rgb : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A translucent tint laid over an opaque colour, the way a highlight sits on
 *  the page. */
function over(base: string, tint: string): Rgb {
  const b = rgbOf(base).rgb;
  const { rgb, alpha } = rgbOf(tint);
  return b.map((c, i) => c * (1 - alpha) + rgb[i] * alpha) as Rgb;
}

describe("text-color palettes", () => {
  it("offers five colors per theme, Default first, no repeats", () => {
    for (const k of KEYS) {
      const ids = TEXT_COLORS[k].map((c) => c.id);
      expect(ids).toHaveLength(5);
      expect(ids[0]).toBe("default");
      expect(TEXT_COLORS[k][0].hex).toBeNull();
      expect(new Set(ids).size).toBe(5);
    }
    expect(TEXT_COLORS.light.map((c) => c.id)).toEqual([
      "default",
      "soft",
      "graphite",
      "navy",
      "brown",
    ]);
    expect(TEXT_COLORS.sepia.map((c) => c.id)).toEqual([
      "default",
      "deep",
      "coffee",
      "olive",
      "plum",
    ]);
    expect(TEXT_COLORS.dark.map((c) => c.id)).toEqual([
      "default",
      "paper",
      "silver",
      "amber",
      "sage",
    ]);
    expect(TEXT_COLORS.oled.map((c) => c.id)).toEqual([
      "default",
      "sage",
      "amber",
      "coral",
      "moon",
    ]);
  });

  it("Default is the theme's own ink", () => {
    for (const k of KEYS) {
      expect(resolveTextColor(k, DEFAULT_TEXT_COLORS)).toBe(THEMES[k].ink);
    }
  });

  it("resolves a pick to its color and keeps each theme's own pick", () => {
    const picks = {
      ...DEFAULT_TEXT_COLORS,
      light: "navy",
      dark: "amber",
      oled: "sage",
    } as const;
    expect(resolveTextColor("light", picks)).toBe("#1f3a5f");
    expect(resolveTextColor("dark", picks)).toBe("#eabb70");
    expect(resolveTextColor("oled", picks)).toBe("#9fc0a0");
    expect(resolveTextColor("sepia", picks)).toBe(THEMES.sepia.ink);
  });

  it("falls back to the theme ink for an id the theme does not offer", () => {
    expect(
      resolveTextColor("light", { ...DEFAULT_TEXT_COLORS, light: "moon" }),
    ).toBe(THEMES.light.ink);
  });

  // The rule the old free colour picker could not keep (it was removed for
  // letting light text land on a light page): every offered colour reads on
  // the sheet the words actually sit on — which on the near-black themes is
  // lifted above `paper` — and under every highlight tint laid over it.
  it("every color stays readable on the page and under every highlight", () => {
    for (const k of KEYS) {
      const page = readingSurfaces(THEMES[k]).page;
      for (const { id } of TEXT_COLORS[k]) {
        const ink = resolveTextColor(k, { ...DEFAULT_TEXT_COLORS, [k]: id });
        expect(
          contrast(ink, page),
          `${k}/${id} on page`,
        ).toBeGreaterThanOrEqual(4.5);
        for (const c of HIGHLIGHT_COLOR_ORDER) {
          expect(
            contrast(ink, over(page, hlBg(c, k))),
            `${k}/${id} under ${c}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe("sanitizeTextColors", () => {
  it("gives the defaults for anything that is not a plain object", () => {
    for (const v of [undefined, null, [], "navy", 3]) {
      expect(sanitizeTextColors(v)).toEqual(DEFAULT_TEXT_COLORS);
    }
  });

  it("keeps valid picks, repairs the rest and drops unknown keys", () => {
    expect(
      sanitizeTextColors({
        light: "navy",
        sepia: 3,
        dark: "bogus",
        oled: "coral",
        extra: "x",
      }),
    ).toEqual({
      light: "navy",
      sepia: "default",
      dark: "default",
      oled: "coral",
    });
  });

  it("rejects an id that belongs to a different theme", () => {
    expect(sanitizeTextColors({ light: "moon" }).light).toBe("default");
  });
});
