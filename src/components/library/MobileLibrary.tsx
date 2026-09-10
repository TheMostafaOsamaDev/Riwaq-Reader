
import { useLongPress } from "../../hooks/useLongPress";
import { Icon } from "../Icon";
import { BookCover, } from "../BookCover";
import { Button } from "../Button";
import { NovelDetailView } from "../novel/NovelDetailView";
import { ShelvesPage, AddTile } from "../ShelvesPage";
import { AnimatedSwap } from "../AnimatedSwap";
import {
  back,
} from "../../store/navigation";
import { Store } from "../Store";
import {
  booksOnShelf,
} from "../../store/shelfLogic";
import { paletteForId } from "../../store/palette";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  isArabicTitle,
  titleFontFor,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { BackHeader } from "./BackHeader";
import { EmptyState, FilteredEmptyState } from "./EmptyState";
import { ErrorBanner } from "./ErrorBanner";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileShelfCard } from "./MobileShelfCard";
import { MobileTabRow } from "./MobileTabRow";
import { relTime } from "./relTime";
import { matchesTab } from "./tabs";
import type { LayoutProps } from "./types";

export function MobileLibrary({
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
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px 40px" }}>
        {error && <ErrorBanner theme={theme} message={error} />}

        {loading && books.length === 0 ? (
          <div style={{ color: theme.muted, padding: 30, textAlign: "center" }}>
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
