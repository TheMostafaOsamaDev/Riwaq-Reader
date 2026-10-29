// @vitest-environment happy-dom
//
// The Text color row sits under Theme on the SHARED settings panel. Like the
// DOCX layout toggle, whether it shows is decided by the props alone: every
// reflowable book gets it, a DOCX on the fixed reader gets it, a PDF does not
// (its pages are pictures, so there is no text to recolour).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import type { MsgKey } from "../i18n";
import { ar } from "../i18n/ar";
import { en } from "../i18n/en";
import { I18nProvider } from "../i18n/I18nProvider";
import { DEFAULT_TEXT_COLORS, TEXT_COLOR_IDS, THEMES } from "../styles/tokens";
import { SettingsPanel } from "./SettingsPanel";

let host: HTMLDivElement;
let root: Root;

const tweaks = { ...DEFAULT_TWEAKS, uiLang: "en" as const };

function mount(node: React.ReactNode) {
  act(() => {
    root.render(<I18nProvider locale="en">{node}</I18nProvider>);
  });
}

const rows = () =>
  host.querySelectorAll<HTMLElement>('[role="group"][aria-label="Text color"]');
const row = () => rows()[0] ?? null;
const chips = () => [
  ...(row()?.querySelectorAll<HTMLButtonElement>("button") ?? []),
];
const names = () => chips().map((b) => b.getAttribute("aria-label"));

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Text color row", () => {
  it("shows five named colors in the reflow panel", () => {
    mount(
      <SettingsPanel
        theme={THEMES.light}
        themeKey="light"
        t={tweaks}
        setTweak={() => {}}
      />,
    );
    expect(names()).toEqual(["Default", "Soft", "Graphite", "Navy", "Brown"]);
  });

  it("shows on a DOCX in the fixed panel, not on a PDF", () => {
    const fixed = (docx: boolean) => (
      <SettingsPanel
        variant="fixed"
        theme={THEMES.light}
        themeKey="light"
        t={tweaks}
        setTweak={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        {...(docx ? { docxMode: "pages", onDocxModeChange: () => {} } : {})}
      />
    );
    mount(fixed(false));
    expect(row()).toBeNull();
    mount(fixed(true));
    expect(row()).not.toBeNull();
  });

  it("appears once for a DOCX laid out as flowing text", () => {
    mount(
      <SettingsPanel
        theme={THEMES.light}
        themeKey="light"
        t={tweaks}
        setTweak={() => {}}
        docxMode="flow"
        onDocxModeChange={() => {}}
      />,
    );
    expect(rows()).toHaveLength(1);
  });

  // Under System the panel is already drawn in the theme System landed on;
  // the row edits that theme's pick and no other.
  it("picks for the theme on screen and leaves the others", () => {
    const setTweak = vi.fn();
    mount(
      <SettingsPanel
        theme={THEMES.dark}
        themeKey="dark"
        t={{ ...tweaks, theme: "system" }}
        setTweak={setTweak}
      />,
    );
    const amber = chips().find((b) => b.getAttribute("aria-label") === "Amber");
    act(() => amber?.click());
    expect(setTweak).toHaveBeenCalledWith("textColor", {
      ...DEFAULT_TEXT_COLORS,
      dark: "amber",
    });
  });

  it("names the theme it is editing", () => {
    mount(
      <SettingsPanel
        theme={THEMES.dark}
        themeKey="dark"
        t={{ ...tweaks, theme: "system" }}
        setTweak={() => {}}
      />,
    );
    const field = row()?.parentElement;
    expect(field?.textContent).toContain("for Dark");
  });

  it("marks the current pick", () => {
    mount(
      <SettingsPanel
        theme={THEMES.light}
        themeKey="light"
        t={{ ...tweaks, textColor: { ...DEFAULT_TEXT_COLORS, light: "navy" } }}
        setTweak={() => {}}
      />,
    );
    const pressed = chips()
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.getAttribute("aria-label"));
    expect(pressed).toEqual(["Navy"]);
  });

  it("has an English and an Arabic name for every color", () => {
    for (const id of TEXT_COLOR_IDS) {
      expect(en[`settings.textColor.${id}` as MsgKey]).toBeTruthy();
      expect(ar[`settings.textColor.${id}` as MsgKey]).toBeTruthy();
    }
  });
});
