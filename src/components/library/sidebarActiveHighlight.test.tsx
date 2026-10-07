// @vitest-environment happy-dom
//
// Exactly one sidebar destination is highlighted at a time.
//
// Opening a single shelf left the Library status filter you came from lit as
// well: click Wishlist, then Favorites, and both rows wore the active fill.
// `tab` keeps its last value while a shelf is open (it is the Library's own
// filter, not the current destination), and the "is the Library the
// destination?" gate didn't count a single shelf as somewhere else.
//
// And one solid pill, on the section: a parent whose tree holds the current
// page used to be solid for Shelves but plain for Library, with the child
// solid too. Now both parents stay solid while you're anywhere in their
// section, the child is marked by its text alone, and the rail from the
// parent down to the child is lit (`data-path` on the rows in between).
//
// Read through the sidebar's `data-active` / `data-path` marks and the parent
// rows' inline style, so this checks what the user sees, not the gate's
// internals.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { Shelf } from "../../store/shelves";
import { THEMES } from "../../styles/tokens";
import { DesktopLibrary } from "./DesktopLibrary";
import type { LayoutProps } from "./types";

const noop = () => {};
const noopAsync = async () => {};

const SHELVES: Shelf[] = [
  { id: "fav", name: "Favorites", createdAt: 0, order: 0 },
  { id: "later", name: "To read", createdAt: 0, order: 1 },
];

function props(over: Partial<LayoutProps>): LayoutProps {
  return {
    theme: THEMES.dark,
    themeKey: "dark",
    heroStyle: "ambient",
    homeBar: "classic",
    searchOpen: false,
    onOpenSearch: () => {},
    onCloseSearch: () => {},
    downloadsTab: false,
    settingsTab: null,
    onGoLibrary: () => {},
    books: [],
    covers: {},
    loading: false,
    error: null,
    importing: false,
    tab: "wishlist",
    setTab: noop,
    onOpen: noop,
    onImport: noop,
    onImportFolder: noop,
    onStreamRead: noop,
    onSourceImportComplete: noop,
    sourceDetailView: null,
    onCloseSourceDetailView: noop,
    onOpenSourceDetailRangeDialog: noop,
    onOpenQueue: noop,
    onOpenSettings: noop,
    shelvesActive: false,
    onOpenShelves: noop,
    shelves: SHELVES,
    onNewShelf: noop,
    onCreateShelf: noopAsync,
    onRenameShelf: noopAsync,
    onRequestRenameShelf: noop,
    onDeleteShelf: noopAsync,
    onRequestDeleteShelf: noop,
    onAddBooksToShelf: noopAsync,
    onToggleBookShelf: noopAsync,
    onRemoveBookFromShelf: noop,
    onAddToShelf: noop,
    onOpenShelf: noop,
    activeShelfId: undefined,
    onDelete: noop,
    onEdit: noop,
    onCardContextMenu: noop,
    ...over,
  };
}

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

function render(over: Partial<LayoutProps>) {
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <DesktopLibrary {...props(over)} />
      </I18nProvider>,
    );
  });
}

function treeRows(mark: "active" | "path"): string[] {
  return [...host.querySelectorAll(`aside .riwaq-tree-item[data-${mark}]`)].map(
    (el) => el.textContent?.trim() ?? "",
  );
}

/** Labels of the highlighted rows in the sidebar's two trees. */
function activeTreeRows(over: Partial<LayoutProps>): string[] {
  render(over);
  return treeRows("active");
}

/** A collapsible parent row's main button, found by its label. */
function parentRow(label: string): HTMLElement {
  const el = [...host.querySelectorAll<HTMLElement>("aside button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!el) throw new Error(`no parent row "${label}"`);
  return el;
}

const INK = THEMES.dark.ink;

describe("sidebar active highlight", () => {
  it("lights the Library filter while the Library is the destination", () => {
    expect(activeTreeRows({})).toEqual(["Wishlist"]);
  });

  it("lights only the open shelf, not the filter it was opened from", () => {
    expect(activeTreeRows({ activeShelfId: "fav" })).toEqual(["Favorites"]);
  });

  it("falls back to the filter when the open shelf no longer exists", () => {
    // The detail view renders the library grid for a deleted shelf, so the
    // Library is the destination again.
    expect(activeTreeRows({ activeShelfId: "gone" })).toEqual(["Wishlist"]);
  });
});

describe("parent row of the current page", () => {
  it("is solid when it is the destination itself", () => {
    render({ shelvesActive: true });
    expect(parentRow("Shelves").style.background).toBe(INK);
    expect(treeRows("active")).toEqual([]);
  });

  it("stays solid while a child is the destination, for both groups", () => {
    render({ activeShelfId: "fav" });
    expect(parentRow("Shelves").style.background).toBe(INK);
    expect(parentRow("Library").style.background).toBe("transparent");
    render({});
    expect(parentRow("Library").style.background).toBe(INK);
    expect(parentRow("Shelves").style.background).toBe("transparent");
  });

  it("marks the child by its text alone, not a second pill", () => {
    render({ activeShelfId: "fav" });
    const rows = [
      ...host.querySelectorAll<HTMLElement>("aside .riwaq-tree-item"),
    ];
    const fav = rows.find((r) => r.textContent === "Favorites")!;
    const toRead = rows.find((r) => r.textContent === "To read")!;
    // No fill of its own: a row's only fill is the CSS hover tint.
    expect(fav.style.background).toBe("");
    expect(fav.style.color).toBe(INK);
    expect(fav.style.fontWeight).toBe("600");
    // ...which only reads as selected against rows that don't share it.
    expect(toRead.style.color).not.toBe(INK);
    expect(toRead.style.fontWeight).toBe("500");
  });

  it("lights the rail through every row between parent and destination", () => {
    render({ activeShelfId: "later" });
    expect(treeRows("path")).toEqual(["Favorites"]);
    render({ tab: "wishlist" });
    expect(treeRows("path")).toEqual(["Reading", "Finished"]);
  });
});
