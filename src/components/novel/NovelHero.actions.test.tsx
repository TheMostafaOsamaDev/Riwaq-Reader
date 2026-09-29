// @vitest-environment happy-dom
//
// The novel page's actions on a phone: Read across the full width, then the
// rest as a two-column grid of equal pills (`.riwaq-hero-actions` in
// global.css). They used to share one wrapping row of content-sized pills,
// and on a ~384px phone every pill wrapped onto its own line at its own
// width. Desktop keeps that row, where it fits, unchanged.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { Locale } from "../../i18n";
import type { SourceNovel } from "../../sources/types";
import { THEMES } from "../../styles/tokens";
import { NovelHero, type NovelHeroProps } from "./NovelHero";

const NOVEL: SourceNovel = {
  title: "القس المجنون",
  author: "Gu Zhen Ren",
  language: "ar",
  direction: "rtl",
  tags: [],
  meta: [],
  volumes: [],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(
  props: Partial<NovelHeroProps> = {},
  locale: Locale = "en",
): void {
  const noop = () => {};
  act(() => {
    root.render(
      <I18nProvider locale={locale}>
        <NovelHero
          theme={THEMES.dark}
          layout="mobile"
          novel={NOVEL}
          sourceName="Source"
          working={false}
          chapterCount={2372}
          inLibrary={false}
          localCoverUrl={null}
          libraryCheckDone
          onRead={noop}
          onAddToLibrary={noop}
          onRemoveFromLibrary={noop}
          onOpenRangeDialog={noop}
          {...props}
        />
      </I18nProvider>,
    );
  });
}

/** In the library, with shelves and offline saving: every action. */
const IN_LIBRARY: Partial<NovelHeroProps> = {
  inLibrary: true,
  onOpenShelfList: () => {},
  onOpenSaveOffline: () => {},
};

const actions = () => [
  ...host.querySelectorAll<HTMLElement>(
    ".riwaq-hero-actions [data-hero-action]",
  ),
];
const order = () => actions().map((a) => a.dataset.heroAction);
const pill = (key: string) =>
  host.querySelector<HTMLButtonElement>(`[data-hero-action="${key}"] button`);
const labels = () => actions().map((a) => a.textContent?.trim());

describe("NovelHero actions on a phone", () => {
  it("puts Read first and Remove last, away from it", () => {
    render(IN_LIBRARY);
    expect(order()).toEqual(["read", "shelves", "range", "offline", "remove"]);
  });

  it("offers Add in Remove's place for a novel not in the library", () => {
    render();
    expect(order()).toEqual(["read", "add", "range"]);
    expect(pill("add")?.textContent?.trim()).toBe("Add to library");
  });

  it("uses short names, with the full name as the tooltip", () => {
    render(IN_LIBRARY);
    expect(labels()).toEqual([
      "Read",
      "Shelves",
      "Download",
      "Save offline",
      "Remove",
    ]);
    expect(pill("range")?.title).toBe("Download range");
    expect(pill("offline")?.title).toBe("Save as offline book");
    expect(pill("remove")?.title).toBe("Remove from library");
  });

  it("has a short name for every pill in Arabic too", () => {
    render(IN_LIBRARY, "ar");
    expect(labels()).toEqual([
      "قراءة",
      "الأرفف",
      "تنزيل",
      "حفظ محليًا",
      "إزالة",
    ]);
  });

  it("marks Remove as destructive", () => {
    render(IN_LIBRARY);
    // Button's onImage destructive treatment: the warm red text and outline.
    expect(pill("remove")?.style.color).toBe("#ff9c86");
    expect(pill("range")?.style.color).toBe("#ffffff");
  });

  // Two per row: an odd number leaves the last alone, and it takes the whole
  // row rather than half of one.
  it("marks a lone last pill to span the row", () => {
    render(IN_LIBRARY);
    expect(host.querySelectorAll("[data-hero-span]")).toHaveLength(0);
    render({ inLibrary: true, onOpenShelfList: () => {} }); // 3 beside Read
    expect(
      [...host.querySelectorAll<HTMLElement>("[data-hero-span]")].map(
        (a) => a.dataset.heroAction,
      ),
    ).toEqual(["remove"]);
  });

  // "Removing…" is wider than half a phone's row allows, so the pill keeps
  // its word and goes busy instead: a spinner in place of its icon.
  it("goes busy in place while the library action works", () => {
    render({ ...IN_LIBRARY, working: true });
    expect(pill("remove")?.textContent?.trim()).toBe("Remove");
    expect(pill("remove")?.getAttribute("aria-busy")).toBe("true");
    expect(pill("remove")?.disabled).toBe(true);
    render({ working: true });
    expect(pill("add")?.textContent?.trim()).toBe("Add to library");
    expect(pill("add")?.getAttribute("aria-busy")).toBe("true");
  });
});

describe("NovelHero actions on desktop", () => {
  const buttons = () =>
    [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());

  it("keeps the single row of labelled pills, as before", () => {
    render({ ...IN_LIBRARY, layout: "desktop" });
    expect(host.querySelector(".riwaq-hero-actions")).toBeNull();
    expect(buttons()).toEqual([
      "Read",
      "Remove from library",
      "Shelves",
      "Download range",
      "Save as offline book",
    ]);
  });

  it("still says what the library pill is doing while it works", () => {
    render({ ...IN_LIBRARY, layout: "desktop", working: true });
    expect(buttons()[1]).toBe("Removing…");
  });
});
