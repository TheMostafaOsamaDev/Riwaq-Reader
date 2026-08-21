import { describe, it, expect } from "vitest";
import {
  contrastRatio,
  isLowContrast,
  resolveReadingColors,
  pdfDuotone,
} from "./readingColors";
import { THEMES } from "../styles/tokens";

describe("contrastRatio", () => {
  it("is 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("is 1:1 for identical colors", () => {
    expect(contrastRatio("#3a2f1f", "#3a2f1f")).toBeCloseTo(1, 5);
  });

  it("is ~4.54:1 for the #767676 AA-boundary gray on white", () => {
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
  });

  it("supports 3-digit hex shorthand", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
  });

  it("is symmetric regardless of argument order", () => {
    expect(contrastRatio("#123456", "#abcdef")).toBeCloseTo(
      contrastRatio("#abcdef", "#123456")!,
      5,
    );
  });

  it("returns null when a color can't be parsed", () => {
    expect(contrastRatio("auto", "#ffffff")).toBeNull();
  });
});

describe("isLowContrast", () => {
  it("is false for black on white (21:1)", () => {
    expect(isLowContrast("#000000", "#ffffff")).toBe(false);
  });

  it("is true for yellow on white", () => {
    expect(isLowContrast("#ffff00", "#ffffff")).toBe(true);
  });

  it("passes the #767676 AA-threshold gray on white", () => {
    expect(isLowContrast("#767676", "#ffffff")).toBe(false);
  });

  it("flags a gray just under AA (#888888 on white)", () => {
    expect(isLowContrast("#888888", "#ffffff")).toBe(true);
  });

  it("does not warn when a color is unparseable/auto", () => {
    expect(isLowContrast("auto", "auto")).toBe(false);
  });
});

describe("resolveReadingColors", () => {
  const sepia = THEMES.sepia;

  it("falls back to theme ink and bg when both are auto", () => {
    expect(resolveReadingColors(sepia, "auto", "auto")).toEqual({
      ink: sepia.ink,
      paper: sepia.bg,
    });
  });

  it("overrides ink only, keeping the theme paper", () => {
    expect(resolveReadingColors(sepia, "#ff0000", "auto")).toEqual({
      ink: "#ff0000",
      paper: sepia.bg,
    });
  });

  it("overrides paper only, keeping the theme ink", () => {
    expect(resolveReadingColors(sepia, "auto", "#000000")).toEqual({
      ink: sepia.ink,
      paper: "#000000",
    });
  });
});

describe("pdfDuotone", () => {
  it("is null when both are auto (leaves the PDF untouched)", () => {
    expect(pdfDuotone("auto", "auto")).toBeNull();
  });

  it("anchors the paper endpoint to white when only ink is set", () => {
    const d = pdfDuotone("#3355aa", "auto");
    expect(d).not.toBeNull();
    expect(d!.ink.color).toBe("#3355aa");
    expect(d!.paper.color).toBe("#ffffff");
    expect(d!.hostFilter).toContain("grayscale");
  });

  it("anchors the ink endpoint to near-black when only paper is set", () => {
    const d = pdfDuotone("auto", "#f4ecd8");
    expect(d).not.toBeNull();
    expect(d!.ink.color).toBe("#1a1a1a");
    expect(d!.paper.color).toBe("#f4ecd8");
  });

  it("uses both explicit endpoints when both are set", () => {
    const d = pdfDuotone("#eeddcc", "#221100");
    expect(d).not.toBeNull();
    expect(d!.ink.color).toBe("#eeddcc");
    expect(d!.paper.color).toBe("#221100");
  });

  describe("polarity (blend modes depend on which endpoint is lighter)", () => {
    it("normal polarity (dark ink, light paper): grayscale, lighten ink over darken paper", () => {
      const d = pdfDuotone("#222222", "#ffffff")!;
      expect(d.hostFilter).toBe("grayscale(1)");
      expect(d.ink.blend).toBe("lighten");
      expect(d.paper.blend).toBe("darken");
    });

    it("inverted polarity (light ink, dark paper): also inverts, and swaps the blend modes so light text survives", () => {
      const d = pdfDuotone("#d8cbb0", "#1a1614")!;
      expect(d.hostFilter).toContain("invert");
      expect(d.ink.blend).toBe("darken");
      expect(d.paper.blend).toBe("lighten");
    });
  });
});
