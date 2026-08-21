import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLongPress } from "../hooks/useLongPress";
import { Icon } from "./Icon";
import { BookCover, BOOK_COVER_DIMS } from "./BookCover";
import { Toast, type ToastMessage } from "./Toast";
import { EditBookModal } from "./EditBookModal";
import { ContextMenu } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "./Button";
import { DownloadRangeDialog } from "./DownloadRangeDialog";
import { NovelDetailView } from "./NovelDetailView";
import { DownloadQueueView } from "./DownloadQueueView";
import { LibrarySidebar } from "./LibrarySidebar";
import { SearchOverlay } from "./SearchOverlay";
import { ShelvesPage, AddTile } from "./ShelvesPage";
import { NewShelfDialog } from "./NewShelfDialog";
import { AddToShelfMenu } from "./AddToShelfMenu";
import { AddToShelfDialog } from "./AddToShelfDialog";
import { AnimatedDialog } from "./AnimatedDialog";
import { AnimatedFullScreen } from "./AnimatedFullScreen";
import { AnimatedSwap } from "./AnimatedSwap";
import { onOpenDownloadQueue } from "../store/uiIntents";
import {
  useNav,
  goLibrary,
  goShelf,
  openOverlay,
  back,
  type LibraryView,
} from "../store/navigation";
import {
  getState as getQueueState,
  subscribe as subscribeToQueue,
} from "../store/downloadQueue";
import { Store } from "./Store";
import {
  coverSrcFor,
  listBooks,
  pickBooksForImport,
  pickFolderForImport,
  readImageFile,
  deleteBook,
  rescanCover,
  setCoverFromFile,
  updateBookMeta,
  updateBookStatus,
  updateBookShelfIds,
  type BookIndexEntry,
  type BookStatus,
  type StagedPick,
} from "../store/library";
import {
  listShelves,
  createShelf as createShelfStore,
  renameShelf as renameShelfStore,
  deleteShelf as deleteShelfStore,
  type Shelf,
} from "../store/shelves";
import {
  booksOnShelf,
  toggleMembership,
  removeMembership,
  wouldOrphan,
} from "../store/shelfLogic";
import { ImportDetailsDialog } from "./ImportDetailsDialog";
import { SourceBadge } from "./SourceBadge";
import { getSourceMeta } from "../sources/registry";
import type { CoverChoice, FixedImportDraft } from "../store/fixedImportStage";
import { paletteForId } from "../store/palette";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  isArabicTitle,
  titleFontFor,
  type Theme,
  type ThemeKey,
} from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";
import { errorLabel } from "../i18n/statusLabels";
import type { MsgKey, Tr } from "../i18n";

function draftDefaultCover(d: FixedImportDraft): CoverChoice {
  return d.defaultCoverId
    ? { kind: "candidate", id: d.defaultCoverId }
    : { kind: "none" };
}

interface Props {
  theme: Theme;
  /** Selected theme id — threaded so cards / sidebar can reflect the active
   *  theme. */
  themeKey: ThemeKey;
  layout: "desktop" | "mobile";
  /** Current library destination, from the nav store (App passes base.view).
   *  Drives which body shows — shelf / store / shelves / novel detail. */
  view: LibraryView;
  onOpen: (bookId: string) => void;
  /** Open the Source streaming reader at a specific novel + chapter. The
   *  Library hands this off to App.tsx, which renders the reader at top
   *  level (covering Library + Store). */
  onStreamRead: (sourceId: string, novelUrl: string, chapterId?: number) => void;
  /** True while the streaming reader overlay is open above us. The Library
   *  stays mounted underneath, so we watch this to re-read the shelf when a
   *  reading session ends (a source novel's lastReadAt/progress changed). */
  streamActive: boolean;
  /** Navigate to the top-level Settings page (owned by App). */
  onOpenSettings: () => void;
  /** When off, deleting a book skips the confirm dialog and deletes at once. */
  confirmDelete: boolean;
}

