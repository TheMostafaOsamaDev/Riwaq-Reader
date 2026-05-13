import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLongPress } from "../hooks/useLongPress";
import { Icon } from "./Icon";
import { BookCover, BOOK_COVER_DIMS } from "./BookCover";
import { Toast, type ToastMessage } from "./Toast";
import { EditBookModal } from "./EditBookModal";
import { ContextMenu } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "./Button";
import { ImportChoiceModal } from "./ImportChoiceModal";
import { DocxManageView } from "./DocxManageView";
import { DownloadRangeDialog } from "./DownloadRangeDialog";
import { NovelDetailView } from "./NovelDetailView";
import { DownloadQueueView } from "./DownloadQueueView";
import { SettingsSheet } from "./SettingsSheet";
import type { Tweaks } from "../types/reader";
import {
  getState as getQueueState,
  subscribe as subscribeToQueue,
} from "../store/downloadQueue";
import { Store } from "./Store";
import {
  clearLibrary,
  commitStagedDocx,
  coverSrcFor,
  listBooks,
  pickAndImportDocx,
  pickAndImportEpub,
  pickAndImportFolder,
  pickAndStageDocx,
  deleteBook,
  rescanCover,
  setCoverFromFile,
  updateBookMeta,
  updateBookStatus,
  type BookIndexEntry,
  type BookStatus,
} from "../store/library";
import { disposeStaging, type StagedDocx } from "../docx/stage";
import { paletteForId } from "../store/palette";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  isArabicTitle,
  titleFontFor,
  type Theme,
  type ThemeKey,
} from "../styles/tokens";

interface Props {
  theme: Theme;
  /** Selected theme id (one of the THEME_SWATCHES). Threaded through
   *  so the mobile Settings sheet can show which swatch is currently
   *  active and dispatch theme changes without forcing the user
   *  into the reader to find the picker. */
  themeKey: ThemeKey;
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void;
  layout: "desktop" | "mobile";
  onOpen: (bookId: string) => void;
  /** Open the Source streaming reader at a specific novel + chapter. The
   *  Library hands this off to App.tsx, which renders the reader at top
   *  level (covering Library + Store). */
  onStreamRead: (sourceId: string, novelUrl: string, chapterId?: number) => void;
}

function useBooks() {
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { books, covers, loading, error, refresh, setError };
}

