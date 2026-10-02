// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { ReleaseNotes } from "../../store/releaseNotes";
import { THEMES } from "../../styles/tokens";
import { NotesView } from "./NotesView";
import { StoryPages } from "./StoryPages";

const notes: ReleaseNotes = {
  version: "0.6.0",
  date: "2026-10-15",
  highlight: {
    title: { en: "Make it yours", ar: "على ذوقك" },
    body: { en: "Four styles", ar: "أربعة أنماط" },
  },
  stories: [
    {
      title: { en: "Page one", ar: "الصفحة الأولى" },
      body: { en: "b1", ar: "ج١" },
    },
    {
      title: { en: "Page two", ar: "الصفحة الثانية" },
      body: { en: "b2", ar: "ج٢" },
    },
  ],
  items: [
    { kind: "new", en: "In-app updates", ar: "تحديثات داخل التطبيق" },
    { kind: "fixed", en: "No double import", ar: "لا استيراد مزدوج" },
  ],
};

function render(ui: React.ReactNode, lang: "en" | "ar") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() =>
    createRoot(host).render(<I18nProvider locale={lang}>{ui}</I18nProvider>),
  );
  return host;
}

describe("NotesView", () => {
  it("shows the highlight, then every item with a worded tag, in English", () => {
    const h = render(<NotesView notes={notes} theme={THEMES.sepia} />, "en");
    expect(h.textContent).toContain("Make it yours");
    expect(h.textContent).toContain("In-app updates");
    expect(h.textContent).toContain("New");
    expect(h.textContent).toContain("Fixed");
  });
  it("renders the Arabic strings in Arabic", () => {
    const h = render(<NotesView notes={notes} theme={THEMES.sepia} />, "ar");
    expect(h.textContent).toContain("لا استيراد مزدوج");
    expect(h.textContent).toContain("إصلاح");
  });
  it("falls back to a GitHub link when there are no notes", () => {
    const h = render(
      <NotesView notes={null} theme={THEMES.sepia} fallbackVersion="0.6.0" />,
      "en",
    );
    expect(h.textContent).toContain("Riwaq 0.6.0 is available");
    expect(h.textContent).toContain("Release notes on GitHub");
  });
});

describe("StoryPages", () => {
  it("steps through pages and finishes with onDone", () => {
    // Each page ignores clicks for ARM_MS (see useArmed): wait it out.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const settle = () => act(() => vi.advanceTimersByTime(1000));
    let done = 0;
    const h = render(
      <StoryPages
        notes={notes}
        theme={THEMES.sepia}
        onDone={() => {
          done++;
        }}
      />,
      "en",
    );
    expect(h.textContent).toContain("Page one");
    const primary = () =>
      h.querySelectorAll("button")[
        h.querySelectorAll("button").length - 1
      ] as HTMLButtonElement;
    expect(primary().textContent).toBe("Next");
    settle();
    act(() => primary().click());
    expect(h.textContent).toContain("Page two");
    expect(primary().textContent).toBe("Start reading");
    settle();
    act(() => primary().click());
    expect(done).toBe(1);
    vi.useRealTimers();
  });
  it("renders Arabic page text", () => {
    const h = render(
      <StoryPages notes={notes} theme={THEMES.sepia} onDone={() => {}} />,
      "ar",
    );
    expect(h.textContent).toContain("الصفحة الأولى");
  });
});