function useBooks() {
  const { tr } = useI18n();
  const [books, setBooks] = useState<BookIndexEntry[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listBooks();
      setBooks(list);
      // Resolve cover URLs in parallel — these are cheap (convertFileSrc is
      // synchronous after the one-time appDataDir lookup) but awaiting them
      // up front means no per-card flicker.
      const entries = await Promise.all(
        list
          .filter((b) => b.coverFile)
          .map(async (b) => [b.id, await coverSrcFor(b)] as const),
      );
      const next: Record<string, string> = {};
      for (const [id, url] of entries) if (url) next[id] = url;
      setCovers(next);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(errorLabel(message, tr));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { books, covers, loading, error, refresh, setError };
}

export function Library({
  theme,
  themeKey,
  layout,
  view,
  onOpen,
  onStreamRead,
  streamActive,
  onOpenSettings,
  confirmDelete,
}: Props) {
  const { tr, locale } = useI18n();
  const { books, covers, loading, error, refresh, setError } = useBooks();
  const navState = useNav();
  const [importing, setImporting] = useState(false);
  const [importQueue, setImportQueue] = useState<FixedImportDraft[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [qBusy, setQBusy] = useState(false);
  const importStats = useRef<{ imported: number; errors: string[] }>({
    imported: 0,
    errors: [],
  });
  // Set by startImportToShelf when the device-import flow (AddToShelfMenu's
  // "From device") kicks off — carries the target shelf + a pre-import
  // snapshot of book ids so the *actual* completion point (summarizeImport,
  // the one choke point every import path funnels through: immediate
  // EPUB-only imports, a fully-drained draft queue, and skip-rest) can diff
  // the fresh index and assign whatever landed to that shelf. A ref (not
  // state) so a stale render's closure — resumed after the file-picker's
  // await — still reads the value written just before onImport() was
  // called, and so it survives across every re-render the multi-step draft
  // queue produces before that point is reached.
  const pendingShelfImportRef = useRef<{
    shelfId: string;
    before: Set<string>;
  } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastIdRef = useRef(0);
  // Declared this early (rather than alongside the other toast-firing
  // handlers further down) so shelf-membership handlers defined below —
  // onRemoveBookFromShelf in particular — can call it without a
  // used-before-declaration error.
  const showToast = useCallback(
    (
      kind: ToastMessage["kind"],
      text: string,
      action?: ToastMessage["action"],
    ) => {
      toastIdRef.current += 1;
      setToast({ id: toastIdRef.current, kind, text, action });
    },
    [],
  );

  // The book-status FILTER (all/reading/finished/wishlist) is ephemeral UI
  // state — flipping a filter pill is not a navigation step, so it lives here
  // and is deliberately NOT recorded in history. Which *destination* shows
  // (shelf vs store vs shelves vs a novel detail) comes from the nav `view`.
  const [filter, setFilter] = useState<"all" | BookStatus>("all");
  // Recombine the two for the existing readers (matchesTab, the pill row,
  // headings, active-state): "store" when that destination is active,
  // otherwise the current status filter.
  const tab: LibraryTab = view.kind === "store" ? "store" : filter;

  // Source-backed library entries open their NovelDetailView instead of the
  // reader. This destination lives in nav history now (so Back closes it) —
  // derive it from the view rather than local state.
  const sourceDetailView =
    view.kind === "novel"
      ? {
          sourceId: view.sourceId,
          novelUrl: view.novelUrl,
          libraryEntryId: view.libraryEntryId,
        }
      : null;
  const shelvesActive = view.kind === "shelves";
  // The shelf whose detail view is open, if any — drives the sidebar's
  // per-shelf active highlight (Task 9).
  const activeShelfId =
    view.kind === "shelfDetail" ? view.shelfId : undefined;
  // Download queue is an overlay layer in nav history (Back closes it).
  const queueOpen = navState.snapshot.overlay?.kind === "downloads";

  const [sourceDetailRangeDialog, setSourceDetailRangeDialog] = useState<{
    sourceId: string;
    novelUrl: string;
    libraryEntryId?: string;
  } | null>(null);

  // Shelves (custom collections) — store-backed (leaflet/shelves.json),
  // shared by both layouts so the mobile Shelves page and the desktop
  // sidebar agree. listShelves() seeds the two defaults on first run and is
  // the source of truth thereafter.
  const [shelves, setShelves] = useState<Shelf[]>([]);
  useEffect(() => {
    listShelves().then(setShelves);
  }, []);
  const reloadShelves = useCallback(() => listShelves().then(setShelves), []);
  const [newShelfOpen, setNewShelfOpen] = useState(false);
  // Rename dialog is the same NewShelfDialog, prefilled + relabeled — see
  // Task 7. Holds the shelf being renamed (null when closed).
  const [renaming, setRenaming] = useState<Shelf | null>(null);

  const onCreateShelf = useCallback(
    async (name: string) => {
      await createShelfStore(name);
      await reloadShelves();
    },
    [reloadShelves],
  );
  const onRenameShelf = useCallback(
    async (id: string, name: string) => {
      await renameShelfStore(id, name);
      await reloadShelves();
    },
    [reloadShelves],
  );
  const onDeleteShelf = useCallback(
    async (id: string) => {
      await deleteShelfStore(id);
      await reloadShelves();
      await refresh(); // books' shelfIds changed
    },
    [reloadShelves, refresh],
  );
  // Delete-shelf confirmation, mirroring pendingDelete below: holds the
  // shelf awaiting confirmation (null when the dialog is closed).
  const [deletingShelf, setDeletingShelf] = useState<Shelf | null>(null);
  const onRequestDeleteShelf = useCallback(
    (shelf: Shelf) => setDeletingShelf(shelf),
    [],
  );
  const confirmDeleteShelf = useCallback(async () => {
    if (!deletingShelf) return;
    const id = deletingShelf.id;
    setDeletingShelf(null);
    // If we're viewing that shelf's page, leave it before it vanishes.
    if (view.kind === "shelfDetail" && view.shelfId === id) {
      goLibrary({ kind: "shelves" });
    }
    await onDeleteShelf(id);
  }, [deletingShelf, view, onDeleteShelf]);
  const onAddBooksToShelf = useCallback(
    async (shelfId: string, bookIds: string[]) => {
      for (const bookId of bookIds) {
        const book = books.find((b) => b.id === bookId);
        const next = [...new Set([...(book?.shelfIds ?? []), shelfId])];
        await updateBookShelfIds(bookId, next);
      }
      await refresh();
    },
    [books, refresh],
  );
  // Single-book shelf membership toggle for the detail page's "Shelves"
  // checklist (Task 13). Pure membership editing — flips one shelf's
  // membership for one book and nothing else; it never deletes the book,
  // even when this empties its shelf list (unlike the shelf-page "remove"
  // flow, which prompts to keep an orphaned book in the library).
  const onToggleBookShelf = useCallback(
    async (bookId: string, shelfId: string) => {
      const book = books.find((b) => b.id === bookId);
      await updateBookShelfIds(bookId, toggleMembership(book?.shelfIds, shelfId));
      await refresh();
    },
    [books, refresh],
  );
  // Smart remove-from-shelf (Task 14): unconditionally writes the
  // membership change. Shared by the non-orphan (silent + undo) path and
  // the orphan dialog's "Keep in library" cancel action.
  const doUnshelve = useCallback(
    async (bookId: string, shelfId: string) => {
      const book = books.find((b) => b.id === bookId);
      await updateBookShelfIds(bookId, removeMembership(book?.shelfIds, shelfId));
      await refresh();
    },
    [books, refresh],
  );
  // Holds the pending orphan confirmation (null when no dialog is open) —
  // only populated when removing from `shelfId` would leave the book on no
  // shelf at all.
  const [orphanRemoval, setOrphanRemoval] = useState<{
    bookId: string;
    shelfId: string;
    title: string;
  } | null>(null);
  const onRemoveBookFromShelf = useCallback(
    (bookId: string, shelfId: string) => {
      const book = books.find((b) => b.id === bookId);
      if (wouldOrphan(book?.shelfIds, shelfId)) {
        setOrphanRemoval({ bookId, shelfId, title: book?.title ?? "" });
        return;
      }
      // Non-orphan case: silent + undoable — no confirmation needed since
      // the book stays in the library either way.
      const shelfName = shelves.find((s) => s.id === shelfId)?.name ?? "";
      void doUnshelve(bookId, shelfId);
      showToast("info", tr("shelves.removedToast", { shelf: shelfName }), {
        label: tr("common.undo"),
        onClick: () => void onAddBooksToShelf(shelfId, [bookId]),
      });
    },
    [books, shelves, doUnshelve, onAddBooksToShelf, showToast, tr],
  );
  // "Add to shelf" entry point (Task 12): opens the from-library/from-device
  // choice menu for a given shelf. addMenuShelf drives AddToShelfMenu;
  // choosing "From library" swaps it for pickerShelf (AddToShelfDialog),
  // "From device" clears the menu and kicks off startImportToShelf below.
  const [addMenuShelf, setAddMenuShelf] = useState<string | null>(null);
  const [pickerShelf, setPickerShelf] = useState<string | null>(null);
  const onAddToShelf = useCallback(
    (shelfId: string) => setAddMenuShelf(shelfId),
    [],
  );

  // A "tab" selection is either the Store destination (a history push) or a
  // status filter. A filter change never leaves the shelf, but if the user is
  // currently on the Store / Shelves / a novel detail, picking a filter takes
  // them to the (filtered) shelf.
  const onSelectTab = useCallback(
    (next: LibraryTab) => {
      if (next === "store") {
        goLibrary({ kind: "store" });
        return;
      }
      setFilter(next);
      if (view.kind !== "shelf") goLibrary({ kind: "shelf" });
    },
    [view.kind],
  );
  const onOpenShelves = useCallback(() => goLibrary({ kind: "shelves" }), []);

  const fmtNum = useCallback(
    (n: number) =>
      locale === "ar"
        ? String(n).replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d])
        : String(n),
    [locale],
  );

  // Card click dispatch. Source-backed entries open their detail page
  // inside this Library; everything else flows through the parent's
  // onOpen and lands in the regular reader. Doing the routing here
  // means callers don't have to know about entry kinds.
  const handleOpen = useCallback(
    (id: string) => {
      const book = books.find((b) => b.id === id);
      if (book?.kind === "source" && book.sourceId && book.novelUrl) {
        goLibrary({
          kind: "novel",
          sourceId: book.sourceId,
          novelUrl: book.novelUrl,
          libraryEntryId: book.id,
        });
        return;
      }
      onOpen(id);
    },
    [books, onOpen],
  );

  // EPUBs import immediately (they ship a cover); PDF/DOCX return as drafts we
  // queue into the title/cover dialog. A folder or multi-select is a queue the
  // user steps through — Skip imports a book with defaults, Skip-the-rest
  // defaults the remainder.
  const currentDraft = importQueue[qIndex] ?? null;

  // If startImportToShelf kicked off this import, diff the fresh index
  // against its pre-import snapshot and assign whatever landed to that
  // shelf. Called from summarizeImport — the single point every import
  // path (immediate EPUB-only import, a fully-drained draft queue, and
  // skip-rest) funnels through — so this fires exactly once per completed
  // import, regardless of which path got there. listBooks() reads the
  // fresh index directly rather than the `books` state closure, which may
  // still be stale at this point in the call chain.
  const finishPendingShelfImport = async () => {
    const pending = pendingShelfImportRef.current;
    if (!pending) return;
    pendingShelfImportRef.current = null;
    const after = await listBooks();
    const newIds = after
      .filter((b) => !pending.before.has(b.id))
      .map((b) => b.id);
    if (newIds.length === 0) return;
    await onAddBooksToShelf(pending.shelfId, newIds);
    const name = shelves.find((s) => s.id === pending.shelfId)?.name ?? "";
    showToast(
      "info",
      tr("shelves.addedToast", { n: newIds.length, shelf: name }),
    );
  };

  const summarizeImport = () => {
    setImportQueue([]);
    setQIndex(0);
    const { imported, errors } = importStats.current;
    if (imported > 0 && errors.length > 0) {
      showToast(
        "warn",
        tr(
          imported === 1
            ? "status.importedFolderSkippedOne"
            : "status.importedFolderSkippedOther",
          { n: imported, skipped: errors.length },
        ),
      );
    } else if (imported > 1) {
      showToast("info", tr("status.importedFolderOther", { n: imported }));
    } else if (imported === 0 && errors.length > 0) {
      setError(errorLabel(errors[0], tr));
    }
    // Fire-and-forget: a pending shelf assignment (device import started via
    // AddToShelfMenu) resolves after its own listBooks() round-trip, whose
    // toast then supersedes whichever message was just shown above.
    void finishPendingShelfImport();
  };

  const advanceQueue = async (draft: FixedImportDraft, didImport: boolean) => {
    if (didImport) importStats.current.imported += 1;
    draft.dispose();
    const next = qIndex + 1;
    if (next >= importQueue.length) {
      await refresh();
      summarizeImport();
    } else {
      setQIndex(next);
    }
  };

  const beginImport = async (res: StagedPick | null) => {
    if (!res) {
      // Nothing was picked (dialog cancelled) — nothing will ever call
      // summarizeImport for this attempt, so drop any pending shelf
      // assignment now instead of letting it leak onto a later, unrelated
      // import.
      pendingShelfImportRef.current = null;
      return;
    }
    if (res.empty) {
      showToast("warn", tr("status.emptyFolderImport"));
      pendingShelfImportRef.current = null;
      return;
    }
    importStats.current = {
      imported: res.autoImported.length,
      errors: res.errors.map((e) => e.message),
    };
    if (res.autoImported.length > 0) await refresh();
    if (res.drafts.length > 0) {
      setQIndex(0);
      setImportQueue(res.drafts);
    } else {
      summarizeImport();
    }
  };

  const onImport = async () => {
    if (importing || importQueue.length > 0) return;
    setImporting(true);
    setError(null);
    try {
      await beginImport(await pickBooksForImport());
    } catch (e) {
      setError(errorLabel(e instanceof Error ? e.message : String(e), tr));
      // The pick/import blew up before beginImport could run its own
      // cleanup — same reasoning as beginImport's `!res` branch above.
      pendingShelfImportRef.current = null;
    } finally {
      setImporting(false);
    }
  };

  // Device → shelf (AddToShelfMenu's "From device"): snapshot the current
  // book ids, then run the *existing* single-file import trigger unchanged.
  // Its own completion path (via summarizeImport, see
  // finishPendingShelfImport above) diffs the fresh index against this
  // snapshot and assigns whatever's new to `shelfId`. Guarded the same way
  // onImport guards itself, so a tap while an import is already underway
  // is a no-op rather than a second concurrent pick.
  const startImportToShelf = async (shelfId: string) => {
    if (importing || importQueue.length > 0) return;
    pendingShelfImportRef.current = {
      shelfId,
      before: new Set(books.map((b) => b.id)),
    };
    await onImport();
  };

  const onImportFolder = async () => {
    if (importing || importQueue.length > 0) return;
    setImporting(true);
    setError(null);
    try {
      await beginImport(await pickFolderForImport());
    } catch (e) {
      setError(errorLabel(e instanceof Error ? e.message : String(e), tr));
    } finally {
      setImporting(false);
    }
  };

  const onQConfirm = async (title: string, cover: CoverChoice) => {
    const d = importQueue[qIndex];
    if (!d || qBusy) return;
    setQBusy(true);
    try {
      await d.commit({ title, cover });
      await advanceQueue(d, true);
    } catch (e) {
      importStats.current.errors.push(e instanceof Error ? e.message : String(e));
      await advanceQueue(d, false);
    } finally {
      setQBusy(false);
    }
  };

  const onQSkip = async () => {
    const d = importQueue[qIndex];
    if (!d || qBusy) return;
    setQBusy(true);
    try {
      await d.commit({ title: d.title, cover: draftDefaultCover(d) });
      await advanceQueue(d, true);
    } catch (e) {
      importStats.current.errors.push(e instanceof Error ? e.message : String(e));
      await advanceQueue(d, false);
    } finally {
      setQBusy(false);
    }
  };

  const onQSkipRest = async () => {
    if (qBusy) return;
    setQBusy(true);
    try {
      for (let i = qIndex; i < importQueue.length; i++) {
        const d = importQueue[i];
        try {
          await d.commit({ title: d.title, cover: draftDefaultCover(d) });
          importStats.current.imported += 1;
        } catch (e) {
          importStats.current.errors.push(
            e instanceof Error ? e.message : String(e),
          );
        }
        d.dispose();
      }
      await refresh();
      summarizeImport();
    } finally {
      setQBusy(false);
    }
  };

  const onQCancel = async () => {
    const d = importQueue[qIndex];
    if (!d || qBusy) return;
    await advanceQueue(d, false);
  };

  const onDelete = async (id: string) => {
    await deleteBook(id);
    await refresh();
  };

  const onRescanCover = async (id: string) => {
    try {
      const updated = await rescanCover(id);
      if (!updated) {
        setError(tr("status.coverNotFoundInEpub"));
      }
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(errorLabel(message, tr));
    }
  };

  const onSetCover = async (id: string) => {
    try {
      await setCoverFromFile(id);
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(errorLabel(message, tr));
    }
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const editingBook =
    editingId !== null ? books.find((b) => b.id === editingId) : undefined;
  const onEditSave = async (
    id: string,
    patch: { title: string; author: string; description: string },
  ) => {
    try {
      await updateBookMeta(id, patch);
      await refresh();
      setEditingId(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(errorLabel(message, tr));
    }
  };

  // Right-click menu on shelf cards. The menu lives at the Library top
  // level so its actions can reach the modal + delete handlers without
  // threading more props through the layout components. `shelfId` is only
  // set when the menu was opened from a shelf-scoped grid (the single-shelf
  // detail page) — it gates the extra "Remove from shelf" row (Task 14).
  const [menu, setMenu] = useState<{
    bookId: string;
    x: number;
    y: number;
    shelfId?: string;
  } | null>(null);
  const menuBook =
    menu !== null ? books.find((b) => b.id === menu.bookId) : undefined;
  // Hoisted out of the JSX below so the truthiness check narrows a local
  // `const` (stable across the closure) rather than a property access on
  // `menu`, which TS won't narrow inside a nested callback.
  const menuShelfId = menu?.shelfId;
  const openContextMenu = (
    bookId: string,
    x: number,
    y: number,
    shelfId?: string,
  ) => setMenu({ bookId, x, y, shelfId });
  const closeContextMenu = () => setMenu(null);
  const onPickStatus = async (bookId: string, s: BookStatus) => {
    try {
      // Re-clicking the currently-set status clears it — acts as a toggle so
      // the user doesn't have to reach for a separate "Clear status" item.
      const current = books.find((b) => b.id === bookId)?.status;
      await updateBookStatus(bookId, current === s ? undefined : s);
      await refresh();
      closeContextMenu();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(errorLabel(message, tr));
    }
  };
  // Single source of truth for the remove-confirmation popup. Every entry
  // point (hero card, context menu, edit modal) routes through here so we
  // don't end up with three inline confirms drifting apart.
  const [pendingDelete, setPendingDelete] = useState<{
    bookId: string;
    title: string;
    closeEditAfter?: boolean;
  } | null>(null);
  const requestDelete = (
    bookId: string,
    title: string,
    opts?: { closeEditAfter?: boolean },
  ) => {
    // When the confirm-before-delete setting is off, delete immediately
    // (still honoring closeEditAfter) instead of popping the dialog.
    if (!confirmDelete) {
      if (opts?.closeEditAfter) setEditingId(null);
      void onDelete(bookId);
      return;
    }
    setPendingDelete({ bookId, title, ...opts });
  };
  const cancelDelete = () => setPendingDelete(null);
  const performDelete = async () => {
    if (!pendingDelete) return;
    const { bookId, closeEditAfter } = pendingDelete;
    setPendingDelete(null);
    if (closeEditAfter) setEditingId(null);
    await onDelete(bookId);
  };
  const onMenuDelete = (bookId: string, title: string) => {
    closeContextMenu();
    requestDelete(bookId, title);
  };

  const onSourceImportComplete = useCallback(() => {
    void refresh();
  }, [refresh]);

  // The streaming reader mounts as an overlay above the (still-mounted)
  // Library, so closing it never remounts us — and useBooks() only reads the
  // index on mount. Re-read the shelf when a streaming session ends so a
  // source novel the user just read surfaces in "Continue reading": its
  // lastReadAt/progress were written to library.json during the session
  // (see updateSourceReadingPosition). The ref-guarded transition refreshes
  // only on close (true→false), not on open or initial mount.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !streamActive) void refresh();
    wasStreamingRef.current = streamActive;
  }, [streamActive, refresh]);

  // Wired by useLaunchIntent in App.tsx — when a notification tap arrives with
  // `leaflet.open=queue`, the pub/sub fires and we push the queue overlay onto
  // nav history (so the hardware/desktop Back closes it).
  useEffect(
    () => onOpenDownloadQueue(() => openOverlay({ kind: "downloads" })),
    [],
  );

  // When a "Save as offline book" conversion finishes, one or more
  // brand-new library entries have just landed via importEpubBytes —
  // without refreshing here the user has to leave the library and
  // come back to see them. Subscribing once at the parent + diffing
  // terminal-conversion timestamps keeps the side-effect surface
  // small.
  useEffect(() => {
    let lastConversionTerminalTs = 0;
    // Seed from current state so a conversion that finished BEFORE
    // mount doesn't trigger a spurious refresh.
    for (const j of getQueueState().jobs) {
      if (
        j.kind === "conversion" &&
        (j.status === "done" ||
          j.status === "error" ||
          j.status === "cancelled") &&
        j.updatedAt > lastConversionTerminalTs
      ) {
        lastConversionTerminalTs = j.updatedAt;
      }
    }
    const off = subscribeToQueue((s) => {
      let newestTerminal = lastConversionTerminalTs;
      let triggered = false;
      for (const j of s.jobs) {
        if (j.kind !== "conversion") continue;
        if (j.status !== "done") continue;
        if (j.updatedAt > lastConversionTerminalTs) {
          triggered = true;
          if (j.updatedAt > newestTerminal) newestTerminal = j.updatedAt;
        }
      }
      if (triggered) {
        lastConversionTerminalTs = newestTerminal;
        void refresh();
      }
    });
    return off;
  }, [refresh]);

  const layoutCommonProps = {
    theme,
    themeKey,
    books,
    covers,
    loading,
    error,
    importing,
    tab,
    setTab: onSelectTab,
    onOpen: handleOpen,
    onImport,
    onImportFolder,
    onStreamRead,
    onSourceImportComplete,
    sourceDetailView,
    onCloseSourceDetailView: () => back(),
    onOpenSourceDetailRangeDialog: () => {
      if (sourceDetailView) setSourceDetailRangeDialog(sourceDetailView);
    },
    onOpenQueue: () => openOverlay({ kind: "downloads" }),
    onOpenSettings,
    shelvesActive,
    onOpenShelves,
    shelves,
    onNewShelf: () => setNewShelfOpen(true),
    onCreateShelf,
    onRenameShelf,
    onRequestRenameShelf: (shelf: Shelf) => setRenaming(shelf),
    onDeleteShelf,
    onRequestDeleteShelf,
    onAddBooksToShelf,
    onToggleBookShelf,
    onRemoveBookFromShelf,
    onAddToShelf,
    onOpenShelf: (id: string) => goShelf(id),
    activeShelfId,
    onDelete: (id: string) => {
      const b = books.find((x) => x.id === id);
      if (b) requestDelete(b.id, b.title);
    },
    onEdit: (id: string) => setEditingId(id),
    onCardContextMenu: openContextMenu,
  };

  const layoutEl =
    layout === "mobile" ? (
      <MobileLibrary {...layoutCommonProps} />
    ) : (
      <DesktopLibrary {...layoutCommonProps} />
    );

  return (
    <>
      {layoutEl}
      <Toast theme={theme} toast={toast} onDismiss={() => setToast(null)} />
      {currentDraft && (
        <ImportDetailsDialog
          theme={theme}
          draft={currentDraft}
          index={qIndex}
          total={importQueue.length}
          busy={qBusy}
          onConfirm={onQConfirm}
          onSkip={onQSkip}
          onSkipRest={onQSkipRest}
          onCancel={onQCancel}
          pickCustomImage={readImageFile}
          fmt={fmtNum}
        />
      )}
      {editingBook && (
        <EditBookModal
          theme={theme}
          book={editingBook}
          coverSrc={covers[editingBook.id]}
          onClose={() => setEditingId(null)}
          onSave={(patch) => onEditSave(editingBook.id, patch)}
          onDelete={() =>
            requestDelete(editingBook.id, editingBook.title, {
              closeEditAfter: true,
            })
          }
          onSetCover={() => onSetCover(editingBook.id)}
          onRescanCover={() => onRescanCover(editingBook.id)}
        />
      )}
      {menu && menuBook && (
        <ContextMenu
          theme={theme}
          x={menu.x}
          y={menu.y}
          title={menuBook.title}
          author={menuBook.author}
          coverSrc={covers[menuBook.id]}
          status={menuBook.status}
          onPickStatus={(s) => onPickStatus(menuBook.id, s)}
          onEdit={() => {
            closeContextMenu();
            setEditingId(menuBook.id);
          }}
          onDelete={() => onMenuDelete(menuBook.id, menuBook.title)}
          onClose={closeContextMenu}
          shelfContextId={menuShelfId}
          onRemoveFromShelf={
            menuShelfId
              ? () => {
                  closeContextMenu();
                  onRemoveBookFromShelf(menuBook.id, menuShelfId);
                }
              : undefined
          }
        />
      )}
      {/* Dialog + full-screen wrappers manage their own enter/exit and stay
          mounted while the close animation plays. Keep the children
          conditional so the inner component only mounts when the data
          backing it (pendingDelete, sourceDetailRangeDialog) actually
          exists. zIndex stack roughly: dialog 9500-9700 (above
          EditBookModal at 9000), full-screen 200, on top of the shelf. */}
      <AnimatedDialog
        open={pendingDelete !== null}
        onScrimClick={cancelDelete}
        zIndex={9500}
      >
        {pendingDelete && (
          <ConfirmDialog
            theme={theme}
            title={tr("library.removeConfirmTitle")}
            message={
              <>
                <strong style={{ color: theme.ink }}>
                  “{pendingDelete.title || tr("common.untitled")}”
                </strong>{" "}
                {tr("library.removeConfirmSuffix")}
              </>
            }
            confirmLabel={tr("library.remove")}
            cancelLabel={tr("common.cancel")}
            confirmVariant="destructive"
            onConfirm={performDelete}
            onCancel={cancelDelete}
          />
        )}
      </AnimatedDialog>
      {/* Orphan-removal confirm (Task 14): only shown when removing the book
          from its last shelf. Mapping is deliberately inverted from the
          usual destructive-dialog shape — Cancel is the SAFE choice here
          ("Keep in library", just unshelves) and is what ConfirmDialog
          focuses by default; Confirm is the destructive one ("Remove from
          library", deletes the book outright). */}
      <AnimatedDialog
        open={orphanRemoval !== null}
        onScrimClick={() => setOrphanRemoval(null)}
        zIndex={9500}
      >
        {orphanRemoval && (
          <ConfirmDialog
            theme={theme}
            title={tr("shelves.keepTitle", {
              title: orphanRemoval.title || tr("common.untitled"),
            })}
            message={tr("shelves.keepBody")}
            cancelLabel={tr("shelves.keepInLibrary")}
            confirmLabel={tr("library.removeFromLibrary")}
            confirmVariant="destructive"
            onCancel={async () => {
              const o = orphanRemoval;
              setOrphanRemoval(null);
              await doUnshelve(o.bookId, o.shelfId);
            }}
            onConfirm={async () => {
              const o = orphanRemoval;
              setOrphanRemoval(null);
              await deleteBook(o.bookId);
              await refresh();
            }}
          />
        )}
      </AnimatedDialog>
      <AnimatedDialog
        open={deletingShelf !== null}
        onScrimClick={() => setDeletingShelf(null)}
        zIndex={9500}
      >
        {deletingShelf && (
          <ConfirmDialog
            theme={theme}
            title={tr("shelves.deleteTitle")}
            message={tr("shelves.deleteBody")}
            confirmLabel={tr("shelves.deleteConfirm")}
            cancelLabel={tr("common.cancel")}
            confirmVariant="destructive"
            onConfirm={confirmDeleteShelf}
            onCancel={() => setDeletingShelf(null)}
          />
        )}
      </AnimatedDialog>
      <AnimatedDialog
        open={sourceDetailRangeDialog !== null}
        onScrimClick={() => setSourceDetailRangeDialog(null)}
        zIndex={9700}
      >
        {sourceDetailRangeDialog && (
          <DownloadRangeDialog
            theme={theme}
            sourceId={sourceDetailRangeDialog.sourceId}
            novelUrl={sourceDetailRangeDialog.novelUrl}
            libraryEntryId={sourceDetailRangeDialog.libraryEntryId}
            onCancel={() => setSourceDetailRangeDialog(null)}
            onStarted={() => setSourceDetailRangeDialog(null)}
            onCompleted={() => void refresh()}
          />
        )}
      </AnimatedDialog>
      {/* Add-to-shelf picker (Task 12) — same tier as the confirm dialogs
          above; mutually exclusive with them (only opens once the
          from-library choice is made in AddToShelfMenu below). */}
      <AnimatedDialog
        open={pickerShelf !== null}
        onScrimClick={() => setPickerShelf(null)}
        zIndex={9500}
      >
        {pickerShelf && (
          <AddToShelfDialog
            theme={theme}
            shelfId={pickerShelf}
            shelfName={shelves.find((s) => s.id === pickerShelf)?.name ?? ""}
            books={books}
            covers={covers}
            onConfirm={async (ids) => {
              const shelfId = pickerShelf;
              setPickerShelf(null);
              await onAddBooksToShelf(shelfId, ids);
              const name = shelves.find((s) => s.id === shelfId)?.name ?? "";
              showToast(
                "info",
                tr("shelves.addedToast", { n: ids.length, shelf: name }),
              );
            }}
            onClose={() => setPickerShelf(null)}
          />
        )}
      </AnimatedDialog>
      <AnimatedFullScreen
        open={queueOpen}
        layout={layout}
        onScrimClick={() => back()}
        zIndex={200}
      >
        {queueOpen && (
          <DownloadQueueView
            theme={theme}
            layout={layout}
            onClose={() => back()}
          />
        )}
      </AnimatedFullScreen>
      {/* Shared across layouts: the "new shelf" dialog. Shelf list state lives
          in the parent so both the desktop sidebar and the mobile Shelves page
          add to the same list. */}
      {newShelfOpen && (
        <NewShelfDialog
          theme={theme}
          existing={shelves.map((s) => s.name)}
          onCreate={onCreateShelf}
          onClose={() => setNewShelfOpen(false)}
        />
      )}
      {/* Rename dialog — same NewShelfDialog, prefilled with the current
          name and relabeled. Rendered separately from the "new shelf"
          dialog above since the two are mutually exclusive but driven by
          different state (a shelf reference vs a boolean). */}
      {renaming && (
        <NewShelfDialog
          theme={theme}
          existing={shelves.map((s) => s.name)}
          initialName={renaming.name}
          title={tr("shelves.renameTitle")}
          confirmLabel={tr("shelves.renameConfirm")}
          onCreate={(name) => onRenameShelf(renaming.id, name)}
          onClose={() => setRenaming(null)}
        />
      )}
      {/* Add-to-shelf entry menu (Task 12) — self-contained overlay, same
          shape as NewShelfDialog above. "From library" swaps it for the
          AnimatedDialog-wrapped picker; "From device" hands off to the
          existing import flow via startImportToShelf. */}
      {addMenuShelf && (
        <AddToShelfMenu
          theme={theme}
          onFromLibrary={() => {
            setPickerShelf(addMenuShelf);
            setAddMenuShelf(null);
          }}
          onFromDevice={() => {
            const id = addMenuShelf;
            setAddMenuShelf(null);
            void startImportToShelf(id);
          }}
          onClose={() => setAddMenuShelf(null)}
        />
      )}
    </>
  );
}

