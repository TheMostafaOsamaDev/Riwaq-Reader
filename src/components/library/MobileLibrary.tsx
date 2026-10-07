import { Suspense, useState } from "react";
import { SearchOverlay } from "../SearchOverlay";
import { LazyViewFallback } from "../LazyViewFallback";
import { NovelDetailView, Store } from "./lazyViews";
import { Icon } from "../Icon";
import { Button } from "../Button";
import { ShelvesPage, AddTile } from "../ShelvesPage";
import { MobilePageSwap } from "../MobilePageSwap";
import { DownloadQueueView } from "../DownloadQueueView";
import { back, goStorePage, useNav } from "../../store/navigation";
import { booksOnShelf } from "../../store/shelfLogic";
import { FONT_SERIF_DISPLAY, FONT_STACKS, Z } from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { BackHeader } from "./BackHeader";
import { EmptyState, FilteredEmptyState } from "./EmptyState";
import { ErrorBanner } from "./ErrorBanner";
import {
  HOME_BAR_HEIGHT,
  MobileBottomNav,
  NavFabButton,
} from "./MobileBottomNav";
import { glassBar } from "../../reader/chrome/glass";
import {
  homeBarHasImport,
  homeBarHasShelves,
} from "../../reader/chrome/barStyles";
import { MobileShelfCard } from "./MobileShelfCard";
import { HeroContinueCard } from "./HeroContinueCard";
import { MobileTabRow } from "./MobileTabRow";
import { matchesTab } from "./tabs";
import type { LayoutProps } from "./types";

