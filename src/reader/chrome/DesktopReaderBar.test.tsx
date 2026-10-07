// @vitest-environment happy-dom
// The desktop reader's bottom bar in each of the six styles. What matters is
// what each one offers — a slider, steps in words, a seek line, two corner
// buttons — and that the floating ones leave the page under them clickable.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { THEMES } from "../../styles/tokens";
import type { ReaderBarStyle } from "../../types/reader";
import { READER_BAR_STYLES } from "./barStyles";
import { DesktopReaderBar } from "./DesktopReaderBar";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(style: ReaderBarStyle, opts: { atStart?: boolean } = {}) {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <I18nProvider locale="en">
        <DesktopReaderBar
          theme={THEMES.sepia}
          style={style}
          outer={{ position: "absolute", bottom: 0 }}
          inner={null}
          slider={<div data-testid="slider" />}
          bigSlider={<div data-testid="big-slider" />}
          place={{
            fraction: 0.25,
            title: "The Long Night",
            position: "Chapter 12 of 48",
            percent: "25%",
            detail: "8 min left",
          }}
          seek={{
            rtl: false,
            formatLabel: () => "",
            onSeek: () => {},
            ariaLabel: "Chapter progress",
          }}
          prev={{
            label: "Previous chapter",
            onClick: onPrev,
            disabled: !!opts.atStart,
          }}
          next={{ label: "Next chapter", onClick: onNext, disabled: false }}
        />
      </I18nProvider>,
    ),
  );
  const bar = host.querySelector<HTMLElement>("[data-desktop-reader-bar]");
  if (!bar) throw new Error("no bar");
  return { bar, onPrev, onNext };
}

const button = (bar: HTMLElement, label: string) =>
  [...bar.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
  );

describe("DesktopReaderBar", () => {
  it("renders every style the phone has", () => {
    for (const style of READER_BAR_STYLES) {
      expect(mount(style).bar.dataset.desktopReaderBar).toBe(style);
      act(() => root?.unmount());
      host?.remove();
    }
  });

  it("classic is the desktop's own slider, unchanged", () => {
    const { bar } = mount("classic");
    expect(bar.querySelector('[data-testid="slider"]')).not.toBeNull();
    expect(bar.querySelector('[role="slider"]')).toBeNull();
  });

  it("slider-first shows the large slider instead", () => {
    const { bar } = mount("slider");
    expect(bar.querySelector('[data-testid="big-slider"]')).not.toBeNull();
    expect(bar.querySelector('[data-testid="slider"]')).toBeNull();
  });

  it("labelled says what its buttons do, and where you are", () => {
    const { bar, onNext } = mount("labelled");
    expect(bar.textContent).toContain("The Long Night");
    expect(bar.textContent).toContain("Chapter 12 of 48 · 25%");
    act(() => button(bar, "Next chapter")?.click());
    expect(onNext).toHaveBeenCalledOnce();
    expect(bar.querySelector('[role="slider"]')).not.toBeNull();
  });

  it("status shows the minutes left and can still seek", () => {
    const { bar } = mount("status");
    expect(bar.textContent).toContain("8 min left · 25%");
    expect(bar.querySelector('[role="slider"]')).not.toBeNull();
  });

  it("corners are two named buttons, and the first chapter has no previous", () => {
    const { bar, onPrev } = mount("corners", { atStart: true });
    const prev = button(bar, "Previous chapter");
    expect(prev?.disabled).toBe(true);
    act(() => prev?.click());
    expect(onPrev).not.toHaveBeenCalled();
    expect(button(bar, "Next chapter")).toBeDefined();
  });

  it("only the floating styles let clicks through to the page", () => {
    for (const style of READER_BAR_STYLES) {
      const { bar } = mount(style);
      const through = bar.style.pointerEvents === "none";
      expect(through).toBe(
        style === "capsule" || style === "status" || style === "corners",
      );
      act(() => root?.unmount());
      host?.remove();
    }
  });
});
