import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { Button } from "../Button";
import { NovelDetailView } from "../novel/NovelDetailView";
import { LibrarySidebar } from "../LibrarySidebar";
import { SearchOverlay } from "../SearchOverlay";
import { ShelvesPage, AddTile } from "../ShelvesPage";
import { AnimatedSwap } from "../AnimatedSwap";
import { openStoreSource } from "../../store/uiIntents";
import { Store } from "../Store";
import { booksOnShelf } from "../../store/shelfLogic";
import { FONT_SERIF_DISPLAY, FONT_STACKS } from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { EmptyState, FilteredEmptyState } from "./EmptyState";
import { ErrorBanner } from "./ErrorBanner";
import { HeroContinueCard } from "./HeroContinueCard";
import { LibraryCard } from "./LibraryCard";
import { matchesTab, shelfHeadingFor } from "./tabs";
import type { LayoutProps } from "./types";

export function DesktopLibrary({
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
    ? (shelves.find((s) => s.id === activeShelfId) ?? null)
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
    tab === "all" ? visible.find((b) => b.lastReadAt !== undefined) : undefined;
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
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "32px 40px 40px",
                }}
              >
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
                    <div
                      style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}
                    >
                      {tr(
                        shelfBooks.length === 1
                          ? "shelves.bookCountOne"
                          : "shelves.bookCountOther",
                        { n: shelfBooks.length },
                      )}
                    </div>
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
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
                  <AddTile
                    theme={theme}
                    onClick={() => onAddToShelf(activeShelf.id)}
                  />
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(140px, 1fr))",
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
                        shelfId={activeShelf.id}
                        onOpen={onOpen}
                        onContextMenu={onCardContextMenu}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "32px 40px 40px",
                }}
              >
                {error && <ErrorBanner theme={theme} message={error} />}

                {loading && books.length === 0 ? (
                  <div
                    style={{
                      color: theme.muted,
                      padding: 40,
                      textAlign: "center",
                    }}
                  >
                    {tr("library.loading")}
                  </div>
                ) : books.length === 0 ? (
                  <EmptyState
                    theme={theme}
                    onImport={onImport}
                    importing={importing}
                  />
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
                          {tab === "all"
                            ? tr("library.yourShelf")
                            : shelfHeadingFor(tab, tr)}
                        </h2>
                        <div
                          style={{
                            fontSize: 12,
                            color: theme.muted,
                            marginTop: 2,
                          }}
                        >
                          {tr(
                            others.length === 1
                              ? "library.bookCountOne"
                              : "library.bookCountOther",
                            { n: others.length },
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fill, minmax(140px, 1fr))",
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
                          onOpen={onOpen}
                          onContextMenu={onCardContextMenu}
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
          onOpenStoreSource={(sourceId) => {
            openStoreSource(sourceId);
            setTab("store");
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
