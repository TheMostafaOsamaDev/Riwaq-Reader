// The Progress panel shows the book's progress as the reader measured it.
//
// It used to work out its own `(chapter + 1) / count`: a whole chapter ahead
// of the reader's bar on chapter 1, and 100% the moment the last chapter
// opened. It is handed the shared number now (reader/bookProgress.ts).

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { THEMES } from "../styles/tokens";
import { ProgressOverlay } from "./ProgressOverlay";

function render(percent: number, currentChapter: number, chapterCount: number) {
  return renderToStaticMarkup(
    <I18nProvider locale="en">
      <ProgressOverlay
        theme={THEMES.sepia}
        themeKey="sepia"
        percent={percent}
        currentChapter={currentChapter}
        chapterCount={chapterCount}
        chapterTitle="A Chapter"
      />
    </I18nProvider>,
  );
}

describe("ProgressOverlay", () => {
  it("shows the percent it is handed, not a chapter count", () => {
    // Chapter 5 of 10, half read: 45%. The old formula said 50%.
    const html = render(45, 4, 10);
    expect(html).toContain(">45<");
    expect(html).not.toContain(">50<");
  });

  it("does not claim 100% for a last chapter just opened", () => {
    expect(render(90, 9, 10)).toContain(">90<");
  });
});
