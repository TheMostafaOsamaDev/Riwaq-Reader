// Render checks for the end-of-chapter block.
//
// Static markup is enough for everything asserted here — these are questions
// about what gets emitted, not about interaction, so there is no need for a
// DOM environment or a testing library.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChapterEndCard } from "./ChapterEnd";
import { I18nProvider } from "../i18n/I18nProvider";
import { makeTr, type Locale } from "../i18n";
import { FONT_CHAPTER_DISPLAY, THEMES } from "../styles/tokens";

const NEXT = "أساطير رين زو - الجزء 2";

type Props = Parameters<typeof ChapterEndCard>[0];

function render(props: Partial<Props> = {}, locale: Locale = "ar") {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <ChapterEndCard
        theme={THEMES.sepia}
        tr={makeTr(locale)}
        compact
        nextTitle={NEXT}
        nextNumber={3}
        total={2372}
        availability="device"
        onNext={() => {}}
        onOpenToc={() => {}}
        onTopOfChapter={() => {}}
        {...props}
      />
    </I18nProvider>,
  );
}

describe("ChapterEndCard — marginal pair", () => {
  it("gives the turn a border and no fill", () => {
    const html = render();
    // The block this replaced carried a chrome fill AND a border AND a radius.
    // The fill is the part that went.
    expect(html).toContain("background:transparent");
    expect(html).not.toContain(THEMES.sepia.chrome);
    // The border is what is left saying "control", so it has to be there.
    expect(html).toMatch(/border:1px solid rgba\(58,47,31,0\.35\)/);
  });

  it("sets the next chapter's name in the face a chapter OPENS in", () => {
    // Same face as ChapterOpener's title: the name a reader sees here is the
    // name they see at the top of the next screen.
    expect(render()).toContain(FONT_CHAPTER_DISPLAY.replace(/"/g, "&quot;"));
  });

  it("carries the two marginal moves, and never inside the turn", () => {
    const html = render({}, "en");
    expect(html).toContain("Table of contents");
    expect(html).toContain("Top of chapter");
    // They are underlined links on bare paper, not filled controls.
    expect(html).toContain("text-decoration:underline");
    // Nested <button> is invalid HTML and would make the turn unclickable in
    // the region the links occupy.
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
  });

  it("keeps every marginal target at the platform minimum", () => {
    // 44px of hit area around an 11.5px line — the ink stays marginal, the
    // target does not. Conflating the two is the trap this layout invites.
    expect([...render().matchAll(/min-height:44px/g)]).toHaveLength(2);
  });

  it("clears the phone's bottom chrome, which overlays the scroll area", () => {
    // Measured on device: the chrome is 124px tall and the scroller adds 44px
    // of its own, so the 56px that used to be here left the last 24px of both
    // links underneath it — controls you could see and could not tap. The
    // env() matters because the chrome grows by the gesture inset on hardware
    // that has one, and that inset measures 0 on the emulator.
    expect(render()).toContain(
      "padding:0 20px calc(env(safe-area-inset-bottom, 0px) + 96px)",
    );
  });

  it("sets numerals in the reading locale's own digits", () => {
    // What shipped interpolated the numbers raw, so an Arabic reader got
    // "الفصل 3 من 2372" — Latin digits inside an Arabic sentence.
    // ChapterStartLink documents the identical trap.
    expect(render()).toContain("الفصل ٣ من ٢٣٧٢");
    expect(render({}, "en")).toContain("Chapter 3 of 2372");
  });

  it("states the full chapter total, never a truncated one", () => {
    const html = render({}, "en");
    // Truncating this line renders "3 of 2372" as "3 of 72" — a plausible
    // WRONG number. It must be allowed to wrap instead.
    expect(html).toContain("flex-wrap:wrap");
    expect(html).not.toContain("text-overflow:ellipsis");
  });

  it("still offers both moves at the end of the BOOK", () => {
    // No turn left to take, but every reason to want the contents.
    const html = render({ nextTitle: null }, "en");
    expect(html).toContain("End of the book");
    expect(html).not.toContain(NEXT);
    expect(html).toContain("Table of contents");
    expect(html).toContain("Top of chapter");
  });

  it("drops Latin tracking and casing in Arabic", () => {
    // Arabic is cursive: letter-spacing prises the joins apart, and there is
    // no case to upper.
    expect(render()).not.toContain("text-transform:uppercase");
    expect(render({}, "en")).toContain("text-transform:uppercase");
  });
});
