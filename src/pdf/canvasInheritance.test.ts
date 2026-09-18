// A PDF canvas must not inherit the app's typography.
//
// `global.css` sets `font-size-adjust` on `body` to normalize the apparent
// size of the selected UI font. It is an inherited property, so a canvas
// mounted anywhere under the app picks it up — and then the engine rescales
// every glyph pdf.js draws to hit that x-height ratio while pdf.js keeps
// positioning them from the font's REAL advances. The glyphs outgrow their
// slots and pile up.
//
// Measured in a browser on the reported file (a 165-page Arabic PDF), same
// page rendered twice, only this property differing:
//
//   without font-size-adjust:  15 text bands, 12-19px tall   (clean lines)
//   with    font-size-adjust:   7 text bands, up to 122px    (merged smear)
//
// A heading whose font happens to sit near the ratio still looked right,
// which is what made this read as a font-loading failure rather than a CSS
// inheritance one.
//
// `direction` is pinned next to it for the same class of reason and is
// already covered by the comments there; these tests pin the pair so neither
// is dropped when that block is next edited.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const renderSource = readFileSync("src/pdf/pdfjs.ts", "utf8");
const pageSource = readFileSync("src/reader/fixed/PdfPageSource.ts", "utf8");

/** The statements, with comments and whitespace stripped — a rule that a
 *  comment mentioning the property could satisfy would prove nothing. */
function code(src: string): string {
  return src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n")
    .replace(/\s+/g, " ");
}

describe("the shared render path", () => {
  it("clears font-size-adjust on every canvas it draws into", () => {
    expect(code(renderSource)).toContain(
      'canvas.style.fontSizeAdjust = "none"',
    );
  });

  it("still pins the drawing direction", () => {
    expect(code(renderSource)).toContain('canvas.style.direction = "ltr"');
  });
});

describe("the mounted page wrap", () => {
  it("clears font-size-adjust, so the text layer measures unscaled too", () => {
    // The text layer's span boxes are what a selection's rects are built
    // from; scaled glyphs there put a highlight somewhere else.
    expect(code(pageSource)).toContain("font-size-adjust:none");
  });

  it("still pins direction on the wrap", () => {
    expect(code(pageSource)).toContain("direction:ltr");
  });
});
