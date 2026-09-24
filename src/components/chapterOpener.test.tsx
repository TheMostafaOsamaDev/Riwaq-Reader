// What face a chapter's opening title is set in, and at what size.
//
// Static markup is enough: these are questions about what gets emitted, not
// about interaction. Rendered through react-dom/server rather than a DOM so
// the declared `font-family` and `font-size` come back verbatim.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeTr, type Locale } from "../i18n";
import { I18nProvider } from "../i18n/I18nProvider";
import { FONT_CHAPTER_DISPLAY, FONT_STACKS, THEMES } from "../styles/tokens";
import { ChapterOpener } from "./ChapterOpener";
import { chapterTitleSize } from "./chapterTitleSize";

const TITLE = "الفصل الثالث";
type Props = Parameters<typeof ChapterOpener>[0];

function render(props: Partial<Props> = {}, locale: Locale = "ar") {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <ChapterOpener
        theme={THEMES.sepia}
        order={2}
        title={TITLE}
        bodyApparent={17}
        faceScale={1}
        fontFamily={FONT_STACKS.readex}
        tr={makeTr(locale)}
        locale={locale}
        {...props}
      />
    </I18nProvider>,
  );
}

/** How React escapes a stack's quotes into a style attribute. */
const asAttr = (stack: string) => stack.replace(/"/g, "&quot;");

/** Every `font-size:Npx` the block declares, largest first. The title is the
 *  largest thing in an opening by construction, so its own size is [0] — no
 *  marker attribute has to be added to production code to find it. */
function fontSizes(html: string): number[] {
  return [...html.matchAll(/font-size:([\d.]+)px/g)]
    .map((m) => Number(m[1]))
    .sort((a, b) => b - a);
}

describe("the chapter opening title", () => {
  it("is set in the reader's own reading face", () => {
    // It used to be locked to one display face, so choosing a font changed
    // every word on the page except the chapter's name.
    const html = render({ fontFamily: FONT_STACKS.lateef });
    expect(html).toContain(asAttr(FONT_STACKS.lateef));
    expect(html).not.toContain(asAttr(FONT_CHAPTER_DISPLAY));
  });

  it("follows the face the reader actually picked, not a default", () => {
    for (const stack of [
      FONT_STACKS.notonaskh,
      FONT_STACKS.cairo,
      FONT_STACKS.lalezar,
    ]) {
      expect(render({ fontFamily: stack })).toContain(asAttr(stack));
    }
  });

  it("sizes the title through the same face correction the body carries", () => {
    // The title's px is the apparent size times the chosen face's scale —
    // the identical number the body is multiplied by — so the two keep their
    // ratio on every face. A face needing a big correction must not get a
    // proportionally bigger title.
    for (const faceScale of [0.8, 1, 1.39, 1.75]) {
      const html = render({ faceScale, bodyApparent: 17 });
      expect(fontSizes(html)[0]).toBeCloseTo(
        chapterTitleSize(17, false, faceScale),
        2,
      );
    }
  });

  it("keeps the title a fixed multiple of the body on every face", () => {
    // Stated the way a reader would notice it: same slider position, two
    // different fonts, the opening reads the same amount bigger than its
    // chapter in both.
    const ratios = [0.8, 1, 1.39, 1.75].map((faceScale) => {
      const titlePx = fontSizes(render({ faceScale, bodyApparent: 17 }))[0];
      return titlePx / (17 * faceScale);
    });
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 6);
  });
});