interface LayoutProps {
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
  onStreamRead: (sourceId: string, novelUrl: string, chapterId?: number) => void;
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
   *  (leaflet/shelves.json) via listShelves/createShelf/renameShelf/deleteShelf. */
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

/** "store" is a top-level destination, not a book filter — when the tab
 *  is set to "store" the body swaps out the shelf for the source browser. */
export type LibraryTab = "all" | BookStatus | "store";

const TABS: { key: LibraryTab; msgKey: MsgKey }[] = [
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
function isReading(b: BookIndexEntry): boolean {
  if (b.status === "reading") return true;
  if (b.status === "finished" || b.status === "wishlist") return false;
  return b.progress > 0 && b.progress < 1;
}

function matchesTab(b: BookIndexEntry, tab: LibraryTab): boolean {
  if (tab === "all") return true;
  // "store" is a destination tab, not a filter — when active, the shelf
  // is replaced wholesale, so the predicate never actually runs against
  // a visible list. Returning false keeps the filtered view empty in
  // case something does call this.
  if (tab === "store") return false;
  if (tab === "reading") return isReading(b);
  return b.status === tab;
}

function DesktopLibrary({
  theme,
  themeKey,
  books,
  covers,
  loading,
  error,
  importing,
  tab,
  setTab,
  onOpen,
  onImport,
  onImportFolder,
  onStreamRead,
  onSourceImportComplete,
  sourceDetailView,
  onCloseSourceDetailView,
  onOpenSourceDetailRangeDialog,
  onOpenQueue,
  onOpenSettings,
  shelvesActive,
  onOpenShelves,
  shelves,
  onNewShelf,
  onCreateShelf: _onCreateShelf,
  onRenameShelf: _onRenameShelf,
  onRequestRenameShelf,
  onDeleteShelf: _onDeleteShelf,
  onRequestDeleteShelf,
  onAddBooksToShelf: _onAddBooksToShelf,
  onToggleBookShelf,
  onRemoveBookFromShelf,
  onAddToShelf,
  onOpenShelf,
  activeShelfId,
  onDelete,
  onEdit,
  onCardContextMenu,
}: LayoutProps) {
  const { tr } = useI18n();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const q = query.trim().toLowerCase();
  // The shelf is the active destination only when we're not on the Store,
  // the Shelves page, or an open novel detail. Gates the sidebar's Library
  // row + status-filter highlight so a lingering filter doesn't stay lit
  // after navigating to a sibling destination.
  const shelfActive = tab !== "store" && !shelvesActive && !sourceDetailView;
  // The single-shelf detail page (Task 10): resolves the nav view's shelfId
  // (already threaded down as `activeShelfId`) against the live shelf list,
  // so a shelf deleted out from under an open detail view quietly falls
  // back to null instead of crashing.
  const activeShelf = activeShelfId
    ? shelves.find((s) => s.id === activeShelfId) ?? null
    : null;
  const shelfBooks = activeShelf ? booksOnShelf(books, activeShelf.id) : [];
  const visible = books
    .filter((b) => matchesTab(b, tab))
    .filter(
      (b) =>
        !q ||
        b.title.toLowerCase().includes(q) ||
        (b.author ?? "").toLowerCase().includes(q),
    );
  // Hero is the "continue reading" affordance — only meaningful on the full
  // library view. On a filtered tab we render a flat shelf so every match is
  // equally weighted.
  const hero =
    tab === "all"
      ? visible.find((b) => b.lastReadAt !== undefined)
      : undefined;
  const others = hero ? visible.filter((b) => b.id !== hero.id) : visible;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: theme.bg,
        color: theme.ink,
        fontFamily: FONT_STACKS.sans,
        overflow: "hidden",
        display: "flex",
        flexDirection: "row",
      }}
    >
      <LibrarySidebar
        theme={theme}
        themeKey={themeKey}
        tab={tab}
        setTab={setTab}
        importing={importing}
        onImport={onImport}
        onImportFolder={onImportFolder}
        onOpenQueue={onOpenQueue}
        onOpenSettings={onOpenSettings}
        onOpenSearch={() => setSearchOpen(true)}
        shelfActive={shelfActive}
        shelves={shelves}
        shelvesActive={shelvesActive}
        onOpenShelves={onOpenShelves}
        onNewShelf={onNewShelf}
        onOpenShelf={onOpenShelf}
        activeShelfId={activeShelfId}
      />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: theme.bg,
        }}
      >

      {/* Body cross-fades when the user switches tab or opens/closes a
          Store source detail. The wrapper provides the positioning
          context AnimatedSwap's absolute slots need. */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <AnimatedSwap
          viewKey={
            activeShelf
              ? `shelf:${activeShelf.id}`
              : shelvesActive
                ? "shelves"
                : sourceDetailView
                  ? `novel:${sourceDetailView.libraryEntryId ?? sourceDetailView.novelUrl}`
                  : `tab:${tab}`
          }
        >
      {shelvesActive ? (
        <ShelvesPage
          theme={theme}
          shelves={shelves}
          books={books}
          covers={covers}
          onOpenBook={onOpen}
          onOpenShelf={onOpenShelf}
          onAddToShelf={onAddToShelf}
          onRequestRenameShelf={onRequestRenameShelf}
          onRequestDeleteShelf={onRequestDeleteShelf}
          onNewShelf={onNewShelf}
          onRemoveFromShelf={onRemoveBookFromShelf}
        />
      ) : sourceDetailView ? (
        // Source-backed library entries replace the shelf with the same
        // NovelDetailView the Store uses for browsing. Tabs above stay
        // visible — clicking any tab exits the detail view.
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <NovelDetailView
            theme={theme}
            layout="desktop"
            sourceId={sourceDetailView.sourceId}
            novelUrl={sourceDetailView.novelUrl}
            libraryEntryId={sourceDetailView.libraryEntryId}
            onBack={onCloseSourceDetailView}
            onStreamRead={(chapterId) =>
              onStreamRead(
                sourceDetailView.sourceId,
                sourceDetailView.novelUrl,
                chapterId,
              )
            }
            onImportComplete={onSourceImportComplete}
            onOpenRangeDialog={onOpenSourceDetailRangeDialog}
            shelves={shelves}
            bookShelfIds={
              books.find((b) => b.id === sourceDetailView.libraryEntryId)
                ?.shelfIds ?? []
            }
            onToggleShelf={(shelfId) =>
              onToggleBookShelf(sourceDetailView.libraryEntryId!, shelfId)
            }
            onNewShelfFromDetail={onNewShelf}
          />
        </div>
      ) : tab === "store" ? (
        <Store
          theme={theme}
          layout="desktop"
          onStreamRead={onStreamRead}
          onImportComplete={onSourceImportComplete}
        />
      ) : activeShelf ? (
        // Single-shelf detail page (Task 10): the same header pattern as
        // ShelvesPage's own title, filtered to one shelf's books. Shares
        // the library grid's LibraryCard + gridTemplateColumns exactly so
        // switching between "all books" and a shelf doesn't jitter.
        <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px 40px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 24,
            }}
          >
            <div>
              <h1
                style={{
                  fontFamily: FONT_SERIF_DISPLAY,
                  fontWeight: 400,
                  fontSize: 30,
                  margin: 0,
                  letterSpacing: "-0.01em",
                  color: theme.ink,
                }}
              >
                {activeShelf.name}
              </h1>
              <div style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>
                {tr("shelves.count", { n: shelfBooks.length })}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Button
                theme={theme}
                variant="primary"
                size="md"
                onClick={() => onAddToShelf(activeShelf.id)}
                leadingIcon={<Icon name="plus" size={14} />}
              >
                {tr("shelves.addBook")}
              </Button>
              <Button
                theme={theme}
                variant="ghost"
                size="md"
                onClick={() => onRequestRenameShelf(activeShelf)}
                leadingIcon={<Icon name="pencil" size={14} />}
              >
                {tr("shelves.rename")}
              </Button>
              <Button
                theme={theme}
                variant="destructiveGhost"
                size="md"
                onClick={() => onRequestDeleteShelf(activeShelf)}
                leadingIcon={<Icon name="trash" size={14} />}
              >
                {tr("shelves.delete")}
              </Button>
            </div>
          </div>
          {shelfBooks.length === 0 ? (
            <AddTile theme={theme} onClick={() => onAddToShelf(activeShelf.id)} />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 32,
                rowGap: 40,
              }}
            >
              {shelfBooks.map((b) => (
                <LibraryCard
                  key={b.id}
                  theme={theme}
                  book={b}
                  coverSrc={covers[b.id]}
                  onOpen={() => onOpen(b.id)}
                  onContextMenu={(x: number, y: number) =>
                    onCardContextMenu(b.id, x, y, activeShelf.id)
                  }
                />
              ))}
            </div>
          )}
        </div>
      ) : (
      <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px 40px" }}>
        {error && <ErrorBanner theme={theme} message={error} />}

        {loading && books.length === 0 ? (
          <div style={{ color: theme.muted, padding: 40, textAlign: "center" }}>
            {tr("library.loading")}
          </div>
        ) : books.length === 0 ? (
          <EmptyState theme={theme} onImport={onImport} importing={importing} />
        ) : visible.length === 0 ? (
          <FilteredEmptyState theme={theme} tab={tab} />
        ) : (
          <>
            {hero && (
              <HeroContinueCard
                theme={theme}
                book={hero}
                coverSrc={covers[hero.id]}
                onOpen={() => onOpen(hero.id)}
                onDelete={() => onDelete(hero.id)}
                onEdit={() => onEdit(hero.id)}
              />
            )}

            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <div>
                <h2
                  style={{
                    fontFamily: FONT_SERIF_DISPLAY,
                    fontWeight: 400,
                    fontSize: 24,
                    margin: 0,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {tab === "all" ? tr("library.yourShelf") : shelfHeadingFor(tab, tr)}
                </h2>
                <div
                  style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}
                >
                  {tr(others.length === 1 ? "library.bookCountOne" : "library.bookCountOther", { n: others.length })}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 32,
                rowGap: 40,
              }}
            >
              {others.map((b) => (
                <LibraryCard
                  key={b.id}
                  theme={theme}
                  book={b}
                  coverSrc={covers[b.id]}
                  onOpen={() => onOpen(b.id)}
                  onContextMenu={(x: number, y: number) =>
                    onCardContextMenu(b.id, x, y)
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>
      )}
        </AnimatedSwap>
      </div>
      </div>
      {searchOpen && (
        <SearchOverlay
          theme={theme}
          themeKey={themeKey}
          books={books}
          covers={covers}
          onOpen={onOpen}
          setTab={setTab}
          setQuery={setQuery}
          onOpenSettings={onOpenSettings}
          onOpenQueue={onOpenQueue}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}

function MobileLibrary({
  theme,
  books,
  covers,
  loading,
  error,
  importing,
  tab,
  setTab,
  onOpen,
  onImport,
  // Folder import is desktop-only — the button was removed from this
  // layout. Keep the prop in the destructure (underscored) so the
  // LayoutProps shape doesn't fork.
  onImportFolder: _onImportFolder,
  onStreamRead,
  onSourceImportComplete,
  sourceDetailView,
  onCloseSourceDetailView,
  onOpenSourceDetailRangeDialog,
  onOpenQueue,
  onOpenSettings,
  shelvesActive,
  onOpenShelves,
  shelves,
  onNewShelf,
  onCreateShelf: _onCreateShelf,
  onRenameShelf: _onRenameShelf,
  onRequestRenameShelf,
  onDeleteShelf: _onDeleteShelf,
  onRequestDeleteShelf,
  onAddBooksToShelf: _onAddBooksToShelf,
  onToggleBookShelf,
  onRemoveBookFromShelf,
  onAddToShelf,
  onOpenShelf,
  activeShelfId,
  onDelete: _onDelete,
  onEdit: _onEdit,
  onCardContextMenu,
}: LayoutProps) {
  const { tr, locale } = useI18n();
  const isAr = locale === "ar";
  // Single-shelf detail page (Task 10) — see DesktopLibrary for the same
  // computation. Resolves the nav view's shelfId (threaded down as
  // `activeShelfId`) against the live shelf list.
  const activeShelf = activeShelfId
    ? shelves.find((s) => s.id === activeShelfId) ?? null
    : null;
  const shelfBooks = activeShelf ? booksOnShelf(books, activeShelf.id) : [];
  // Filter to the selected status tab. "store" is handled separately
  // (a body swap, not a filter); the tab pills exclude it on mobile
  // because Store toggling lives in the bottom nav.
  const visible = books.filter((b) => matchesTab(b, tab));
  // Hero is the "continue reading" affordance — only meaningful on the
  // full library view. On a filtered tab we render a flat shelf so every
  // match is equally weighted.
  const hero =
    tab === "all"
      ? visible.find((b) => b.lastReadAt !== undefined)
      : undefined;
  const others = hero ? visible.filter((b) => b.id !== hero.id) : visible;
  // Display-time fallback for a blank `Book.title` (see common.untitled) —
  // computed once so the font-family/line-height pick and the rendered
  // text agree on what's actually on screen.
  const heroDisplayTitle = hero ? hero.title || tr("common.untitled") : "";

  // Hero is at most one card per render — a single hook instance covers it.
  // Shelf cards each need their own long-press state, so they live in a
  // subcomponent (MobileShelfCard) that calls the hook itself.
  const heroLongPress = useLongPress((x, y) => {
    if (hero) onCardContextMenu(hero.id, x, y);
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: theme.bg,
        color: theme.ink,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: FONT_STACKS.sans,
        // Android status bar / iOS notch: enableEdgeToEdge() lays the
        // WebView under the system bars, so without these insets the
        // Library title collides with the clock and signal icons.
        // Left/Right (not Inline Start/End) deliberately — these mirror
        // physical hardware insets (notch, rounded corners), which stay
        // pinned to the device's physical edges regardless of UI language.
        // There's no logical `env(safe-area-inset-inline-*)` counterpart,
        // so flipping the property name here would silently swap which
        // physical edge gets which inset in RTL.
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {/* Top header — title + filter tabs. Only on the shelf. The
          Store tab, the Shelves page, and a single-shelf detail page swap
          in their own back-arrow headers below. The source detail view
          (NovelDetailView) brings its own header with a back arrow. Action
          buttons live in the bottom nav, so the right side of the title
          row is empty. */}
      {!sourceDetailView && !shelvesActive && !activeShelf && tab !== "store" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "16px 22px 10px",
            borderBottom: `0.5px solid ${theme.rule}`,
          }}
        >
          <h1
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontWeight: 400,
              fontSize: 28,
              margin: 0,
              letterSpacing: "-0.02em",
              color: theme.ink,
            }}
          >
            {tr("sidebar.library")}
          </h1>
          <MobileTabRow theme={theme} tab={tab} setTab={setTab} />
        </div>
      )}

      {/* Body cross-fades on tab switch / Store ↔ NovelDetail toggle. The
          wrapper provides AnimatedSwap's positioning context. */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <AnimatedSwap
          viewKey={
            activeShelf
              ? `shelf:${activeShelf.id}`
              : shelvesActive
                ? "shelves"
                : sourceDetailView
                  ? `novel:${sourceDetailView.libraryEntryId ?? sourceDetailView.novelUrl}`
                  : `tab:${tab}`
          }
        >
      {shelvesActive ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <BackHeader
            theme={theme}
            title={tr("shelves.title")}
            onBack={() => back()}
          />
          <ShelvesPage
            theme={theme}
            shelves={shelves}
            books={books}
            covers={covers}
            onOpenBook={onOpen}
            onOpenShelf={onOpenShelf}
            onAddToShelf={onAddToShelf}
            onRequestRenameShelf={onRequestRenameShelf}
            onRequestDeleteShelf={onRequestDeleteShelf}
            onNewShelf={onNewShelf}
            onRemoveFromShelf={onRemoveBookFromShelf}
          />
        </div>
      ) : sourceDetailView ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <NovelDetailView
            theme={theme}
            layout="mobile"
            sourceId={sourceDetailView.sourceId}
            novelUrl={sourceDetailView.novelUrl}
            libraryEntryId={sourceDetailView.libraryEntryId}
            onBack={onCloseSourceDetailView}
            onStreamRead={(chapterId) =>
              onStreamRead(
                sourceDetailView.sourceId,
                sourceDetailView.novelUrl,
                chapterId,
              )
            }
            onImportComplete={onSourceImportComplete}
            onOpenRangeDialog={onOpenSourceDetailRangeDialog}
            shelves={shelves}
            bookShelfIds={
              books.find((b) => b.id === sourceDetailView.libraryEntryId)
                ?.shelfIds ?? []
            }
            onToggleShelf={(shelfId) =>
              onToggleBookShelf(sourceDetailView.libraryEntryId!, shelfId)
            }
            onNewShelfFromDetail={onNewShelf}
          />
        </div>
      ) : tab === "store" ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <BackHeader
            theme={theme}
            title={tr("sidebar.store")}
            onBack={() => setTab("all")}
          />
          <Store
            theme={theme}
            layout="mobile"
            onStreamRead={onStreamRead}
            onImportComplete={onSourceImportComplete}
          />
        </div>
      ) : activeShelf ? (
        // Single-shelf detail page (Task 10), mobile: same back-arrow +
        // large-title pattern as the Shelves/Store branches above, then a
        // header row (count + Add/Rename/Delete) and the same 3-column
        // grid + MobileShelfCard the default shelf uses.
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <BackHeader theme={theme} title={activeShelf.name} onBack={() => back()} />
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px 40px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <h1
                  style={{
                    fontFamily: FONT_SERIF_DISPLAY,
                    fontWeight: 400,
                    fontSize: 24,
                    margin: 0,
                    letterSpacing: "-0.01em",
                    color: theme.ink,
                  }}
                >
                  {activeShelf.name}
                </h1>
                <div style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>
                  {tr("shelves.count", { n: shelfBooks.length })}
                </div>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 20,
                flexWrap: "wrap",
              }}
            >
              <Button
                theme={theme}
                variant="primary"
                size="sm"
                onClick={() => onAddToShelf(activeShelf.id)}
                leadingIcon={<Icon name="plus" size={13} />}
              >
                {tr("shelves.addBook")}
              </Button>
              <Button
                theme={theme}
                variant="ghost"
                size="sm"
                onClick={() => onRequestRenameShelf(activeShelf)}
                leadingIcon={<Icon name="pencil" size={13} />}
              >
                {tr("shelves.rename")}
              </Button>
              <Button
                theme={theme}
                variant="destructiveGhost"
                size="sm"
                onClick={() => onRequestDeleteShelf(activeShelf)}
                leadingIcon={<Icon name="trash" size={13} />}
              >
                {tr("shelves.delete")}
              </Button>
            </div>
            {shelfBooks.length === 0 ? (
              <AddTile theme={theme} onClick={() => onAddToShelf(activeShelf.id)} />
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 16,
                  rowGap: 22,
                }}
              >
                {shelfBooks.map((b) => (
                  <MobileShelfCard
                    key={b.id}
                    theme={theme}
                    book={b}
                    coverSrc={covers[b.id]}
                    onOpen={() => onOpen(b.id)}
                    onContextMenu={(x, y) =>
                      onCardContextMenu(b.id, x, y, activeShelf.id)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px 40px" }}>
        {error && <ErrorBanner theme={theme} message={error} />}

        {loading && books.length === 0 ? (
          <div style={{ color: theme.muted, padding: 30, textAlign: "center" }}>
            {tr("library.loadingShort")}
          </div>
        ) : books.length === 0 ? (
          <EmptyState theme={theme} onImport={onImport} importing={importing} />
        ) : visible.length === 0 ? (
          <FilteredEmptyState theme={theme} tab={tab} />
        ) : (
          <>
            {hero && (
              <div
                onClick={() => {
                  if (heroLongPress.consumeLongPress()) return;
                  onOpen(hero.id);
                }}
                {...heroLongPress.bind}
                role="button"
                tabIndex={0}
                style={{
                  padding: 16,
                  borderRadius: 14,
                  background: theme.chrome,
                  display: "flex",
                  gap: 14,
                  marginBottom: 28,
                  alignItems: "center",
                  cursor: "pointer",
                  // Suppress the default long-press text-selection / callout
                  // so the menu opens cleanly without a stray selection box.
                  WebkitUserSelect: "none",
                  userSelect: "none",
                  WebkitTouchCallout: "none",
                }}
              >
                <BookCover
                  title={hero.title}
                  author={hero.author}
                  palette={paletteForId(hero.id)}
                  size="sm"
                  src={covers[hero.id]}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: theme.muted,
                      letterSpacing: isAr ? "normal" : "0.1em",
                      textTransform: isAr ? "none" : "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    {hero.lastReadAt ? tr("library.continue") : tr("library.startReading")}
                  </div>
                  <div
                    style={{
                      fontFamily: titleFontFor(heroDisplayTitle),
                      fontStyle: "normal",
                      fontSize: 18,
                      lineHeight: isArabicTitle(heroDisplayTitle) ? 1.4 : 1.15,
                      color: theme.ink,
                      letterSpacing: "-0.01em",
                      marginBottom: 4,
                    }}
                  >
                    {heroDisplayTitle}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: theme.muted,
                      marginBottom: 10,
                    }}
                  >
                    {tr("library.chaptersAgo", {
                      n: hero.chapterCount,
                      rel: relTime(hero.lastReadAt ?? hero.addedAt, tr),
                    })}
                  </div>
                  <div
                    style={{
                      height: 3,
                      background: theme.rule,
                      borderRadius: 2,
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round(hero.progress * 100)}%`,
                        height: "100%",
                        background: theme.ink,
                        borderRadius: 2,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: theme.muted,
                letterSpacing: isAr ? "normal" : "0.1em",
                textTransform: isAr ? "none" : "uppercase",
                marginBottom: 14,
              }}
            >
              {tr("library.yourShelf")}
            </div>
            <div
              style={{
                display: "grid",
                // minmax(0, 1fr) lets columns shrink below the cover's
                // intrinsic width so 3 fluid covers fit any phone width
                // instead of overflowing past the right edge.
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 16,
                rowGap: 22,
              }}
            >
              {others.map((b) => (
                <MobileShelfCard
                  key={b.id}
                  theme={theme}
                  book={b}
                  coverSrc={covers[b.id]}
                  onOpen={() => onOpen(b.id)}
                  onContextMenu={(x, y) => onCardContextMenu(b.id, x, y)}
                />
              ))}
            </div>
          </>
        )}
      </div>
      )}
        </AnimatedSwap>
      </div>
      {/* Bottom navigation. Hidden while the source detail view owns
          the body (NovelDetailView has its own back-arrow header).
          Visible on the shelf and on the Store so the user always
          has the import + queue + store toggle within thumb reach. */}
      {!sourceDetailView && (
        <MobileBottomNav
          theme={theme}
          importing={importing}
          tab={tab}
          shelvesActive={shelvesActive || !!activeShelf}
          onOpenShelves={onOpenShelves}
          onSetStore={() => setTab(tab === "store" ? "all" : "store")}
          onOpenQueue={onOpenQueue}
          onImport={onImport}
          onOpenSettings={onOpenSettings}
        />
      )}
    </div>
  );
}

interface MobileBottomNavProps {
  theme: Theme;
  importing: boolean;
  tab: LibraryTab;
  shelvesActive: boolean;
  onOpenShelves: () => void;
  onSetStore: () => void;
  onOpenQueue: () => void;
  onImport: () => void;
  onOpenSettings: () => void;
}

/** Bottom nav for the mobile Library shell. Five slots arranged
 *  symmetrically around the central focal "import EPUB" button:
 *
 *    [Shelves]  [Store]   ( + )   [Downloads]  [Settings]
 *
 *  (Left-to-right in DOM order; RTL locales mirror it, so Shelves sits
 *  at the visual start edge.) Shelves and Store — the two library-browse
 *  destinations — flank the "+" on one side; the queue and settings on
 *  the other. The active destination (Shelves or Store) is filled.
 *
 *  The "+" button is filled and slightly larger (50px vs 44px) so the
 *  primary action is visually obvious; it sits flush with the bar
 *  rather than protruding above it. The other four are circular
 *  outlines matching the existing icon-button style.
 *
 *  Visibility: rendered from MobileLibrary when no source-detail
 *  view is open. The bar sits above the Android nav bar / iOS home
 *  indicator by way of the safe-area inset the outer wrapper
 *  already provides.
 */
interface BackHeaderProps {
  theme: Theme;
  title: string;
  onBack: () => void;
}

/** Thin back-arrow header used by mobile inner pages (Store, future
 *  side-pages) when the shelf-mode Library header would be misleading.
 *  Visual matches NovelDetailView's header: 34px outlined circle with
 *  the arrowL glyph, label fills the rest of the row. The wrapping
 *  border-bottom keeps the row visually separated from the body
 *  underneath. */
function BackHeader({ theme, title, onBack }: BackHeaderProps) {
  const { tr } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 18px 12px",
        borderBottom: `0.5px solid ${theme.rule}`,
        flexShrink: 0,
      }}
    >
      <button
        onClick={onBack}
        aria-label={tr("library.backToLibrary")}
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          border: `0.5px solid ${theme.rule}`,
          background: theme.bg,
          color: theme.ink,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontFamily: "inherit",
        }}
      >
        <Icon name="arrowL" size={16} className="rtl-flip-x" />
      </button>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "-0.005em",
          color: theme.ink,
        }}
      >
        {title}
      </div>
    </div>
  );
}

interface MobileTabRowProps {
  theme: Theme;
  tab: LibraryTab;
  setTab: (t: LibraryTab) => void;
}

/** Status filter pills under the mobile "Library" header.
 *
 *  Behaviors layered in top of the plain pill row:
 *    - Hidden scrollbar in both webkit + Firefox + Edge.
 *    - Fade-in chevron arrows on the left/right when overflow exists
 *      in that direction. Tapping an arrow scrolls one viewport-width
 *      toward that side. Arrows fade out (transition opacity) when
 *      the scroller hits the corresponding edge.
 *    - Animated active background: a single absolute-positioned
 *      "indicator" sits beneath whichever pill is active. Tapping a
 *      different pill animates `left + width` to the new pill's
 *      bounding box rather than instantly flipping the fill, so the
 *      change reads as a slide.
 *
 *  Store tab from the desktop TABS list is intentionally skipped —
 *  Store toggling lives in the bottom nav (`globe` icon). */
function MobileTabRow({ theme, tab, setTab }: MobileTabRowProps) {
  const { tr, dir } = useI18n();
  const rtl = dir === "rtl";
  const items = useMemo<typeof TABS>(
    () => TABS.filter((t) => t.key !== "store"),
    [],
  );
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<Map<LibraryTab, HTMLButtonElement>>(new Map());
  const indicatorRef = useRef<HTMLDivElement>(null);
  const indicatorInitialized = useRef(false);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Recompute the scroll-edge state. Called on scroll, mount, and on
  // active-pill change (in case the pill widths drove a layout shift).
  // Same RTL normalization as SectionCarousel.tsx's `recompute()`: in an
  // RTL container, scrollLeft is 0 at the right edge and goes negative as
  // the user scrolls toward the left content (older WebKit grows positive
  // instead) — normalize to "distance from visual start" so the math reads
  // the same in both directions.
  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const sl = el.scrollLeft;
    const distFromStart = rtl ? Math.abs(sl) : sl;
    const distFromEnd = max - distFromStart;
    setCanScrollLeft(distFromStart > 1);
    setCanScrollRight(distFromEnd > 1);
  }, [rtl]);

  useEffect(() => {
    updateEdges();
    // ResizeObserver covers the case where the parent's width
    // changed (e.g. portrait → landscape) without a scroll event.
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateEdges]);

  // Position the active-pill background indicator. On the very first
  // layout we set it without transition so the indicator appears
  // already-in-place; subsequent updates animate.
  useEffect(() => {
    const el = pillRefs.current.get(tab);
    const indicator = indicatorRef.current;
    const scroller = scrollerRef.current;
    if (!el || !indicator || !scroller) return;
    const left = el.offsetLeft;
    const width = el.offsetWidth;
    if (!indicatorInitialized.current) {
      indicator.style.transition = "none";
      indicator.style.left = `${left}px`;
      indicator.style.width = `${width}px`;
      indicator.style.opacity = "1";
      // Re-enable transitions on the next frame so subsequent
      // tab changes animate.
      requestAnimationFrame(() => {
        if (indicator) {
          indicator.style.transition =
            "left 240ms cubic-bezier(0.4, 0.0, 0.2, 1), width 240ms cubic-bezier(0.4, 0.0, 0.2, 1)";
        }
      });
      indicatorInitialized.current = true;
    } else {
      indicator.style.left = `${left}px`;
      indicator.style.width = `${width}px`;
    }
    // Scroll the active pill into view if it's offscreen — happens
    // on portrait↔landscape flips where the layout shrinks.
    const overflowsLeft = left < scroller.scrollLeft;
    const overflowsRight =
      left + width > scroller.scrollLeft + scroller.clientWidth;
    if (overflowsLeft || overflowsRight) {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [tab]);

  const scrollBy = useCallback(
    (direction: "left" | "right") => {
      const el = scrollerRef.current;
      if (!el) return;
      const step = Math.max(el.clientWidth * 0.7, 120);
      // Same RTL sign-flip as SectionCarousel.tsx's `scrollByDir()` — in an
      // RTL container the "left"/"right" arrow's *visual* meaning stays
      // fixed (previous/next), but the underlying scrollLeft axis it needs
      // to move along is mirrored.
      const signed = (direction === "left" ? -1 : 1) * step * (rtl ? -1 : 1);
      el.scrollBy({ left: signed, behavior: "smooth" });
    },
    [rtl],
  );

  return (
    <div
      style={{
        position: "relative",
        // Inline-style scrollbar hide doesn't fully cover webkit;
        // the surrounding rule is set globally via global.css. The
        // belt-and-suspenders here is just `scrollbarWidth: 'none'`
        // for Firefox + `msOverflowStyle` for legacy Edge.
      }}
    >
      <div
        ref={scrollerRef}
        onScroll={updateEdges}
        className="leaflet-pill-row"
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          position: "relative",
          // The indicator is absolute-positioned in this same container,
          // so the scroller must be the position context.
          paddingBottom: 2,
        }}
      >
        {/* Animated active-pill background. Sits underneath the
            buttons (zIndex 0); button text stays on top (zIndex 1).
            Color picks up the theme's ink + bg switch like the old
            inline fill did. */}
        <div
          ref={indicatorRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            height: "100%",
            left: 0,
            width: 0,
            opacity: 0,
            background: theme.ink,
            borderRadius: 18,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        {items.map(({ key, msgKey }) => {
          const active = key === tab;
          return (
            <button
              key={key}
              ref={(el) => {
                if (el) pillRefs.current.set(key, el);
                else pillRefs.current.delete(key);
              }}
              onClick={() => setTab(key)}
              style={{
                flexShrink: 0,
                position: "relative",
                zIndex: 1,
                border: `0.5px solid ${active ? "transparent" : theme.rule}`,
                background: "transparent",
                color: active ? theme.bg : theme.muted,
                padding: "7px 14px",
                borderRadius: 18,
                fontSize: 12.5,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "color 200ms ease",
              }}
            >
              {tr(msgKey)}
            </button>
          );
        })}
      </div>
      <PillScrollArrow
        theme={theme}
        side="left"
        visible={canScrollLeft}
        onClick={() => scrollBy("left")}
      />
      <PillScrollArrow
        theme={theme}
        side="right"
        visible={canScrollRight}
        onClick={() => scrollBy("right")}
      />
    </div>
  );
}

interface PillScrollArrowProps {
  theme: Theme;
  side: "left" | "right";
  visible: boolean;
  onClick: () => void;
}

/** Floating chevron-arrow button overlaying the pill scroller's edge.
 *  Fades in only when there's overflow content in that direction; the
 *  button stays mounted across visibility transitions so the opacity
 *  animates smoothly (unmounting + remounting on every scroll would
 *  pop). When invisible the button is `pointer-events: none` so it
 *  doesn't eat taps meant for the pill below. */
function PillScrollArrow({
  theme,
  side,
  visible,
  onClick,
}: PillScrollArrowProps) {
  const { tr } = useI18n();
  return (
    <button
      onClick={onClick}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      aria-label={tr(side === "left" ? "library.scrollTabsLeft" : "library.scrollTabsRight")}
      style={{
        position: "absolute",
        top: "50%",
        [side]: 0,
        transform: "translateY(-50%)",
        width: 28,
        height: 28,
        borderRadius: 14,
        border: `0.5px solid ${theme.rule}`,
        background: theme.bg,
        color: theme.muted,
        cursor: visible ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 180ms ease",
        boxShadow: `0 1px 4px ${theme.bg}`,
        flexShrink: 0,
      }}
    >
      <Icon name={side === "left" ? "arrowL" : "arrowR"} size={14} />
    </button>
  );
}

function MobileBottomNav({
  theme,
  importing,
  tab,
  shelvesActive,
  onOpenShelves,
  onSetStore,
  onOpenQueue,
  onImport,
  onOpenSettings,
}: MobileBottomNavProps) {
  const { tr } = useI18n();
  return (
    <div
      style={{
        flexShrink: 0,
        position: "relative",
        padding: "10px 14px 14px",
        background: theme.bg,
        // Bolder top edge (theme.ruleStrong) so the bar's boundary
        // registers cleanly against the upward shadow rather than
        // bleeding into the shadow gradient.
        borderTop: `1px solid ${theme.ruleStrong}`,
        // Soft upward shadow so the bar reads as a floating surface
        // hovering over the shelf, not a flush edge of the page.
        boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        gap: 6,
      }}
    >
      <NavIconButton
        theme={theme}
        icon="layers"
        ariaLabel={tr("shelves.title")}
        active={shelvesActive}
        onClick={onOpenShelves}
      />
      <NavIconButton
        theme={theme}
        icon="globe"
        ariaLabel={tab === "store" ? tr("library.backToLibrary") : tr("library.openStore")}
        active={tab === "store"}
        onClick={onSetStore}
      />
      <NavFabButton
        theme={theme}
        importing={importing}
        onClick={onImport}
      />
      <NavIconButton
        theme={theme}
        icon="download"
        ariaLabel={tr("library.openDownloads")}
        onClick={onOpenQueue}
        showQueueBadge
      />
      <NavIconButton
        theme={theme}
        icon="settings"
        ariaLabel={tr("sidebar.settings")}
        onClick={onOpenSettings}
      />
    </div>
  );
}

interface NavIconButtonProps {
  theme: Theme;
  icon: "globe" | "download" | "doc" | "settings" | "layers";
  ariaLabel: string;
  active?: boolean;
  disabled?: boolean;
  showQueueBadge?: boolean;
  onClick: () => void;
}

function NavIconButton({
  theme,
  icon,
  ariaLabel,
  active,
  disabled,
  showQueueBadge,
  onClick,
}: NavIconButtonProps) {
  const [activeCount, setActiveCount] = useState(() =>
    activeJobCount(getQueueState()),
  );
  useEffect(() => {
    if (!showQueueBadge) return;
    const off = subscribeToQueue((s) => setActiveCount(activeJobCount(s)));
    return off;
  }, [showQueueBadge]);
  const showBadge = !!showQueueBadge && activeCount > 0;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{
        position: "relative",
        width: 44,
        height: 44,
        borderRadius: 22,
        border: active ? "none" : `0.5px solid ${theme.rule}`,
        background: active ? theme.ink : "transparent",
        color: active ? theme.bg : theme.ink,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon name={icon} size={18} />
      {showBadge && (
        <span
          style={{
            position: "absolute",
            top: -2,
            insetInlineEnd: -2,
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 9,
            background: theme.ink,
            color: theme.bg,
            fontSize: 10,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            border: `2px solid ${theme.bg}`,
          }}
        >
          {activeCount > 99 ? "99+" : activeCount}
        </span>
      )}
    </button>
  );
}

interface NavFabButtonProps {
  theme: Theme;
  importing: boolean;
  onClick: () => void;
}

function NavFabButton({ theme, importing, onClick }: NavFabButtonProps) {
  // The focal action — filled + slightly larger than the outlined siblings
  // (50px vs 38px) + a soft drop shadow so it reads as the primary
  // affordance. Sits flush with the bar rather than protruding above it.
  const { tr } = useI18n();
  return (
    <button
      onClick={onClick}
      disabled={importing}
      aria-label={tr("library.importEpub")}
      title={importing ? tr("sidebar.importing") : tr("library.importEpub")}
      style={{
        width: 50,
        height: 50,
        borderRadius: 25,
        border: "none",
        background: theme.ink,
        color: theme.bg,
        cursor: importing ? "progress" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
        opacity: importing ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      <Icon name="plus" size={20} />
    </button>
  );
}

/** Top-end corner marker flagging a source-backed library card with the
 *  source's favicon (globe fallback). Returns undefined for local books
 *  (epub/pdf/docx) so their covers render no marker. */
function sourceCornerMarker(theme: Theme, book: BookIndexEntry) {
  if (book.kind !== "source" || !book.sourceId) return undefined;
  const meta = getSourceMeta(book.sourceId);
  return (
    <SourceBadge
      theme={theme}
      variant="corner"
      iconUrl={meta?.iconUrl}
      label={meta?.name}
    />
  );
}

function MobileShelfCard({
  theme,
  book,
  coverSrc,
  onOpen,
  onContextMenu,
}: {
  theme: Theme;
  book: BookIndexEntry;
  coverSrc?: string;
  onOpen: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const { tr } = useI18n();
  const longPress = useLongPress(onContextMenu);
  // Display-time fallback for a blank `Book.title` (see common.untitled) —
  // computed once so the font-family/line-height pick and the rendered
  // text agree on what's actually on screen.
  const displayTitle = book.title || tr("common.untitled");
  return (
    <div
      onClick={() => {
        if (longPress.consumeLongPress()) return;
        onOpen();
      }}
      {...longPress.bind}
      style={{
        // `minWidth: 0` so a wide unbreakable string inside this grid item
        // doesn't push the cell past its `minmax(0, 1fr)` track.
        minWidth: 0,
        // Suppress the platform long-press text-selection / callout so the
        // menu opens cleanly without a stray selection box flickering in.
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <BookCover
        title={book.title}
        author={book.author}
        palette={paletteForId(book.id)}
        size="sm"
        src={coverSrc}
        badge={book.kind === "pdf" ? "PDF" : book.kind === "docx" ? "DOCX" : null}
        cornerMarker={sourceCornerMarker(theme, book)}
        // Stretch the cover to the (constrained) cell width — the fixed
        // 110px `sm` size would overflow a 3-column grid on narrow phones.
        fluid
      />
      <div
        style={{
          fontFamily: titleFontFor(displayTitle),
          fontSize: 12,
          fontWeight: 500,
          marginTop: 8,
          lineHeight: 1.3,
          color: theme.ink,
          letterSpacing: "-0.005em",
          // Clamp the title to 2 lines so cards keep a consistent height
          // instead of jumping to 3+ lines on long titles, and let unbreakable
          // tokens wrap so they don't blow out the cell.
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
        }}
      >
        {displayTitle}
      </div>
      <div style={{ fontSize: 9.5, color: theme.muted, marginTop: 2 }}>
        {book.author || tr("common.unknownAuthor")}
      </div>
      {book.progress > 0 && book.progress < 1 && (
        <div
          style={{
            height: 2,
            background: theme.rule,
            borderRadius: 1,
            marginTop: 6,
          }}
        >
          <div
            style={{
              width: `${book.progress * 100}%`,
              height: "100%",
              background: theme.muted,
              borderRadius: 1,
            }}
          />
        </div>
      )}
    </div>
  );
}

function HeroContinueCard({
  theme,
  book,
  coverSrc,
  onOpen,
  onDelete,
  onEdit,
}: {
  theme: Theme;
  book: BookIndexEntry;
  coverSrc?: string;
  onOpen: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const { tr, locale } = useI18n();
  const isAr = locale === "ar";
  const palette = paletteForId(book.id);
  // Display-time fallback for a blank `Book.title` (see common.untitled) —
  // computed once so the tooltip, font-family pick, and rendered text all
  // agree on what's actually on screen.
  const displayTitle = book.title || tr("common.untitled");
  return (
    <div
      style={{
        display: "flex",
        gap: 40,
        marginBottom: 50,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      <BookCover
        title={book.title}
        author={book.author}
        palette={palette}
        size="lg"
        src={coverSrc}
      />
      {/* minWidth: 0 so the title's nowrap+ellipsis clips at the flex
          child's assigned width instead of letting the child grow to
          accommodate the full title. */}
      <div style={{ flex: 1, paddingTop: 10, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: theme.muted,
            letterSpacing: isAr ? "normal" : "0.12em",
            textTransform: isAr ? "none" : "uppercase",
            marginBottom: 10,
          }}
        >
          {book.lastReadAt ? tr("library.continueReading") : tr("library.startReading")}
        </div>
        <h1
          title={displayTitle}
          style={{
            // Arabic / mixed titles use the Readex Pro stack so digits and
            // Latin punctuation interleaved in the title don't fall through
            // to Fraunces and stand out as a different typeface.
            fontFamily: titleFontFor(displayTitle),
            // Italic only makes sense on Fraunces — suppress it for the
            // Readex Pro path to avoid synthetic italic on Arabic.
            fontStyle: "normal",
            fontWeight: 400,
            fontSize: 44,
            // Even more vertical room than 1.3 — the previous tweak still
            // clipped the bottom dot on letters like ج at this font size.
            lineHeight: 1.45,
            paddingBottom: 8,
            margin: "0 0 4px",
            letterSpacing: "-0.02em",
            color: theme.ink,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {displayTitle}
        </h1>
        <div style={{ fontSize: 13, color: theme.muted, marginBottom: 22 }}>
          {tr("library.byAuthorChapters", {
            author: book.author || tr("common.unknownAuthor"),
            n: book.chapterCount,
          })}
        </div>
        <div
          style={{
            padding: 18,
            background: theme.chrome,
            borderRadius: 10,
            border: `0.5px solid ${theme.rule}`,
            maxWidth: 480,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                flex: 1,
                height: 4,
                background: theme.rule,
                borderRadius: 2,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${book.progress * 100}%`,
                  background: theme.ink,
                  borderRadius: 2,
                }}
              />
            </div>
            <div
              style={{
                fontSize: 11,
                color: theme.muted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.round(book.progress * 100)}% · {relTime(book.lastReadAt ?? book.addedAt, tr)}
            </div>
          </div>
          <div
            style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Button theme={theme} variant="primary" size="md" onClick={onOpen}>
              {book.lastReadAt ? tr("library.resumeReadingCta") : tr("library.startReadingCta")}
            </Button>
            <Button theme={theme} variant="ghost" size="md" onClick={onEdit}>
              {tr("library.editDetails")}
            </Button>
            <Button
              theme={theme}
              variant="destructiveGhost"
              size="md"
              onClick={onDelete}
            >
              {tr("library.removeFromLibrary")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryCard({
  theme,
  book,
  coverSrc,
  onOpen,
  onContextMenu,
}: {
  theme: Theme;
  book: BookIndexEntry;
  coverSrc?: string;
  onOpen: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const { tr, locale } = useI18n();
  const isAr = locale === "ar";
  // Display-time fallback for a blank `Book.title` (see common.untitled) —
  // computed once so the tooltip, font-family pick, and rendered text all
  // agree on what's actually on screen.
  const displayTitle = book.title || tr("common.untitled");
  return (
    <div
      // Pin the whole card to the cover width so the title row's
      // ellipsis truncates at the cover edge and the progress meter
      // never extends past it. The grid track is `minmax(140, 1fr)` so
      // cells stretch on wide viewports — without this, everything
      // below the cover stretched with the cell.
      style={{ position: "relative", width: BOOK_COVER_DIMS.md.w }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
    >
      <div style={{ cursor: "pointer" }} onClick={onOpen}>
        <div style={{ position: "relative" }}>
          <BookCover
            title={book.title}
            author={book.author}
            palette={paletteForId(book.id)}
            size="md"
            src={coverSrc}
            badge={book.kind === "pdf" ? "PDF" : book.kind === "docx" ? "DOCX" : null}
            cornerMarker={sourceCornerMarker(theme, book)}
          />
          {book.progress === 0 && (
            <span
              aria-label={tr("library.newBadgeAriaLabel")}
              style={{
                position: "absolute",
                top: 8,
                insetInlineStart: 8,
                padding: "3px 7px",
                borderRadius: 4,
                // Dark blurred pill reads on any cover art without
                // dominating it. Same idiom we use elsewhere for cover-
                // surface overlays.
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: isAr ? "normal" : "0.1em",
                textTransform: isAr ? "none" : "uppercase",
                fontFamily: FONT_STACKS.sans,
                backdropFilter: "blur(6px)",
                pointerEvents: "none",
              }}
            >
              {tr("library.newBadge")}
            </span>
          )}
        </div>
        <div
          title={displayTitle}
          style={{
            marginTop: 12,
            fontFamily: titleFontFor(displayTitle),
            fontSize: 14,
            lineHeight: isArabicTitle(displayTitle) ? 1.4 : 1.25,
            color: theme.ink,
            letterSpacing: "-0.005em",
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {displayTitle}
        </div>
        <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
          {book.author || tr("common.unknownAuthor")}
        </div>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 14,
          }}
        >
          {book.progress >= 1 ? (
            <span
              style={{
                fontSize: 10,
                color: theme.muted,
                fontWeight: 600,
                letterSpacing: isAr ? "normal" : "0.06em",
                textTransform: isAr ? "none" : "uppercase",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icon name="check" size={11} /> {tr("sidebar.finished")}
            </span>
          ) : book.progress > 0 ? (
            <>
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: theme.rule,
                  borderRadius: 1,
                }}
              >
                <div
                  style={{
                    width: `${book.progress * 100}%`,
                    height: "100%",
                    background: theme.muted,
                    borderRadius: 1,
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: theme.muted,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Math.round(book.progress * 100)}%
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  theme,
  onImport,
  importing,
}: {
  theme: Theme;
  onImport: () => void;
  importing: boolean;
}) {
  const { tr } = useI18n();
  return (
    <div
      style={{
        maxWidth: 440,
        margin: "64px auto",
        padding: 32,
        borderRadius: 14,
        background: theme.chrome,
        border: `0.5px solid ${theme.rule}`,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: FONT_SERIF_DISPLAY,
          fontSize: 28,
          color: theme.ink,
          letterSpacing: "-0.02em",
          marginBottom: 8,
        }}
      >
        {tr("library.emptyTitle")}
      </div>
      <div
        style={{
          fontSize: 13,
          color: theme.muted,
          lineHeight: 1.55,
          marginBottom: 22,
        }}
      >
        {tr("library.emptyBody")}
      </div>
      <Button
        theme={theme}
        variant="primary"
        size="md"
        onClick={onImport}
        disabled={importing}
        leadingIcon={<Icon name="plus" size={14} />}
      >
        {importing ? tr("sidebar.importing") : tr("library.emptyCta")}
      </Button>
    </div>
  );
}

function shelfHeadingFor(tab: LibraryTab, tr: Tr): string {
  // "all" and "store" are handled by the caller before they get here —
  // we keep them in the union so the call site doesn't need a separate
  // narrowing helper.
  if (tab === "reading") return tr("library.currentlyReading");
  if (tab === "finished") return tr("sidebar.finished");
  if (tab === "wishlist") return tr("sidebar.wishlist");
  return tr("library.shelf");
}

function FilteredEmptyState({
  theme,
  tab,
}: {
  theme: Theme;
  tab: LibraryTab;
}) {
  const { tr } = useI18n();
  const message =
    tab === "reading"
      ? tr("library.emptyReading")
      : tab === "finished"
      ? tr("library.emptyFinished")
      : tab === "wishlist"
      ? tr("library.emptyWishlist")
      : tr("library.emptyGeneric");
  return (
    <div
      style={{
        margin: "64px auto",
        maxWidth: 380,
        padding: 24,
        textAlign: "center",
        color: theme.muted,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      {message}
      <div style={{ marginTop: 8, fontSize: 12 }}>
        {tr("library.setStatusHint")}
      </div>
    </div>
  );
}

function ErrorBanner({
  theme,
  message,
}: {
  theme: Theme;
  message: string;
}) {
  const { tr } = useI18n();
  return (
    <div
      style={{
        padding: "10px 14px",
        background: "rgba(180,60,60,0.08)",
        border: "0.5px solid rgba(180,60,60,0.3)",
        borderRadius: 8,
        color: theme.ink,
        fontSize: 12,
        marginBottom: 20,
      }}
    >
      <strong style={{ fontWeight: 600 }}>{tr("library.importFailedPrefix")}</strong> {message}
    </div>
  );
}

function relTime(ts: number, tr: Tr): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return tr("library.justNow");
  if (m < 60) return tr("library.minAgo", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return tr("library.hourAgo", { n: h });
  const d = Math.floor(h / 24);
  if (d < 7) return tr("library.dayAgo", { n: d });
  const w = Math.floor(d / 7);
  if (w < 5) return tr("library.weekAgo", { n: w });
  const mo = Math.floor(d / 30);
  return tr("library.monthAgo", { n: mo });
}

// ── queue icon button (header) ─────────────────────────────────────────────
//
// Subscribes to the download queue so the badge reflects in-flight
// jobs in real time. Same visual shape in desktop + mobile headers.

/** Badge count = work the user might want to address. That includes
 *  jobs that were interrupted by the app dying mid-flight — the
 *  Downloads page is where they Retry, so the badge should advertise
 *  it. Done / cancelled / errored without retry intent don't count. */
function activeJobCount(s: { jobs: { status: string }[] }): number {
  let n = 0;
  for (const j of s.jobs) {
    if (
      j.status === "queued" ||
      j.status === "running" ||
      j.status === "interrupted"
    ) {
      n++;
    }
  }
  return n;
}