export function MobileLibrary({
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
  storePage,
  onDelete: _onDelete,
  onEdit: _onEdit,
  onCardContextMenu,
  heroStyle,
  homeBar,
  searchOpen,
  onOpenSearch,
  onCloseSearch,
  downloadsTab,
  settingsTab,
  onGoLibrary,
}: LayoutProps) {
  const { tr, locale, dir } = useI18n();
  const glassBottom = glassBar(theme, "bottom");
  const isAr = locale === "ar";
  // Single-shelf detail page (Task 10) — see DesktopLibrary for the same
  // computation. Resolves the nav view's shelfId (threaded down as
  // `activeShelfId`) against the live shelf list.
  const activeShelf = activeShelfId
    ? (shelves.find((s) => s.id === activeShelfId) ?? null)
    : null;
  const shelfBooks = activeShelf ? booksOnShelf(books, activeShelf.id) : [];
  // Filter to the selected status tab. "store" is handled separately
  // (a body swap, not a filter); the tab pills exclude it on mobile
  // because Store toggling lives in the bottom nav.
  // The text the search's "filter the shelf" action narrowed the library
  // to, exactly as on desktop. Shown as a chip above the books so it can be
  // seen and cleared: on a phone there is no sidebar to hint that a filter
  // is on, and a library that silently shows two books reads as lost books.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = books
    .filter((b) => matchesTab(b, tab))
    .filter(
      (b) =>
        !q ||
        b.title.toLowerCase().includes(q) ||
        (b.author ?? "").toLowerCase().includes(q),
    );
  // Hero is the "continue reading" affordance — only meaningful on the
  // full library view. On a filtered tab we render a flat shelf so every
  // match is equally weighted.
  const hero =
    tab === "all" ? visible.find((b) => b.lastReadAt !== undefined) : undefined;
  const others = hero ? visible.filter((b) => b.id !== hero.id) : visible;

  // Which page the body shows, and which tab it belongs to.
  const nav = useNav();
  const pageKey = settingsTab
    ? `settings:${nav.snapshot.base.screen === "settings" ? (nav.snapshot.base.category ?? "") : ""}`
    : downloadsTab
      ? "downloads"
      : activeShelf
        ? `shelf:${activeShelf.id}`
        : shelvesActive
          ? "shelves"
          : sourceDetailView
            ? `novel:${sourceDetailView.libraryEntryId ?? sourceDetailView.novelUrl}`
            : tab === "store"
              ? "store"
              : `tab:${tab}`;
  const pageGroup = settingsTab
    ? "settings"
    : downloadsTab
      ? "downloads"
      : tab === "store" && !activeShelf && !shelvesActive && !sourceDetailView
        ? "store"
        : "library";
  /** The tab the bottom bar marks as current. */
  const currentTab = settingsTab
    ? "settings"
    : downloadsTab
      ? "downloads"
      : pageGroup === "store"
        ? "store"
        : "library";

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
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
        position: "relative",
        // No bottom inset here: the bottom bar floats over the pages on
        // frosted glass that runs to the screen's edge, so the pages run
        // under it too. Each page's scroller adds this much room at its end
        // instead, so its last row can scroll up clear of the bar — the
        // bar's height plus the gesture area, or just the gesture area when
        // the bar is away (a novel's page).
        ["--home-bar-inset" as string]: sourceDetailView
          ? "env(safe-area-inset-bottom, 0px)"
          : `calc(${HOME_BAR_HEIGHT + 12}px + env(safe-area-inset-bottom, 0px))`,
      }}
    >
      {/* The body: one page at a time. Tabs (Library, Store, Downloads,
          Settings) fade through; within a tab, going deeper slides in from
          the side and going back slides out again, following the navigation
          history — see MobilePageSwap. */}
      <MobilePageSwap
        viewKey={pageKey}
        group={pageGroup}
        move={nav.move}
        rtl={dir === "rtl"}
        fade={(from, to) => from.startsWith("tab:") && to.startsWith("tab:")}
      >
        {settingsTab ? (
          settingsTab
        ) : downloadsTab ? (
          <DownloadQueueView
            theme={theme}
            layout="mobile"
            asTab
            onClose={() => back()}
          />
        ) : shelvesActive ? (
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
            <Suspense fallback={<LazyViewFallback background={theme.bg} />}>
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
            </Suspense>
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
            {/* No header of its own: the Store is a tab, and each of its
                  pages brings the one header it needs — a title on the
                  root, a back arrow below it. */}
            <Suspense fallback={<LazyViewFallback background={theme.bg} />}>
              <Store
                theme={theme}
                layout="mobile"
                page={storePage}
                onStreamRead={onStreamRead}
                onImportComplete={onSourceImportComplete}
              />
            </Suspense>
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
            <BackHeader
              theme={theme}
              title={activeShelf.name}
              onBack={() => back()}
            />
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px 22px 40px",
                paddingBottom: `calc(40px + var(--home-bar-inset, 0px))`,
              }}
            >
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
                  <div
                    style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}
                  >
                    {tr(
                      shelfBooks.length === 1
                        ? "shelves.bookCountOne"
                        : "shelves.bookCountOther",
                      { n: shelfBooks.length },
                    )}
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
                <AddTile
                  theme={theme}
                  onClick={() => onAddToShelf(activeShelf.id)}
                />
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
                      shelfId={activeShelf.id}
                      onOpen={onOpen}
                      onContextMenu={onCardContextMenu}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Title, actions and filters: part of the library's page, so
                  they move with it rather than popping in over another tab. */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "16px 22px 10px",
                borderBottom: `0.5px solid ${theme.rule}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h1
                  style={{
                    flex: 1,
                    minWidth: 0,
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
                {/* Shelves, for the bar styles that have no button for it.
                  Here rather than at the end of the filter pills, where it
                  scrolled out of sight behind the row's arrow. */}
                {!homeBarHasShelves(homeBar) && (
                  <HeaderIconButton
                    theme={theme}
                    icon="layers"
                    label={tr("shelves.title")}
                    onClick={onOpenShelves}
                  />
                )}
                {/* Search, as on desktop: the same overlay as the sidebar's
                  search and ⌘K, with books, recent searches and shortcuts. */}
                <HeaderIconButton
                  theme={theme}
                  icon="search"
                  label={tr("sidebar.searchLibrary")}
                  onClick={onOpenSearch}
                />
                {/* The bar styles without an import button put it here, beside
                  the title, where Android apps put "add". */}
                {!homeBarHasImport(homeBar) && (
                  <NavFabButton
                    theme={theme}
                    importing={importing}
                    onClick={onImport}
                    size={40}
                  />
                )}
              </div>
              <MobileTabRow theme={theme} tab={tab} setTab={setTab} />
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px 22px 40px",
                // Room to scroll the last row up clear of the floating bar.
                paddingBottom: `calc(40px + var(--home-bar-inset, 0px))`,
              }}
            >
              {error && <ErrorBanner theme={theme} message={error} />}

              {q && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 16,
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 0,
                      paddingBlock: 6,
                      paddingInlineStart: 12,
                      paddingInlineEnd: 6,
                      borderRadius: 18,
                      background: theme.hover,
                      border: `0.5px solid ${theme.rule}`,
                      fontSize: 12.5,
                      color: theme.ink,
                    }}
                  >
                    <Icon name="search" size={13} />
                    <span
                      style={{
                        minWidth: 0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {tr("library.filterChip", { term: query.trim() })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label={tr("library.clearFilter")}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        border: "none",
                        background: "transparent",
                        color: theme.muted,
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </span>
                </div>
              )}

              {loading && books.length === 0 ? (
                <div
                  style={{
                    color: theme.muted,
                    padding: 30,
                    textAlign: "center",
                  }}
                >
                  {tr("library.loadingShort")}
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
                      layout="mobile"
                      variant={heroStyle}
                      book={hero}
                      books={visible}
                      covers={covers}
                      onOpen={onOpen}
                      onMenu={onCardContextMenu}
                    />
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
                        onOpen={onOpen}
                        onContextMenu={onCardContextMenu}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </MobilePageSwap>
      {/* Bottom navigation. Hidden while the source detail view owns
          the body (NovelDetailView has its own back-arrow header).
          Visible on the shelf and on the Store so the user always
          has the import + queue + store toggle within thumb reach. */}
      {!sourceDetailView && (
        <div
          className={homeBar === "dock" ? undefined : glassBottom.className}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: Z.homeBar,
            // The bar sits above the gesture area; the glass runs on under
            // it to the screen's edge.
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            paddingLeft: "env(safe-area-inset-left, 0px)",
            paddingRight: "env(safe-area-inset-right, 0px)",
            // The dock is a pill floating on clear space; every other style
            // is one full-width sheet of the reader's frosted glass.
            ...(homeBar === "dock" ? null : glassBottom.style),
          }}
        >
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
            style={homeBar}
            current={currentTab}
            onGoLibrary={onGoLibrary}
          />
        </div>
      )}
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
          onOpenStoreSource={(sourceId) =>
            goStorePage({ kind: "source", sourceId })
          }
          onClose={onCloseSearch}
          layout="mobile"
        />
      )}
    </div>
  );
}

/** A round, outlined button beside the "Library" title. */
function HeaderIconButton({
  theme,
  icon,
  label,
  onClick,
}: {
  theme: LayoutProps["theme"];
  icon: "search" | "layers";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        flexShrink: 0,
        border: `0.5px solid ${theme.rule}`,
        background: "transparent",
        color: theme.ink,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
      }}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}