export function Library({
  theme,
  themeKey,
  setTweak,
  layout,
  onOpen,
  onStreamRead,
}: Props) {
  const { books, covers, loading, error, refresh, setError } = useBooks();
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastIdRef = useRef(0);
  // Top-level tab — owned here so the Store can be reached from either
  // layout (desktop or mobile) and so the choice persists across layout
  // switches if the window is resized.
  const [tab, setTab] = useState<LibraryTab>("all");
  // Source-backed library entries open their NovelDetailView instead of
  // the reader. That view replaces the shelf body until the user backs
  // out or switches tabs. Holding the state here means the user can
  // pop into the streaming reader (which mounts above us at App
  // level) and come back to the same detail page intact.
  const [sourceDetailView, setSourceDetailView] = useState<{
    sourceId: string;
    novelUrl: string;
    /** Library entry id when the detail view is opened from a shelf
     *  card; the view uses it to load offline data from source.json
     *  and to enqueue per-chapter downloads. Undefined when opened
     *  from the Store before the novel is in the library. */
    libraryEntryId?: string;
  } | null>(null);
  const [sourceDetailRangeDialog, setSourceDetailRangeDialog] = useState<{
    sourceId: string;
    novelUrl: string;
    libraryEntryId?: string;
  } | null>(null);

  // Switching tabs leaves any open source-detail view — the tabs are
  // the natural "exit" affordance, same way the Store tab's internal
  // nav reverts to the sources list when the user re-enters.
  const onTabChange = useCallback((next: LibraryTab) => {
    setTab(next);
    setSourceDetailView(null);
  }, []);

  const showToast = useCallback((kind: ToastMessage["kind"], text: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, kind, text });
  }, []);

  // Card click dispatch. Source-backed entries open their detail page
  // inside this Library; everything else flows through the parent's
  // onOpen and lands in the regular reader. Doing the routing here
  // means callers don't have to know about entry kinds.
  const handleOpen = useCallback(
    (id: string) => {
      const book = books.find((b) => b.id === id);
      if (book?.kind === "source" && book.sourceId && book.novelUrl) {
        setSourceDetailView({
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

  const onImport = async () => {
    if (importing) return;
    setImporting(true);
    setError(null);
    try {
      const entry = await pickAndImportEpub();
      if (entry) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const onClearAll = async () => {
    if (importing) return;
    const n = books.length;
    if (n === 0) {
      showToast("info", "Library is already empty.");
      return;
    }
    if (!confirm(`[dev] Delete all ${n} book${n === 1 ? "" : "s"}? This cannot be undone.`))
      return;
    setImporting(true);
    setError(null);
    try {
      await clearLibrary();
      await refresh();
      showToast("info", `Cleared ${n} book${n === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  // Two-step .docx import flow:
  //   click "Import .docx" → ImportChoiceModal opens
  //     → "Add directly"      → onImportDocxDirect (legacy path)
  //     → "Manage before…"    → onImportDocxStage (opens DocxManageView)
  // `stagedDocx` is the in-memory session for the manage view; while it's
  // non-null the manage overlay renders.
  const [docxChoiceOpen, setDocxChoiceOpen] = useState(false);
  const [stagedDocx, setStagedDocx] = useState<StagedDocx | null>(null);

  const onImportDocx = () => {
    if (importing) return;
    setError(null);
    setDocxChoiceOpen(true);
  };

  const onImportDocxDirect = async () => {
    setDocxChoiceOpen(false);
    if (importing) return;
    setImporting(true);
    setError(null);
    try {
      const entry = await pickAndImportDocx();
      if (entry) {
        await refresh();
        // Toast on success so the user has a persistent confirmation that
        // outlives the import-progress modal's auto-dismiss. Without this,
        // a fast import looked like nothing happened.
        showToast(
          "info",
          `Imported “${entry.title}” — ${entry.chapterCount} chapter${entry.chapterCount === 1 ? "" : "s"}.`,
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Surface failures both inline (red banner) and as a toast — the
      // import-progress modal also shows the error, but it's easy to miss
      // if it's been minimized to the dock.
      console.error("docx import failed:", e);
      setError(message);
      showToast("error", `Import failed: ${message}`);
    } finally {
      setImporting(false);
    }
  };

  const onImportDocxStage = async () => {
    setDocxChoiceOpen(false);
    if (importing) return;
    setImporting(true);
    setError(null);
    try {
      const staged = await pickAndStageDocx();
      if (staged) setStagedDocx(staged);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("docx staging failed:", e);
      setError(message);
      showToast("error", `Couldn't read document: ${message}`);
    } finally {
      setImporting(false);
    }
  };

  const onStagingCancel = useCallback(() => {
    if (stagedDocx) disposeStaging(stagedDocx);
    setStagedDocx(null);
  }, [stagedDocx]);

  const onStagingCommit = useCallback(
    async (
      edits: Parameters<typeof commitStagedDocx>[1],
      meta: Parameters<typeof commitStagedDocx>[2],
    ) => {
      if (!stagedDocx) return;
      try {
        const entry = await commitStagedDocx(stagedDocx, edits, meta);
        // Free blob URLs and close the manage overlay before refreshing
        // the library so the staged-doc memory drops out of the heap
        // before the (potentially large) library list re-renders.
        disposeStaging(stagedDocx);
        setStagedDocx(null);
        await refresh();
        showToast(
          "info",
          `Imported “${entry.title}” — ${entry.chapterCount} chapter${entry.chapterCount === 1 ? "" : "s"}.`,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("docx commit failed:", e);
        showToast("error", `Couldn't add to library: ${message}`);
        // Re-throw so the manage view can render its inline error and
        // re-enable the Add button.
        throw e;
      }
    },
    [refresh, showToast, stagedDocx],
  );

  // Last-ditch cleanup if the component unmounts while a staging session
  // is still alive (rare — usually only on hot-reload during development).
  useEffect(() => {
    return () => {
      if (stagedDocx) disposeStaging(stagedDocx);
    };
  }, [stagedDocx]);

  const onImportFolder = async () => {
    if (importing) return;
    setImporting(true);
    setError(null);
    try {
      const result = await pickAndImportFolder();
      if (!result) return;
      if (result.empty) {
        showToast(
          "warn",
          "That folder has no EPUB files at its top level — can't import an empty folder.",
        );
        return;
      }
      await refresh();
      const n = result.imported.length;
      const skipped = result.errors.length;
      if (skipped > 0) {
        showToast(
          "warn",
          `Imported ${n} book${n === 1 ? "" : "s"}, skipped ${skipped} that couldn't be parsed.`,
        );
      } else {
        showToast(
          "info",
          `Imported ${n} book${n === 1 ? "" : "s"}.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const onDelete = async (id: string) => {
    await deleteBook(id);
    await refresh();
  };

  const onRescanCover = async (id: string) => {
    try {
      const updated = await rescanCover(id);
      if (!updated) {
        setError(
          "Couldn't find a cover in the original EPUB. Try \u201CSet cover\u2026\u201D to pick an image yourself.",
        );
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onSetCover = async (id: string) => {
    try {
      await setCoverFromFile(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Right-click menu on shelf cards. The menu lives at the Library top
  // level so its actions can reach the modal + delete handlers without
  // threading more props through the layout components.
  const [menu, setMenu] = useState<{
    bookId: string;
    x: number;
    y: number;
  } | null>(null);
  const menuBook =
    menu !== null ? books.find((b) => b.id === menu.bookId) : undefined;
  const openContextMenu = (bookId: string, x: number, y: number) =>
    setMenu({ bookId, x, y });
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
      setError(e instanceof Error ? e.message : String(e));
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
  ) => setPendingDelete({ bookId, title, ...opts });
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

  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    books,
    covers,
    loading,
    error,
    importing,
    tab,
    setTab: onTabChange,
    onOpen: handleOpen,
    onImport,
    onImportDocx,
    onImportFolder,
    onStreamRead,
    onSourceImportComplete,
    sourceDetailView,
    onCloseSourceDetailView: () => setSourceDetailView(null),
    onOpenSourceDetailRangeDialog: () => {
      if (sourceDetailView) setSourceDetailRangeDialog(sourceDetailView);
    },
    onOpenQueue: () => setQueueOpen(true),
    onOpenSettings: () => setSettingsOpen(true),
    onClearAll,
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
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          theme={theme}
          title="Remove from library?"
          message={
            <>
              <strong style={{ color: theme.ink }}>
                “{pendingDelete.title}”
              </strong>{" "}
              will be removed from your library, including its reading
              progress. This can't be undone.
            </>
          }
          confirmLabel="Remove"
          cancelLabel="Cancel"
          confirmVariant="destructive"
          onConfirm={performDelete}
          onCancel={cancelDelete}
        />
      )}
      {docxChoiceOpen && (
        <ImportChoiceModal
          theme={theme}
          onDirect={onImportDocxDirect}
          onManage={onImportDocxStage}
          onCancel={() => setDocxChoiceOpen(false)}
        />
      )}
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
      {queueOpen && (
        <DownloadQueueView
          theme={theme}
          layout={layout}
          onClose={() => setQueueOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsSheet
          theme={theme}
          themeKey={themeKey}
          setTweak={setTweak}
          layout={layout}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {stagedDocx && (
        <DocxManageView
          theme={theme}
          layout={layout}
          staged={stagedDocx}
          onCommit={onStagingCommit}
          onCancel={onStagingCancel}
        />
      )}
    </>
  );
}

interface LayoutProps {
  theme: Theme;
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
  onImportDocx: () => void;
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
  onClearAll: () => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onCardContextMenu: (id: string, x: number, y: number) => void;
}

/** "store" is a top-level destination, not a book filter — when the tab
 *  is set to "store" the body swaps out the shelf for the source browser. */
type LibraryTab = "all" | BookStatus | "store";

const TABS: { key: LibraryTab; label: string }[] = [
  { key: "all", label: "Library" },
  { key: "reading", label: "Reading" },
  { key: "finished", label: "Finished" },
  { key: "wishlist", label: "Wishlist" },
  { key: "store", label: "Store" },
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
  books,
  covers,
  loading,
  error,
  importing,
  tab,
  setTab,
  onOpen,
  onImport,
  onImportDocx,
  onImportFolder,
  onStreamRead,
  onSourceImportComplete,
  sourceDetailView,
  onCloseSourceDetailView,
  onOpenSourceDetailRangeDialog,
  onOpenQueue,
  onClearAll,
  onDelete,
  onEdit,
  onCardContextMenu,
}: LayoutProps) {
  const visible = books.filter((b) => matchesTab(b, tab));
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
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "20px 40px",
          borderBottom: `0.5px solid ${theme.rule}`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_SERIF_DISPLAY,
            fontSize: 20,
            fontStyle: "italic",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          Leaflet
        </div>
        <div style={{ display: "flex", gap: 4, marginLeft: 12 }}>
          {TABS.map(({ key, label }) => {
            const active = key === tab;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  border: "none",
                  background: active ? theme.hover : "transparent",
                  color: active ? theme.ink : theme.muted,
                  padding: "6px 12px",
                  borderRadius: 7,
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        {/* Import buttons only make sense in library mode. Store mode is
            self-contained (browse → click → import lives in the Novel
            detail view), so we hide the whole cluster to avoid
            duplicate paths in the header. */}
        {tab !== "store" && (
          <>
            {import.meta.env.DEV && (
              <Button
                theme={theme}
                variant="destructive"
                size="sm"
                onClick={onClearAll}
                disabled={importing}
                title="Dev only — wipes every book from the library"
                leadingIcon={<Icon name="close" size={13} />}
                style={{ marginRight: 8 }}
              >
                Clear all
              </Button>
            )}
            <QueueIconButton theme={theme} onClick={onOpenQueue} />
            <Button
              theme={theme}
              variant="outline"
              size="sm"
              onClick={onImportFolder}
              disabled={importing}
              leadingIcon={<Icon name="folder" size={13} />}
              style={{ marginRight: 8 }}
            >
              Import folder
            </Button>
            <Button
              theme={theme}
              variant="outline"
              size="sm"
              onClick={onImportDocx}
              disabled={importing}
              leadingIcon={<Icon name="doc" size={13} />}
              title="Convert a Word document to EPUB on import"
              style={{ marginRight: 8 }}
            >
              Import .docx
            </Button>
            <Button
              theme={theme}
              variant="primary"
              size="sm"
              onClick={onImport}
              disabled={importing}
              leadingIcon={<Icon name="plus" size={13} />}
            >
              {importing ? "Importing…" : "Import EPUB"}
            </Button>
          </>
        )}
      </div>

      {sourceDetailView ? (
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
          />
        </div>
      ) : tab === "store" ? (
        <Store
          theme={theme}
          layout="desktop"
          onStreamRead={onStreamRead}
          onImportComplete={onSourceImportComplete}
        />
      ) : (
      <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px 40px" }}>
        {error && <ErrorBanner theme={theme} message={error} />}

        {loading && books.length === 0 ? (
          <div style={{ color: theme.muted, padding: 40, textAlign: "center" }}>
            Loading your library…
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
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontSize: 24,
                    margin: 0,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {tab === "all" ? "Your shelf" : shelfHeadingFor(tab)}
                </h2>
                <div
                  style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}
                >
                  {others.length} {others.length === 1 ? "book" : "books"} · sorted by recent
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
  onImportDocx,
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
  // `onClearAll` is only used by the desktop layout; the mobile shell
  // dropped its dev "clear all" button when the top header moved to a
  // bottom nav.
  onClearAll: _onClearAll,
  onCardContextMenu,
}: LayoutProps) {
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
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {/* Top header — title + filter tabs. Hidden inside the source
          detail view (NovelDetailView has its own header with a back
          arrow). The Store tab is omitted from the pills since the
          bottom nav owns Store toggling. Action buttons live in the
          bottom nav, so the right side of the title row is empty. */}
      {!sourceDetailView && (
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
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 28,
              margin: 0,
              letterSpacing: "-0.02em",
              color: theme.ink,
            }}
          >
            Library
          </h1>
          <MobileTabRow theme={theme} tab={tab} setTab={setTab} />
        </div>
      )}

      {sourceDetailView ? (
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
          />
        </div>
      ) : tab === "store" ? (
        <Store
          theme={theme}
          layout="mobile"
          onStreamRead={onStreamRead}
          onImportComplete={onSourceImportComplete}
        />
      ) : (
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px 40px" }}>
        {error && <ErrorBanner theme={theme} message={error} />}

        {loading && books.length === 0 ? (
          <div style={{ color: theme.muted, padding: 30, textAlign: "center" }}>
            Loading…
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
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    {hero.lastReadAt ? "Continue" : "Start reading"}
                  </div>
                  <div
                    style={{
                      fontFamily: titleFontFor(hero.title),
                      fontStyle: isArabicTitle(hero.title) ? "normal" : "italic",
                      fontSize: 18,
                      lineHeight: isArabicTitle(hero.title) ? 1.4 : 1.15,
                      color: theme.ink,
                      letterSpacing: "-0.01em",
                      marginBottom: 4,
                    }}
                  >
                    {hero.title}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: theme.muted,
                      marginBottom: 10,
                    }}
                  >
                    {hero.chapterCount} chapters · {relTime(hero.lastReadAt ?? hero.addedAt)}
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
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 14,
              }}
            >
              Your shelf
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
      {/* Bottom navigation. Hidden while the source detail view owns
          the body (NovelDetailView has its own back-arrow header).
          Visible on the shelf and on the Store so the user always
          has the import + queue + store toggle within thumb reach. */}
      {!sourceDetailView && (
        <MobileBottomNav
          theme={theme}
          importing={importing}
          tab={tab}
          onSetStore={() => setTab(tab === "store" ? "all" : "store")}
          onOpenQueue={onOpenQueue}
          onImport={onImport}
          onImportDocx={onImportDocx}
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
  onSetStore: () => void;
  onOpenQueue: () => void;
  onImport: () => void;
  onImportDocx: () => void;
  onOpenSettings: () => void;
}

/** Bottom nav for the mobile Library shell. Four slots arranged
 *  symmetrically around the central focal "import EPUB" button:
 *
 *    [Store]  [Queue]   ( + )   [Docx]
 *
 *  The "+" button is taller, filled, and slightly elevated so the
 *  primary action is visually obvious. The other three are circular
 *  outlines matching the existing icon-button style.
 *
 *  Visibility: rendered from MobileLibrary when no source-detail
 *  view is open. The bar sits above the Android nav bar / iOS home
 *  indicator by way of the safe-area inset the outer wrapper
 *  already provides.
 */
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
  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

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

  const scrollBy = useCallback((direction: "left" | "right") => {
    const el = scrollerRef.current;
    if (!el) return;
    const step = Math.max(el.clientWidth * 0.7, 120);
    el.scrollBy({
      left: direction === "left" ? -step : step,
      behavior: "smooth",
    });
  }, []);

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
        {items.map(({ key, label }) => {
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
              {label}
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
  return (
    <button
      onClick={onClick}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      aria-label={side === "left" ? "Scroll tabs left" : "Scroll tabs right"}
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
  onSetStore,
  onOpenQueue,
  onImport,
  onImportDocx,
  onOpenSettings,
}: MobileBottomNavProps) {
  return (
    <div
      style={{
        flexShrink: 0,
        position: "relative",
        // Vertical room for the FAB to bulge above the bar without
        // covering shelf content (the body div above is flex:1, so
        // it shrinks to make room here).
        padding: "8px 14px 14px",
        background: theme.bg,
        borderTop: `0.5px solid ${theme.rule}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        gap: 6,
      }}
    >
      <NavIconButton
        theme={theme}
        icon="globe"
        ariaLabel={tab === "store" ? "Back to library" : "Open store"}
        active={tab === "store"}
        onClick={onSetStore}
      />
      <NavIconButton
        theme={theme}
        icon="download"
        ariaLabel="Open downloads"
        onClick={onOpenQueue}
        showQueueBadge
      />
      <NavFabButton
        theme={theme}
        importing={importing}
        onClick={onImport}
      />
      <NavIconButton
        theme={theme}
        icon="doc"
        ariaLabel="Import Word document"
        onClick={onImportDocx}
        disabled={importing}
      />
      <NavIconButton
        theme={theme}
        icon="type"
        ariaLabel="Settings"
        onClick={onOpenSettings}
      />
    </div>
  );
}

interface NavIconButtonProps {
  theme: Theme;
  icon: "globe" | "download" | "doc" | "type";
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
            right: -2,
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
  // The focal action — taller + lifted so it reads as the primary
  // affordance in the bar. The lift is achieved by negative margin
  // bracketed by extra space in the bar wrapper (`padding-top: 8`)
  // so the button protrudes above the bar's top edge.
  return (
    <button
      onClick={onClick}
      disabled={importing}
      aria-label="Import EPUB"
      title={importing ? "Importing…" : "Import EPUB"}
      style={{
        width: 60,
        height: 60,
        borderRadius: 30,
        marginTop: -22,
        border: "none",
        background: theme.ink,
        color: theme.bg,
        cursor: importing ? "progress" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 6px 16px rgba(0,0,0,0.22)",
        opacity: importing ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      <Icon name="plus" size={24} />
    </button>
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
  const longPress = useLongPress(onContextMenu);
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
        // Stretch the cover to the (constrained) cell width — the fixed
        // 110px `sm` size would overflow a 3-column grid on narrow phones.
        fluid
      />
      <div
        style={{
          fontFamily: titleFontFor(book.title),
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
        {book.title}
      </div>
      <div style={{ fontSize: 9.5, color: theme.muted, marginTop: 2 }}>
        {book.author}
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
  const palette = paletteForId(book.id);
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
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          {book.lastReadAt ? "Continue reading" : "Start reading"}
        </div>
        <h1
          title={book.title}
          style={{
            // Arabic / mixed titles use the Readex Pro stack so digits and
            // Latin punctuation interleaved in the title don't fall through
            // to Fraunces and stand out as a different typeface.
            fontFamily: titleFontFor(book.title),
            // Italic only makes sense on Fraunces — suppress it for the
            // Readex Pro path to avoid synthetic italic on Arabic.
            fontStyle: isArabicTitle(book.title) ? "normal" : "italic",
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
          {book.title}
        </h1>
        <div style={{ fontSize: 13, color: theme.muted, marginBottom: 22 }}>
          by {book.author} · {book.chapterCount} chapters
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
              {Math.round(book.progress * 100)}% · {relTime(book.lastReadAt ?? book.addedAt)}
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
              {book.lastReadAt ? "Resume reading →" : "Start reading →"}
            </Button>
            <Button theme={theme} variant="ghost" size="md" onClick={onEdit}>
              Edit details
            </Button>
            <Button
              theme={theme}
              variant="destructiveGhost"
              size="md"
              onClick={onDelete}
            >
              Remove from library
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
          />
          {book.progress === 0 && (
            <span
              aria-label="New — not started yet"
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                padding: "3px 7px",
                borderRadius: 4,
                // Dark blurred pill reads on any cover art without
                // dominating it. Same idiom we use elsewhere for cover-
                // surface overlays.
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontFamily: FONT_STACKS.sans,
                backdropFilter: "blur(6px)",
                pointerEvents: "none",
              }}
            >
              New
            </span>
          )}
        </div>
        <div
          title={book.title}
          style={{
            marginTop: 12,
            fontFamily: titleFontFor(book.title),
            fontSize: 14,
            lineHeight: isArabicTitle(book.title) ? 1.4 : 1.25,
            color: theme.ink,
            letterSpacing: "-0.005em",
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {book.title}
        </div>
        <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
          {book.author}
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
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icon name="check" size={11} /> Finished
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
          fontStyle: "italic",
          fontSize: 28,
          color: theme.ink,
          letterSpacing: "-0.02em",
          marginBottom: 8,
        }}
      >
        Your shelf is empty
      </div>
      <div
        style={{
          fontSize: 13,
          color: theme.muted,
          lineHeight: 1.55,
          marginBottom: 22,
        }}
      >
        Import an EPUB to start reading. Leaflet parses it locally — no
        uploads, no accounts.
      </div>
      <Button
        theme={theme}
        variant="primary"
        size="md"
        onClick={onImport}
        disabled={importing}
        leadingIcon={<Icon name="plus" size={14} />}
      >
        {importing ? "Importing…" : "Import your first EPUB"}
      </Button>
    </div>
  );
}

function shelfHeadingFor(tab: LibraryTab): string {
  // "all" and "store" are handled by the caller before they get here —
  // we keep them in the union so the call site doesn't need a separate
  // narrowing helper.
  if (tab === "reading") return "Currently reading";
  if (tab === "finished") return "Finished";
  if (tab === "wishlist") return "Wishlist";
  return "Shelf";
}

function FilteredEmptyState({
  theme,
  tab,
}: {
  theme: Theme;
  tab: LibraryTab;
}) {
  const message =
    tab === "reading"
      ? "No books marked as reading yet."
      : tab === "finished"
      ? "No finished books yet."
      : tab === "wishlist"
      ? "Nothing on your wishlist yet."
      : "Nothing here.";
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
        Right-click a book to set its status.
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
      <strong style={{ fontWeight: 600 }}>Import failed:</strong> {message}
    </div>
  );
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

// ── queue icon button (header) ─────────────────────────────────────────────
//
// Subscribes to the download queue so the badge reflects in-flight
// jobs in real time. Same visual shape in desktop + mobile headers.

function QueueIconButton({
  theme,
  onClick,
}: {
  theme: Theme;
  onClick: () => void;
}) {
  // Active = queued or running. We don't include terminal jobs in the
  // badge since the user has already seen them.
  const [active, setActive] = useState(() => activeJobCount(getQueueState()));
  useEffect(() => {
    const off = subscribeToQueue((s) => setActive(activeJobCount(s)));
    return off;
  }, []);
  return (
    <button
      onClick={onClick}
      aria-label={
        active === 0
          ? "Open downloads"
          : `Open downloads — ${active} active`
      }
      title="Downloads"
      style={{
        position: "relative",
        width: 36,
        height: 36,
        borderRadius: 18,
        border: `0.5px solid ${theme.rule}`,
        background: "transparent",
        color: theme.ink,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginRight: 8,
      }}
    >
      <Icon name="download" size={16} />
      {active > 0 && (
        <span
          style={{
            position: "absolute",
            top: -3,
            right: -3,
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            borderRadius: 8,
            background: theme.ink,
            color: theme.bg,
            fontSize: 10,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {active > 99 ? "99+" : active}
        </span>
      )}
    </button>
  );
}

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
