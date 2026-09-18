import type { BookIndexEntry } from "../../store/library";
import type { Shelf } from "../../store/shelves";
import type { Theme, ThemeKey } from "../../styles/tokens";
import type { LibraryTab } from "./tabs";

export interface LayoutProps {
  theme: Theme;
  themeKey: ThemeKey;
  books: BookIndexEntry[];
  covers: Record<string, string>;
  loading: boolean;
  error: string | null;
  importing: boolean;
  /** Active library tab, owned by the parent Library component so both
   *  layouts (and the Store) share it. */
  tab: LibraryTab;
  setTab: (t: LibraryTab) => void;
  onOpen: (id: string) => void;
  onImport: () => void;
  onImportFolder: () => void;
  /** Open a novel from a source in the streaming reader. */
  onStreamRead: (
    sourceId: string,
    novelUrl: string,
    chapterId?: number,
  ) => void;
  /** Imported via a source — refresh shelf after the new entry lands. */
  onSourceImportComplete: () => void;
  /** When non-null, the body shows NovelDetailView for a library-backed
   *  source entry instead of the shelf. Set by `handleOpen` in the parent
   *  when the user clicks a `kind: "source"` card. */
  sourceDetailView: {
    sourceId: string;
    novelUrl: string;
    libraryEntryId?: string;
  } | null;
  /** Close the source detail view (returns the body to its normal shelf
   *  / Store rendering). */
  onCloseSourceDetailView: () => void;
  /** Open the range download dialog for the currently-shown source detail. */
  onOpenSourceDetailRangeDialog: () => void;
  /** Open the download-queue sheet. */
  onOpenQueue: () => void;
  /** Open the settings sheet (mobile theme picker for now). */
  onOpenSettings: () => void;
  /** True when the Shelves (collections) destination is active. */
  shelvesActive: boolean;
  /** Navigate to the Shelves destination. */
  onOpenShelves: () => void;
  /** Custom shelves, owned by the parent so both layouts agree. Store-backed
   *  (riwaq/shelves.json) via listShelves/createShelf/renameShelf/deleteShelf. */
  shelves: Shelf[];
  /** Open the "new shelf" dialog (rendered by the parent). */
  onNewShelf: () => void;
  onCreateShelf: (name: string) => Promise<void>;
  onRenameShelf: (id: string, name: string) => Promise<void>;
  /** Open the rename dialog (rendered by the parent) for a given shelf.
   *  Consumed by the overview/single-shelf headers (later tasks). */
  onRequestRenameShelf: (shelf: Shelf) => void;
  onDeleteShelf: (id: string) => Promise<void>;
  /** Open the delete-shelf confirm dialog (rendered by the parent) for a
   *  given shelf. Consumed by the overview/single-shelf headers (later
   *  tasks). */
  onRequestDeleteShelf: (shelf: Shelf) => void;
  onAddBooksToShelf: (shelfId: string, bookIds: string[]) => Promise<void>;
  /** Flip one book's membership on one shelf — wired into the book detail
   *  page's "Shelves" checklist (Task 13). Pure membership editing; never
   *  deletes the book. */
  onToggleBookShelf: (bookId: string, shelfId: string) => Promise<void>;
  /** Smart remove-from-shelf (Task 14): silent + undoable when the book
   *  stays on another shelf, otherwise opens the parent's orphan confirm
   *  dialog. Consumed by the overview's hover "×" (optional parity). */
  onRemoveBookFromShelf: (bookId: string, shelfId: string) => void;
  /** Open the from-library/from-device add-book menu (rendered by the
   *  parent) for a given shelf. Consumed by the overview/single-shelf
   *  headers (later tasks) — threaded here so this task's plumbing is in
   *  place before those call sites land. */
  onAddToShelf: (shelfId: string) => void;
  /** Navigate to a specific shelf's detail view (wired in Task 9). */
  onOpenShelf: (id: string) => void;
  /** The shelf whose detail view is open, if any — drives the sidebar's
   *  per-shelf active highlight (Task 9). */
  activeShelfId?: string;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  /** Optional 4th arg: the shelf id, when the card lives in a shelf-scoped
   *  grid (the single-shelf detail page) — threaded through to `<ContextMenu
   *  shelfContextId>` so it can show the "Remove from shelf" row. Omitted
   *  from the main library grid's call sites. */
  onCardContextMenu: (
    id: string,
    x: number,
    y: number,
    shelfId?: string,
  ) => void;
}
