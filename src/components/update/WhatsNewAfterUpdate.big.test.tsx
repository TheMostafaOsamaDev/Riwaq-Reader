// @vitest-environment happy-dom
//
// A BIG release (one with `stories`). The user's rule (2026-10-02): desktop
// never shows story pages; it always gets the centred dialog, scrolling its
// body when the release is long. The phone keeps the story pages.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("virtual:whats-new", () => ({
  default: {
    version: "0.6.0",
    date: "2026-10-15",
    highlight: {
      title: { en: "Make the library yours", ar: "اجعل المكتبة على ذوقك" },
      body: { en: "Four card styles.", ar: "أربعة أنماط." },
    },
    stories: [
      {
        kind: "new",
        title: { en: "Story one", ar: "القصة الأولى" },
        body: { en: "First body", ar: "النص الأول" },
      },
      {
        kind: "improved",
        title: { en: "Story two", ar: "القصة الثانية" },
        body: { en: "Second body", ar: "النص الثاني" },
      },
      {
        title: { en: "Story three", ar: "القصة الثالثة" },
        body: { en: "Third body", ar: "النص الثالث" },
      },
    ],
    items: [
      { kind: "new", en: "Item A", ar: "بند أ" },
      { kind: "fixed", en: "Item B", ar: "بند ب" },
    ],
  },
  appVersion: "0.6.0",
  images: {},
}));

import type { Locale } from "../../i18n";
import { I18nProvider } from "../../i18n/I18nProvider";
import { THEMES } from "../../styles/tokens";
import { WhatsNewAfterUpdate } from "./WhatsNewAfterUpdate";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function mount(layout: "mobile" | "desktop", locale: Locale = "en") {
  const onClose = vi.fn();
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <I18nProvider locale={locale}>
        <WhatsNewAfterUpdate
          theme={THEMES.sepia}
          open
          onClose={onClose}
          layout={layout}
        />
      </I18nProvider>,
    );
  });
  return onClose;
}
const dialog = () =>
  document.querySelector('[aria-labelledby="whats-new-title"]');
const gotIt = () =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Got it",
  );

describe("WhatsNewAfterUpdate, big release", () => {
  it("desktop: no story pages; one dialog with the highlight, every story, every item, in order", async () => {
    await mount("desktop");
    const d = dialog();
    expect(d?.getAttribute("role")).toBe("dialog");
    // StoryPages' own markers: its Next button and page dots.
    expect(document.body.textContent).not.toContain("Next");
    expect(
      document.querySelector('[role="img"][aria-label^="Page"]'),
    ).toBeNull();
    const text = d?.textContent ?? "";
    const order = [
      "Make the library yours",
      "Story one",
      "First body",
      "Story two",
      "Story three",
      "Third body",
      "Item A",
      "Item B",
    ];
    let at = -1;
    for (const t of order) {
      const i = text.indexOf(t);
      expect(i, t).toBeGreaterThan(at);
      at = i;
    }
  });

  it("desktop: the body scrolls; the header and Got it stay outside it", async () => {
    await mount("desktop");
    const body = document.querySelector<HTMLElement>("[data-whats-new-body]");
    expect(body).toBeTruthy();
    expect(body?.style.overflowY).toBe("auto");
    expect(body?.style.overscrollBehavior).toBe("contain");
    // Keyboard-scrollable: a named, focusable region.
    expect(body?.getAttribute("tabindex")).toBe("0");
    expect(body?.getAttribute("role")).toBe("region");
    expect(body?.getAttribute("aria-label")).toBeTruthy();
    expect(body?.contains(gotIt() ?? null)).toBe(false);
    expect(body?.contains(document.getElementById("whats-new-title"))).toBe(
      false,
    );
    expect(body?.textContent).toContain("Story two");
    const d = dialog() as HTMLElement;
    expect(d.style.maxHeight).toContain("80vh");
  });

  it("desktop: Got it ignores a click within the arming delay, then closes", async () => {
    const onClose = await mount("desktop");
    await act(async () => gotIt()?.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(gotIt()?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => gotIt()?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("desktop: Escape closes", async () => {
    const onClose = await mount("desktop");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("desktop, Arabic: the stories render in Arabic", async () => {
    await mount("desktop", "ar");
    expect(dialog()?.textContent).toContain("القصة الثالثة");
  });

  it("mobile: still the story pages", async () => {
    await mount("mobile");
    expect(dialog()).toBeNull();
    expect(document.body.textContent).toContain("Story one");
    expect(document.body.textContent).toContain("Next");
  });
});
