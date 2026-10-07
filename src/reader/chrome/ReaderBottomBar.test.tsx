// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { THEMES } from "../../styles/tokens";
import type { ReaderBarStyle } from "../../types/reader";
import { panelsOnBar, READER_BAR_STYLES } from "./barStyles";
import { ReaderBottomBar } from "./ReaderBottomBar";
import type { ReaderPanel } from "./ReaderTabBar";
import { en } from "../../i18n/en";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(style: ReaderBarStyle, onOpen = vi.fn(), hidden = false) {
  act(() =>
    root.render(
      <I18nProvider locale="en">
        <ReaderBottomBar
          theme={THEMES.sepia}
          style={style}
          slider={<div data-testid="slider" />}
          place={{
            fraction: 0.34,
            title: "The crocodile pond",
            position: "Chapter 12 of 48",
            percent: "34%",
            detail: "8 min left",
          }}
          seek={{
            rtl: false,
            formatLabel: () => "",
            onSeek: () => {},
            ariaLabel: "Chapter progress",
          }}
          active={null}
          onOpen={onOpen}
          showProgress
          onToggleProgress={() => {}}
          frame={{}}
          hidden={hidden}
        />
      </I18nProvider>,
    ),
  );
  return onOpen;
}

/** The control that opens `panel`, found by the words a user would see or
 *  hear — a short label on the labelled styles, the full name elsewhere. */
function buttonFor(panel: ReaderPanel): HTMLButtonElement | null {
  const names: Record<ReaderPanel, string[]> = {
    toc: [en["reader.toc"], en["reader.bar.contents"]],
    highlights: [en["reader.highlights"], en["reader.bar.highlights"]],
    progress: [en["reader.progress"], en["reader.bar.progress"]],
    settings: [en["reader.settings"], en["reader.bar.text"]],
  };
  return (
    [...host.querySelectorAll("button")].find(
      (b) =>
        names[panel].includes(b.getAttribute("aria-label") ?? "") ||
        names[panel].includes(b.textContent?.trim() ?? ""),
    ) ?? null
  );
}

describe("ReaderBottomBar", () => {
  it.each(READER_BAR_STYLES)(
    "%s opens each panel it puts on the bar",
    (style) => {
      const onOpen = render(style);
      for (const p of panelsOnBar(style)) {
        const b = buttonFor(p);
        expect(b, `${style}: ${p}`).not.toBeNull();
        act(() => b?.click());
        expect(onOpen).toHaveBeenLastCalledWith(p);
      }
    },
  );

  it.each(READER_BAR_STYLES)("%s says when it is away", (style) => {
    render(style, vi.fn(), true);
    expect(
      host.querySelector("[data-reader-bar]")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it.each(["capsule", "corners"] as const)(
    "%s keeps the slider folded until you tap where you are",
    (style) => {
      render(style);
      expect(host.querySelector('[data-testid="slider"]')).toBeNull();
      const place = [...host.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-expanded") === "false",
      );
      act(() => place?.click());
      expect(host.querySelector('[data-testid="slider"]')).not.toBeNull();
    },
  );

  it("folds the floating slider away when the bar goes", () => {
    render("capsule");
    const place = [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-expanded") === "false",
    );
    act(() => place?.click());
    render("capsule", vi.fn(), true);
    expect(host.querySelector('[data-testid="slider"]')).toBeNull();
  });

  it("shows the time left on the status line", () => {
    render("status");
    expect(host.textContent).toContain("8 min left");
    expect(host.querySelector('[role="slider"]')).not.toBeNull();
  });
});
