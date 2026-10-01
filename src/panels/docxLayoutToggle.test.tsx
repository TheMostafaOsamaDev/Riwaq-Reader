// @vitest-environment happy-dom
//
// The DOCX layout toggle lives on the SHARED settings panel, which the fixed
// reader and both reflowable readers all render. That is the whole point: one
// row gives every reader the switch, so flowing text is never a one-way door.
//
// These assert the row's presence is driven by the props alone, because that
// is what decides whether a PDF sees a control it has no second mode for.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { SettingsPanel } from "./SettingsPanel";
import { THEMES } from "../styles/tokens";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";

let host: HTMLDivElement;
let root: Root;

const theme = THEMES.light;
// The real defaults: the reflow variant's controls read a dozen fields, and
// a hand-stubbed object just moves the failure to whichever one it forgot.
const tweaks = { ...DEFAULT_TWEAKS, uiLang: "en" as const };

function mount(node: React.ReactNode) {
  act(() => {
    root.render(<I18nProvider locale="en">{node}</I18nProvider>);
  });
}

/** Text of every segmented-control button in the panel. */
function segLabels(): string[] {
  return [...host.querySelectorAll("button[aria-pressed]")].map((b) =>
    (b.textContent ?? "").trim(),
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("DOCX layout toggle", () => {
  it("is absent when no reading mode is supplied (PDF, EPUB)", () => {
    mount(
      <SettingsPanel
        variant="fixed"
        theme={theme}
        themeKey="light"
        t={tweaks}
        setTweak={() => {}}
        onClose={() => {}}
        zoom={1}
        onZoomChange={() => {}}
      />,
    );
    expect(segLabels()).not.toContain("Flowing text (EPUB mode)");
  });

  it("offers both layouts on the fixed reader's panel", () => {
    mount(
      <SettingsPanel
        variant="fixed"
        theme={theme}
        themeKey="light"
        t={tweaks}
        setTweak={() => {}}
        onClose={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        docxMode="pages"
        onDocxModeChange={() => {}}
      />,
    );
    expect(segLabels()).toContain("Pages");
    expect(segLabels()).toContain("Flowing text (EPUB mode)");
  });

  // The way back. A reader who switched to flowing text is now on the
  // reflowable panel; without this the switch would be one-way.
  it("offers both layouts on the reflowable reader's panel too", () => {
    mount(
      <SettingsPanel
        theme={theme}
        themeKey="light"
        t={tweaks}
        setTweak={() => {}}
        onClose={() => {}}
        docxMode="flow"
        onDocxModeChange={() => {}}
      />,
    );
    expect(segLabels()).toContain("Pages");
    expect(segLabels()).toContain("Flowing text (EPUB mode)");
  });

  it("marks the current layout as the pressed option", () => {
    mount(
      <SettingsPanel
        theme={theme}
        themeKey="light"
        t={tweaks}
        setTweak={() => {}}
        onClose={() => {}}
        docxMode="flow"
        onDocxModeChange={() => {}}
      />,
    );
    const pressed = [...host.querySelectorAll('button[aria-pressed="true"]')]
      .map((b) => (b.textContent ?? "").trim())
      .filter((l) => l === "Pages" || l === "Flowing text (EPUB mode)");
    expect(pressed).toEqual(["Flowing text (EPUB mode)"]);
  });

  it("reports the layout the reader chose", () => {
    const onChange = vi.fn();
    mount(
      <SettingsPanel
        theme={theme}
        themeKey="light"
        t={tweaks}
        setTweak={() => {}}
        onClose={() => {}}
        docxMode="pages"
        onDocxModeChange={onChange}
      />,
    );
    const flow = [...host.querySelectorAll("button[aria-pressed]")].find(
      (b) => (b.textContent ?? "").trim() === "Flowing text (EPUB mode)",
    ) as HTMLButtonElement;
    act(() => flow.click());
    expect(onChange).toHaveBeenCalledWith("flow");
  });
});
