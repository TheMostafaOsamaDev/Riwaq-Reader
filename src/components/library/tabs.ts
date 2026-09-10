
import {
  type BookIndexEntry,
  type BookStatus,
} from "../../store/library";
import type { MsgKey, Tr } from "../../i18n";

/** "store" is a top-level destination, not a book filter — when the tab
 *  is set to "store" the body swaps out the shelf for the source browser. */
export type LibraryTab = "all" | BookStatus | "store";

export const TABS: { key: LibraryTab; msgKey: MsgKey }[] = [
  { key: "all", msgKey: "sidebar.library" },
  { key: "reading", msgKey: "sidebar.reading" },
  { key: "finished", msgKey: "sidebar.finished" },
  { key: "wishlist", msgKey: "sidebar.wishlist" },
  { key: "store", msgKey: "sidebar.store" },
];

// "Reading" is partly derived: a book the user has actually started but not
// finished counts as in-progress even if they never explicitly tagged it.
// Explicit finished/wishlist still wins — those are user intent and override
// whatever the progress number says.
export function isReading(b: BookIndexEntry): boolean {
  if (b.status === "reading") return true;
  if (b.status === "finished" || b.status === "wishlist") return false;
  return b.progress > 0 && b.progress < 1;
}

export function matchesTab(b: BookIndexEntry, tab: LibraryTab): boolean {
  if (tab === "all") return true;
  // "store" is a destination tab, not a filter — when active, the shelf
  // is replaced wholesale, so the predicate never actually runs against
  // a visible list. Returning false keeps the filtered view empty in
  // case something does call this.
  if (tab === "store") return false;
  if (tab === "reading") return isReading(b);
  return b.status === tab;
}

export function shelfHeadingFor(tab: LibraryTab, tr: Tr): string {
  // "all" and "store" are handled by the caller before they get here —
  // we keep them in the union so the call site doesn't need a separate
  // narrowing helper.
  if (tab === "reading") return tr("library.currentlyReading");
  if (tab === "finished") return tr("sidebar.finished");
  if (tab === "wishlist") return tr("sidebar.wishlist");
  return tr("library.shelf");
}
