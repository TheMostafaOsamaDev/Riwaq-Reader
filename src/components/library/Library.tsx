// The library's stateful shell. It owns the book list, every dialog and menu,
// and the import flow, then hands a single `LayoutProps` bundle to whichever
// layout the platform calls for. Everything it renders lives beside it:
//
//   DesktopLibrary / MobileLibrary   the two layout shells
//   LibraryCard / MobileShelfCard    grid cards, both memoized
//   HeroContinueCard                 the "keep reading" card
//   BackHeader, MobileTabRow,
//   MobileBottomNav                  mobile chrome
//   EmptyState, ErrorBanner          the states that are not a grid
//   cardChrome                       what both cards share
//   tabs, types, relTime             no JSX, safe to import anywhere
//
// This file was 3,601 lines holding all fourteen. Nothing about them changed
// in the split; they were already cleanly separated, which is why it was worth
// doing before the file grew again.

import { useCallback, useEffect, useRef, useState } from "react";
import { Toast, type ToastMessage } from "../Toast";
import { EditBookModal } from "../EditBookModal";
import { ContextMenu } from "../ContextMenu";
import { ConfirmDialog } from "../ConfirmDialog";
import { DownloadRangeDialog } from "../DownloadRangeDialog";
import { DownloadQueueView } from "../DownloadQueueView";
import { NewShelfDialog } from "../NewShelfDialog";
import { AddToShelfMenu } from "../AddToShelfMenu";
import { AddToShelfDialog } from "../AddToShelfDialog";
import { AnimatedDialog } from "../AnimatedDialog";
import { AnimatedFullScreen } from "../AnimatedFullScreen";
import { onOpenDownloadQueue, } from "../../store/uiIntents";
import {
  useNav,
  goLibrary,
  goShelf,
  openOverlay,
  back,
  type LibraryView,
} from "../../store/navigation";
import {
  getState as getQueueState,
  subscribe as subscribeToQueue,
} from "../../store/downloadQueue";
import {
  createImportReporter,
  failImportRun,
  finishImportRun,
} from "../../store/importReporter";
import {
  coverSrcFor,
  importPaths,
  listBooks,
  pickBooksForImport,
  pickFolderForImport,
  readImageFile,
  deleteBook,
  rescanCover,
  setCoverFromFile,
  updateBookMeta,
  updateBookStatus,
  addBookToShelf,
  removeBookFromShelf,
  type BookIndexEntry,
  type BookStatus,
  type ImportReporter,
  type StagedPick,
} from "../../store/library";
import {
  hasIncoming,
  onIncoming,
  takeIncoming,
} from "../../store/incomingFiles";
import {
  listShelves,
  createShelf as createShelfStore,
  renameShelf as renameShelfStore,
  deleteShelf as deleteShelfStore,
  type Shelf,
} from "../../store/shelves";
import {
  isOnShelf,
  wouldOrphan,
} from "../../store/shelfLogic";
import { ImportDetailsDialog } from "../ImportDetailsDialog";
import type { CoverChoice, FixedImportDraft } from "../../store/fixedImportStage";
import {
  type Theme,
  type ThemeKey,
  Z,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { errorLabel } from "../../i18n/statusLabels";
import { DesktopLibrary } from "./DesktopLibrary";
import { MobileLibrary } from "./MobileLibrary";
import type { LibraryTab } from "./tabs";

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
  // 0..1 across the whole pick, or null while we're still waiting on the
  // file dialog (nothing to measure yet). Drives the determinate ring in
  // the import button; the Android notification reads the same numbers via
  // the shared import-progress store.
  const [importQueue, setImportQueue] = useState<FixedImportDraft[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [qBusy, setQBusy] = useState(false);
  const importStats = useRef<{
    imported: number;
    errors: string[];
    reused: number;
  }>({
    imported: 0,
    errors: [],
    reused: 0,
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
  //
  // `reusedIds` covers the book the user already owned: hash-dedupe means
  // beginImport reports it under `reused` rather than importing it, so it
  // was already in the library BEFORE this run started and would never
  // show up in the `before`/`after` diff below. Without tracking it
  // separately, "Add to shelf → From device" on a book you already own
  // silently drops the shelf assignment — your explicit pick does nothing.
  const pendingShelfImportRef = useRef<{
    shelfId: string;
    before: Set<string>;
    reusedIds: string[];
  } | null>(null);
  // Set by beginImport when a file opened from outside (Open with,
  // Android share, drag-drop) resolved to exactly one PDF/DOCX draft — the
  // EPUB case opens immediately, but a fixed-layout book still needs the
  // title/cover dialog before there's a book to open. onQConfirm/onQSkip/
  // onQSkipRest read this once their (necessarily single) draft commits,
  // and open the reader instead of returning to the library summary.
  // Reset to false at the very top of every beginImport call and cleared
  // again the moment the queue resolves, so a stale true can never hijack
  // an unrelated later import into the reader.
  const openAfterQueueRef = useRef(false);
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

  // Shelves (custom collections) — store-backed (riwaq/shelves.json),
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
  // Uses the race-safe delta mutator (see store/library.ts) rather than
  // computing an absolute shelfIds list from the `books` snapshot — two
  // handlers racing on the same book (e.g. rapid picker + undo) would
  // otherwise both read stale membership and the second write could
  // silently drop the first's change.
  const onAddBooksToShelf = useCallback(
    async (shelfId: string, bookIds: string[]) => {
      for (const bookId of bookIds) {
        await addBookToShelf(bookId, shelfId);
      }
      await refresh();
    },
    [refresh],
  );
  // Single-book shelf membership toggle for the detail page's "Shelves"
  // checklist (Task 13). Pure membership editing — flips one shelf's
  // membership for one book and nothing else; it never deletes the book,
  // even when this empties its shelf list (unlike the shelf-page "remove"
  // flow, which prompts to keep an orphaned book in the library).
  //
  // Decides add-vs-remove from the current (possibly momentarily stale)
  // `books` snapshot, then hands off to a delta mutator that re-reads the
  // index fresh before writing — so rapid successive toggles on this same
  // checklist can't clobber each other the way an absolute-list write
  // would (see FIX 1 / store/library.ts).
  const onToggleBookShelf = useCallback(
    async (bookId: string, shelfId: string) => {
      const book = books.find((b) => b.id === bookId);
      const isOn = isOnShelf(book?.shelfIds, shelfId);
      await (isOn ? removeBookFromShelf : addBookToShelf)(bookId, shelfId);
      await refresh();
    },
    [books, refresh],
  );
  // Smart remove-from-shelf (Task 14): unconditionally writes the
  // membership change. Shared by the non-orphan (silent + undo) path and
  // the orphan dialog's "Keep in library" cancel action.
  const doUnshelve = useCallback(
    async (bookId: string, shelfId: string) => {
      await removeBookFromShelf(bookId, shelfId);
      await refresh();
    },
    [refresh],
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
    // Union with reusedIds: a hash-dedupe match was already in `before`
    // (it's an existing book), so the diff above can never surface it —
    // without folding it in here, picking an already-owned book from
    // "From device" would silently do nothing to the shelf.
    const ids = Array.from(new Set([...newIds, ...pending.reusedIds]));
    if (ids.length === 0) return;
    await onAddBooksToShelf(pending.shelfId, ids);
    const name = shelves.find((s) => s.id === pending.shelfId)?.name ?? "";
    showToast("info", tr("shelves.addedToast", { n: ids.length, shelf: name }));
  };

  const summarizeImport = () => {
    setImportQueue([]);
    setQIndex(0);
    const { imported, errors, reused } = importStats.current;
    // One toast, not two. A duplicate-file notice and the import-result
    // notice used to be two separate showToast calls with no await between
    // them — same synchronous continuation, so React batched both setState
    // calls and only the second ever painted. Any pick with both a new book
    // and a duplicate silently lost the duplicate notice. Building both
    // fragments first and joining them (the same "· "-joined-parts idiom
    // status.notif.mixedBody uses) means a mixed batch reports both.
    const parts: string[] = [];
    if (imported > 0 && errors.length > 0) {
      parts.push(
        tr(
          imported === 1
            ? "status.importedFolderSkippedOne"
            : "status.importedFolderSkippedOther",
          { n: imported, skipped: errors.length },
        ),
      );
    } else if (imported > 1) {
      parts.push(tr("status.importedFolderOther", { n: imported }));
    } else if (imported === 0 && errors.length > 0) {
      setError(errorLabel(errors[0], tr));
    }
    if (reused > 0) {
      parts.push(
        tr(
          reused === 1
            ? "status.alreadyInLibraryOne"
            : "status.alreadyInLibraryOther",
          { n: reused },
        ),
      );
    }
    if (parts.length > 0) {
      showToast(
        imported > 0 && errors.length > 0 ? "warn" : "info",
        parts.join(" · "),
      );
    }
    // Fire-and-forget: a pending shelf assignment (device import started via
    // AddToShelfMenu) resolves after its own listBooks() round-trip, whose
    // toast then supersedes whichever message was just shown above.
    void finishPendingShelfImport();
  };

  const advanceQueue = async (
    draft: FixedImportDraft,
    didImport: boolean,
    committedId?: string,
  ) => {
    if (didImport) importStats.current.imported += 1;
    draft.dispose();
    const next = qIndex + 1;
    if (next >= importQueue.length) {
      await refresh();
      // A single PDF/DOCX opened from outside: land in the reader now that
      // the draft has resolved into a real book, mirroring the immediate
      // EPUB path in beginImport. A cancelled draft never commits, so
      // committedId is undefined here and this falls through to the normal
      // summary — nothing opens.
      const openId = openAfterQueueRef.current ? committedId : undefined;
      openAfterQueueRef.current = false;
      if (openId) {
        setImportQueue([]);
        setQIndex(0);
        onOpen(openId);
        return;
      }
      summarizeImport();
    } else {
      setQIndex(next);
    }
  };

  const beginImport = async (
    res: StagedPick | null,
    opts?: { openWhenSingle?: boolean },
  ) => {
    // Reset first, unconditionally. Every return path below — including
    // "nothing picked" and "single result, opened immediately" — must leave
    // this false, or a stale true would hijack a later, unrelated import's
    // draft queue straight into the reader.
    openAfterQueueRef.current = false;
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
    const reused = res.reused ?? [];
    // A pending shelf assignment needs the reused ids too — see the
    // pendingShelfImportRef doc comment for why the before/after diff in
    // finishPendingShelfImport can't see them on its own.
    if (pendingShelfImportRef.current) {
      pendingShelfImportRef.current.reusedIds.push(
        ...reused.map((b) => b.id),
      );
    }
    importStats.current = {
      imported: res.autoImported.length,
      errors: res.errors.map((e) => e.message),
      reused: reused.length,
    };
    // `pruned` counts as an import too: the run dropped a library entry whose
    // files were gone (see stagePaths). On the path where the replacement
    // import then failed there is nothing imported and nothing reused to
    // refresh on, and the dead book's card would sit there until some other
    // reload — tapping it would open an id the index no longer has.
    if (res.autoImported.length > 0 || (res.pruned?.length ?? 0) > 0) {
      await refresh();
    }
    // A file opened from outside meant "read this". Land the user in the
    // reader — but only when there's exactly one book to land on. A
    // multi-file drop has no defensible choice, so it stays in the library
    // and reports through the usual import summary. The "already in
    // library" note itself is reported from summarizeImport, not here —
    // firing it here raced with summarizeImport's own toast whenever the
    // same batch also had something to say about it (see summarizeImport).
    if (reused.length > 0) await refresh();
    const single =
      res.autoImported.length + reused.length === 1 && res.drafts.length === 0
        ? (res.autoImported[0] ?? reused[0])
        : null;
    if (opts?.openWhenSingle && single) {
      // A duplicate opened from outside still deserves the "already in
      // your library" note before landing in the reader. Safe to fire
      // directly here, unlike the batch case above: this is provably the
      // only showToast call this run makes before returning, so there's no
      // second call in the same tick to race with (summarizeImport, where
      // that race lives, is never reached on this path).
      if (reused.length === 1) {
        showToast("info", tr("status.alreadyInLibraryOne", { n: 1 }));
      }
      onOpen(single.id);
      return;
    }
    // A single PDF/DOCX opened from outside still needs the title/cover
    // dialog before there's anything to open — the design calls for the
    // reader to open "on confirm", not immediately like EPUB. Stash the
    // intent; onQConfirm/onQSkip/onQSkipRest capture the committed book's
    // id once the (necessarily single, per this condition) draft resolves,
    // and open the reader instead of returning to the library summary. A
    // cancelled dialog never commits, so nothing opens and the ref just
    // gets cleared (see advanceQueue / onQSkipRest).
    if (
      opts?.openWhenSingle &&
      res.drafts.length === 1 &&
      res.autoImported.length === 0 &&
      reused.length === 0
    ) {
      openAfterQueueRef.current = true;
    }
    if (res.drafts.length > 0) {
      setQIndex(0);
      setImportQueue(res.drafts);
    } else {
      summarizeImport();
    }
  };

  /**
   * Progress plumbing for one import run: a reporter to hand the pipeline,
   * plus the two terminal calls.
   *
   * The real reporter is created lazily, on the first file. Creating it marks
   * an import "active" — which lights up the Android notification — and the
   * file dialog can sit open for as long as the user cares to browse, so
   * nothing should look busy until they've actually chosen something. If they
   * cancel, no reporter is ever made and `finish`/`fail` are no-ops.
   */
  const importRunner = () => {
    let reporter: ImportReporter | undefined;
    const start = () =>
      (reporter ??= createImportReporter(tr("sidebar.importing")));
    return {
      reporter: {
        file: (i, total, name) => start().file(i, total, name),
        phase: (p) => reporter?.phase(p),
        parseProgress: (r) => reporter?.parseProgress(r),
        progress: (p) => reporter?.progress(p),
      } satisfies ImportReporter,
      finish: () => reporter && finishImportRun(null),
      fail: (message: string) => reporter && failImportRun(message),
    };
  };

  /** Run one import. `source` supplies the paths — a picker prompt, or a
   *  list that arrived from outside the app. */
  const runImport = async (
    source: (report: ImportReporter) => Promise<StagedPick | null>,
    opts?: { openWhenSingle?: boolean },
  ) => {
    if (importing || importQueue.length > 0) return;
    setImporting(true);
    setError(null);
    const run = importRunner();
    try {
      const res = await source(run.reporter);
      await beginImport(res, opts);
      run.finish();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      run.fail(message);
      setError(errorLabel(message, tr));
      // The pick/import blew up before beginImport could run its own
      // cleanup — same reasoning as beginImport's `!res` branch above.
      pendingShelfImportRef.current = null;
    } finally {
      setImporting(false);
    }
  };

  const onImport = () => runImport((report) => pickBooksForImport(report));

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
      reusedIds: [],
    };
    await onImport();
  };

  const onImportFolder = async () => {
    if (importing || importQueue.length > 0) return;
    setImporting(true);
    setError(null);
    const run = importRunner();
    try {
      await beginImport(await pickFolderForImport(run.reporter));
      run.finish();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      run.fail(message);
      setError(errorLabel(message, tr));
    } finally {
      setImporting(false);
    }
  };

  const onQConfirm = async (title: string, cover: CoverChoice) => {
    const d = importQueue[qIndex];
    if (!d || qBusy) return;
    setQBusy(true);
    try {
      const entry = await d.commit({ title, cover });
      await advanceQueue(d, true, entry.id);
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
      const entry = await d.commit({
        title: d.title,
        cover: draftDefaultCover(d),
      });
      await advanceQueue(d, true, entry.id);
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
      // Tracks the last successfully committed draft's id. Only read below
      // when openAfterQueueRef is set, and that's only ever true for a
      // single-draft queue (see beginImport) — so this loop runs once and
      // lastCommittedId is that one draft's id, or undefined if it failed.
      let lastCommittedId: string | undefined;
      for (let i = qIndex; i < importQueue.length; i++) {
        const d = importQueue[i];
        try {
          const entry = await d.commit({
            title: d.title,
            cover: draftDefaultCover(d),
          });
          importStats.current.imported += 1;
          lastCommittedId = entry.id;
        } catch (e) {
          importStats.current.errors.push(
            e instanceof Error ? e.message : String(e),
          );
        }
        d.dispose();
      }
      await refresh();
      // Mirrors advanceQueue's single-draft "opened from outside" landing.
      const openId = openAfterQueueRef.current ? lastCommittedId : undefined;
      openAfterQueueRef.current = false;
      if (openId) {
        setImportQueue([]);
        setQIndex(0);
        onOpen(openId);
        return;
      }
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
  // Stable identity: it reaches every memoized library card, and a fresh
  // arrow per render would make the memo a no-op.
  const openContextMenu = useCallback(
    (bookId: string, x: number, y: number, shelfId?: string) =>
      setMenu({ bookId, x, y, shelfId }),
    [],
  );
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
  // `riwaq.open=queue`, the pub/sub fires and we push the queue overlay onto
  // nav history (so the hardware/desktop Back closes it).
  useEffect(
    () => onOpenDownloadQueue(() => openOverlay({ kind: "downloads" })),
    [],
  );

  // Files handed to us from outside (Open with, Android share, drag-drop).
  // They queue in the store because this component unmounts behind the
  // reader — draining on mount is what makes a drop mid-chapter survive.
  //
  // Genuinely queue, silently, while an import is already running — no
  // toast. The drop/arrival was already acknowledged by the overlay (see
  // store/dropOverlay.ts), so there is nothing left to say here; leave the
  // paths in the incoming-files store rather than taking them. This effect
  // resubscribes whenever `importing` or `importQueue.length` changes, so
  // the retry happens automatically the moment the current run finishes —
  // no need to schedule anything ourselves.
  useEffect(() => {
    const drain = () => {
      if (!hasIncoming()) return;
      if (importing || importQueue.length > 0) return;
      const paths = takeIncoming();
      void runImport((report) => importPaths(paths, report), {
        openWhenSingle: true,
      });
    };
    drain();
    return onIncoming(drain);
  }, [importing, importQueue.length]);

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
          exists. Stacking: these dialogs open from a menu, so they ride
          `Z.menu`/`Z.menuDialog`, above EditBookModal's `Z.modal`; the
          full-screen wrapper sits at `Z.dialog`, on top of the shelf. */}
      <AnimatedDialog
        open={pendingDelete !== null}
        onScrimClick={cancelDelete}
        zIndex={Z.menu}
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
        zIndex={Z.menu}
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
        zIndex={Z.menu}
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
      <DownloadRangeDialog
        theme={theme}
        layout={layout}
        open={sourceDetailRangeDialog !== null}
        sourceId={sourceDetailRangeDialog?.sourceId}
        novelUrl={sourceDetailRangeDialog?.novelUrl}
        libraryEntryId={sourceDetailRangeDialog?.libraryEntryId}
        onCancel={() => setSourceDetailRangeDialog(null)}
        onStarted={() => setSourceDetailRangeDialog(null)}
        onCompleted={() => void refresh()}
      />
      {/* Add-to-shelf picker (Task 12) — same tier as the confirm dialogs
          above; mutually exclusive with them (only opens once the
          from-library choice is made in AddToShelfMenu below). */}
      <AnimatedDialog
        open={pickerShelf !== null}
        onScrimClick={() => setPickerShelf(null)}
        zIndex={Z.menu}
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
        zIndex={Z.dialog}
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
