// @vitest-environment happy-dom
//
// The novel page's action cluster, on both layouts: Read as the one labelled
// primary, then Download and Shelves as icon-only buttons, then a ⋮ holding
// whatever is left. One row, phone and desktop alike — the five labelled
// pills this replaces needed a two-column grid to fit a phone at all.
//
// Icon-only buttons live or die by their accessible names, so most of what
// is asserted here is the name on each one rather than the glyph inside it.

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

const slots = () => [
  ...host.querySelectorAll<HTMLElement>(
    ".riwaq-hero-actions [data-hero-action]",
  ),
];
const order = () => slots().map((s) => s.dataset.heroAction);
const button = (key: string) =>
  host.querySelector<HTMLButtonElement>(`[data-hero-action="${key}"] button`);

/** The ⋮ menu's rows, which only exist once it has been opened. */
const rows = () => [
  ...document.querySelectorAll<HTMLButtonElement>("[data-menu-action]"),
];
const row = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-menu-action="${id}"]`);

function openMenu(): void {
  act(() => {
    button("more")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("the novel page's action cluster", () => {
  it("labels Read and leaves the rest as icons", () => {
    render(IN_LIBRARY);
    expect(order()).toEqual(["read", "range", "shelves", "more"]);
    expect(button("read")?.textContent?.trim()).toBe("Read");
    for (const key of ["range", "shelves", "more"]) {
      expect(button(key)?.textContent?.trim()).toBe("");
    }
  });

  it("names every icon-only button, for a screen reader and on hover", () => {
    render(IN_LIBRARY);
    const named = (key: string) => [
      button(key)?.getAttribute("aria-label"),
      button(key)?.title,
    ];
    expect(named("range")).toEqual(["Download range", "Download range"]);
    expect(named("shelves")).toEqual(["Shelves", "Shelves"]);
    expect(named("more")).toEqual(["More actions", "More actions"]);
  });

  it("names them in Arabic too", () => {
    render(IN_LIBRARY, "ar");
    expect(button("read")?.textContent?.trim()).toBe("قراءة");
    expect(button("range")?.getAttribute("aria-label")).toBe("تنزيل نطاق");
    expect(button("shelves")?.getAttribute("aria-label")).toBe("الأرفف");
    expect(button("more")?.getAttribute("aria-label")).toBe("إجراءات أخرى");
  });

  it("offers Add in the shelves slot for a novel not in the library", () => {
    render();
    expect(order()).toEqual(["read", "range", "add"]);
    expect(button("add")?.getAttribute("aria-label")).toBe("Add to library");
  });

  // Browsing a novel in the Store, neither Remove nor Save-offline applies,
  // so the ⋮ would open onto nothing.
  it("hides the ⋮ when it would have no rows", () => {
    render();
    expect(button("more")).toBeNull();
  });

  it("gives every icon-only button a 44px touch target", () => {
    render(IN_LIBRARY);
    for (const key of ["range", "shelves", "more"]) {
      expect(button(key)?.style.minWidth).toBe("44px");
      expect(button(key)?.style.minHeight).toBe("44px");
    }
  });

  it("keeps the same one row on desktop", () => {
    render({ ...IN_LIBRARY, layout: "desktop" });
    expect(order()).toEqual(["read", "range", "shelves", "more"]);
    expect(button("read")?.textContent?.trim()).toBe("Read");
  });

  // Read takes the leftover width on a phone so the cluster fills the row;
  // on desktop it stays its own width, with the icons beside it.
  it("stretches Read to fill the phone's row, but not the desktop's", () => {
    render(IN_LIBRARY);
    expect(slots()[0]?.style.flexGrow).toBe("1");
    render({ ...IN_LIBRARY, layout: "desktop" });
    expect(slots()[0]?.style.flexGrow).toBe("");
  });

  // Sized by its four-letter word, "Read" came out barely wider than the
  // 44px circles beside it, which is not what the one primary action in
  // the cluster should look like.
  it("gives Read a floor wide enough to dominate the icons", () => {
    render({ ...IN_LIBRARY, layout: "desktop" });
    expect(button("read")?.style.minWidth).toBe("210px");
  });
});

describe("the ⋮ menu", () => {
  it("holds what the row could not: save offline, then remove", () => {
    render(IN_LIBRARY);
    openMenu();
    expect(rows().map((r) => r.dataset.menuAction)).toEqual([
      "offline",
      "remove",
    ]);
    expect(row("offline")?.textContent?.trim()).toBe("Save as offline book");
    expect(row("remove")?.textContent?.trim()).toBe("Remove from library");
  });

  // On desktop, where the popover unmounts the moment it closes. The phone's
  // sheet keeps its rows mounted for the length of its exit animation, so
  // "has it closed" is not a question its DOM can answer synchronously.
  it("runs the picked action and closes", () => {
    let removed = 0;
    render({
      ...IN_LIBRARY,
      layout: "desktop",
      onRemoveFromLibrary: () => removed++,
    });
    openMenu();
    expect(rows()).toHaveLength(2);
    act(() => {
      row("remove")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(removed).toBe(1);
    expect(rows()).toHaveLength(0);
  });

  // The Hero is `overflow: hidden` with `isolation: isolate`, so a menu
  // rendered inside it is both clipped at the hero's rounded edge and
  // trapped under everything that follows the hero in the document — seen
  // on desktop, where the popover came out as a sliver below the ⋮. It has
  // to leave the hero's subtree entirely.
  it("escapes the hero, which would otherwise clip and bury it", () => {
    render({ ...IN_LIBRARY, layout: "desktop" });
    openMenu();
    const menu = row("remove");
    expect(host.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it("marks Remove as destructive", () => {
    render(IN_LIBRARY);
    openMenu();
    expect(row("remove")?.style.color).toBe(THEMES.dark.danger);
    expect(row("offline")?.style.color).toBe(THEMES.dark.ink);
  });

  // The extension behind a saved novel can be uninstalled: everything that
  // would have to reach the site goes off, in the row and in the menu alike.
  it("switches off what needs the source when the extension is gone", () => {
    render({ ...IN_LIBRARY, downloadDisabledReason: "Needs the extension" });
    expect(button("range")?.disabled).toBe(true);
    openMenu();
    expect(row("offline")?.disabled).toBe(true);
    // Removing a saved entry is local — it still works.
    expect(row("remove")?.disabled).toBe(false);
  });

  it("goes busy while a library action runs", () => {
    render({ ...IN_LIBRARY, working: true });
    expect(button("more")?.getAttribute("aria-busy")).toBe("true");
    expect(button("more")?.disabled).toBe(true);
    render({ working: true });
    expect(button("add")?.getAttribute("aria-busy")).toBe("true");
    expect(button("add")?.disabled).toBe(true);
  });
});
