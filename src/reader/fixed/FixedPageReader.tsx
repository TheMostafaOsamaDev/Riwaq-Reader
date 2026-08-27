// The shared reader shell for fixed-layout books (PDF / DOCX): the same chrome
// + panels as the EPUB readers (Contents / Bookmarks / Progress / Settings via
// PanelShell, the shared SettingsSection primitives), with a FixedPageViewer in
// the center instead of reflowable text. Only the center differs by format; the
// shell is identical. The page source is created via a `createSource` factory
// so this component is agnostic to disk-vs-bytes loading (App passes a disk
// source; the dev harness passes an in-memory one).
//
// Panel presentation matches the EPUB readers exactly: desktop slides a
// SideSheet in over the viewer, mobile raises the same MobileSheet bottom
// sheet the reflow reader uses (drag handle, snap points, drag-to-dismiss).
// Both readers therefore share one panel surface AND one settings body
// (panels/SettingsPanel.tsx) — see its `variant` prop.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ACCENT,
  FONT_SERIF_DISPLAY,
  titleFontFor,
  type HighlightColor,
  type Theme,
  type ThemeKey,
} from "../../styles/tokens";
import { useReducedMotion } from "../../styles/motion";
import type { Tweaks, TocEntry } from "../../types/reader";
import type {
  BookState,
  DocxHighlightAnchor,
  FixedBook,
  Highlight,
  PdfHighlightAnchor,
} from "../../store/library";
import type { FixedPageSource } from "./FixedPageSource";
import { FixedPageViewer, type FixedPageViewerHandle } from "./FixedPageViewer";
import { PanelShell } from "../../panels/PanelShell";
import { HighlightsPanel } from "../../panels/HighlightsPanel";
import { SelectionPopover } from "../../components/SelectionPopover";
import { HighlightActionPopover } from "../../components/HighlightActionPopover";
import type { DocxSelectionAnchor } from "./docxHighlight";
import { SideSheet } from "../../components/SideSheet";
import { MobileSheet } from "../../components/MobileSheet";
import { ReaderTopBar } from "../chrome/ReaderTopBar";
import { ReaderScrubBar } from "../chrome/ReaderScrubBar";
import { ReaderIconButton } from "../chrome/ReaderIconButton";
import { SettingsPanel } from "../../panels/SettingsPanel";
import { useI18n } from "../../i18n/useI18n";
import { formatNum } from "../../i18n";

type SetTweak = <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
type Panel = null | "toc" | "highlights" | "progress" | "settings";

/** A highlight the fixed reader asks App to persist: colour + note + the
 *  fixed-layout anchor. App fills the unused reflow fields (chapter/paragraph/
 *  char) with 0. */
export interface NewFixedHighlight {
  text: string;
  color: HighlightColor;
  note?: string;
  groupId?: string;
  fixed: DocxHighlightAnchor | PdfHighlightAnchor;
}

export interface FixedPageReaderProps {
  theme: Theme;
  themeKey: ThemeKey;
  t: Tweaks;
  setTweak: SetTweak;
  book: FixedBook;
  state: BookState;
  /** This book's highlights (fixed-layout, carrying a `fixed` anchor). */
  highlights: Highlight[];
  onCreateHighlight: (h: NewFixedHighlight) => void;
  onDeleteHighlight: (highlightId: string) => void;
  onUpdateHighlightNote: (highlightId: string, note: string) => void;
  layout: "mobile" | "desktop";
  /** Chrome (UI) direction — follows the app language. */
  uiDir: "ltr" | "rtl";
  /** Build the page source (PDF from disk, DOCX from disk, or bytes in tests). */
  createSource: () => Promise<FixedPageSource>;
  /** Persist the reading position (debounced upstream in App). `pageCount` is
   *  the source's total — needed for docx, whose count is only known after
   *  pagination at read time. */
  onLocationChange?: (page: number, pageOffset: number, pageCount: number) => void;
  onOpenFullSettings?: () => void;
  onBack: () => void;
}

export function FixedPageReader(props: FixedPageReaderProps) {
  const {
    theme,
    themeKey,
    t,
    setTweak,
    book,
    state,
    highlights,
    onCreateHighlight,
    onDeleteHighlight,
    onUpdateHighlightNote,
    layout,
    uiDir,
    createSource,
    onLocationChange,
    onOpenFullSettings,
    onBack,
  } = props;
  const { tr, locale } = useI18n();
  const reduced = useReducedMotion();
  const isMobile = layout === "mobile";

  const [source, setSource] = useState<FixedPageSource | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [zoom, setZoom] = useState(1);
  const [progress, setProgress] = useState<{ page: number; fraction: number; label: string }>(
    () => ({ page: state.currentPage ?? 0, fraction: 0, label: "" }),
  );
  const viewerRef = useRef<FixedPageViewerHandle>(null);

  // Highlighting popovers: `sel` drives the create-color popover after a text
  // selection; `activeHl` drives the edit/delete popover after clicking a mark.
  const [sel, setSel] = useState<DocxSelectionAnchor | null>(null);
  const [activeHl, setActiveHl] = useState<{ id: string; rect: DOMRect } | null>(null);

  const createFromSelection = (color: HighlightColor, note?: string) => {
    if (!sel) return;
    onCreateHighlight({
      text: sel.text,
      color,
      note,
      fixed: {
        fmt: "docx",
        blockId: sel.blockId,
        charStart: sel.charStart,
        charEnd: sel.charEnd,
      },
    });
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  // Content/page-flip direction: DOCX carries its own; PDF follows the UI.
  const contentDir = book.kind === "docx" ? book.dir : uiDir;

  // Create + own the page source lifecycle.
  useEffect(() => {
    let live = true;
    let created: FixedPageSource | null = null;
    void createSource().then((s) => {
      if (!live) {
        s.destroy();
        return;
      }
      created = s;
      setSource(s);
    });
    return () => {
      live = false;
      created?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const fmt = useCallback(
    (n: number) => formatNum(n, locale),
    [locale],
  );
  const formatCounter = useCallback(
    (page1: number, total: number) => `${fmt(page1)} / ${fmt(total)}`,
    [fmt],
  );

  const resume = useMemo(
    () => ({ page: state.currentPage ?? 0, pageOffset: state.pageOffset ?? 0 }),
    [state.currentPage, state.pageOffset],
  );

  const openPanel = (p: Exclude<Panel, null>) =>
    setPanel((cur) => (cur === p ? null : p));
  const closePanel = () => setPanel(null);

  const jumpToPage = (page: number) => {
    viewerRef.current?.goToPage(page);
    closePanel();
  };

  // Jump to a highlight's page: PDF highlights carry their page directly; DOCX
  // highlights resolve their block id to whatever page it currently sits on.
  const jumpToFixedHighlight = (h: Highlight) => {
    if (!h.fixed) return;
    const page =
      h.fixed.fmt === "pdf" ? h.fixed.page : source?.pageForBlock?.(h.fixed.blockId);
    if (page != null) jumpToPage(page);
  };

  // Logical edge a desktop panel's border faces: navigation panels lead,
  // tool panels trail (SideSheet / PanelShell handle the RTL flip). On mobile
  // there is no edge — the bottom sheet renders its own rounded chrome
  // edge-to-edge — so panels get `side: undefined` and a fluid width, exactly
  // as MobileReader passes them.
  const panelSide = (p: Panel): "left" | "right" | undefined =>
    isMobile ? undefined : p === "settings" || p === "progress" ? "right" : "left";

  // Body for the currently-open panel, reused by the desktop SideSheet and the
  // mobile bottom sheet so the panel content lives in exactly one place.
  const renderPanelBody = () => {
    const side = panelSide(panel);
    // Phone widths vary (360-430px+); the desktop 340px column would leave
    // dead space beside the sheet.
    const width = isMobile ? "100%" : undefined;
    switch (panel) {
      case "toc":
        return (
          <OutlinePanel
            theme={theme}
            outline={source ? source.outline : []}
            title={book.title}
            current={progress.page}
            onJump={jumpToPage}
            onClose={closePanel}
            side={side}
            width={width}
          />
        );
      case "highlights":
        return (
          <HighlightsPanel
            theme={theme}
            themeKey={themeKey}
            onClose={closePanel}
            highlights={highlights}
            onJump={jumpToFixedHighlight}
            onDelete={onDeleteHighlight}
            onUpdateNote={onUpdateHighlightNote}
            side={side}
            width={width}
          />
        );
      case "progress":
        return (
          <PanelShell
            theme={theme}
            title={tr("reader.readingProgress")}
            onClose={closePanel}
            side={side}
            width={width}
          >
            <PageProgressBody
              theme={theme}
              page={progress.page}
              total={sourcePageCount(source)}
              fmt={fmt}
              isAr={locale === "ar"}
            />
          </PanelShell>
        );
      case "settings":
        // Same component the reflow readers render — only the control set
        // differs (`variant="fixed"`), so the shell, language row, theme row
        // and "All settings" footer stay identical across formats.
        return (
          <SettingsPanel
            variant="fixed"
            theme={theme}
            themeKey={themeKey}
            t={t}
            setTweak={setTweak}
            onClose={closePanel}
            side={side}
            width={width}
            mobile={isMobile}
            zoom={zoom}
            onZoomChange={setZoom}
            onOpenFullSettings={onOpenFullSettings}
          />
        );
      default:
        return null;
    }
  };

  const panelLabel =
    panel === "toc"
      ? tr("reader.toc")
      : panel === "highlights"
        ? tr("reader.highlights")
        : panel === "progress"
          ? tr("reader.readingProgress")
          : panel === "settings"
            ? tr("reader.readingSettings")
            : undefined;

  const title = book.title || tr("common.untitled");
  const total = sourcePageCount(source);
  const pageCounter =
    locale === "ar"
      ? `صفحة ${fmt(progress.page + 1)} من ${fmt(total)}`
      : `Page ${progress.page + 1} of ${total}`;

  return (
    <div
      dir={uiDir}
      style={{
        position: "absolute",
        inset: 0,
        background: theme.bg,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* top chrome — shared with the reflow reader */}
      <ReaderTopBar
        theme={theme}
        onBack={onBack}
        backLabel={tr("common.back")}
        title={title}
        subtitle={pageCounter}
        titleStyle={{ fontFamily: titleFontFor(title) }}
        progressFraction={progress.fraction}
        fillRtl={contentDir === "rtl"}
        navButtons={
          <>
            <ReaderIconButton
              theme={theme}
              icon="list"
              label={tr("reader.toc")}
              onClick={() => openPanel("toc")}
              active={panel === "toc"}
            />
            <ReaderIconButton
              theme={theme}
              icon="highlight"
              label={tr("reader.highlights")}
              onClick={() => openPanel("highlights")}
              active={panel === "highlights"}
            />
          </>
        }
        trailing={
          <>
            <ReaderIconButton
              theme={theme}
              icon="clock"
              label={tr("reader.readingProgress")}
              onClick={() => openPanel("progress")}
              active={panel === "progress"}
            />
            <ReaderIconButton
              theme={theme}
              icon="type"
              label={tr("settings.title")}
              onClick={() => openPanel("settings")}
              active={panel === "settings"}
            />
          </>
        }
      />

      {/* center viewer — flex:1 fills the gap between the bars (positioned
          context for the viewer's absolute-inset scroll layer). */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {source ? (
          <FixedPageViewer
            ref={viewerRef}
            source={source}
            flow={t.fixedFlow}
            fit={t.fixedFit}
            zoom={zoom}
            tint={t.fixedPageTint}
            dir={contentDir}
            // Turns follow the gesture that drives them: a sideways swipe on
            // mobile, the wheel on desktop.
            turnAxis={isMobile ? "x" : "y"}
            theme={theme}
            themeKey={themeKey}
            highlights={highlights}
            onSelect={setSel}
            onHighlightClick={(id, rect) => {
              setSel(null);
              setActiveHl({ id, rect });
            }}
            resume={resume}
            reducedMotion={reduced}
            formatCounter={formatCounter}
            onProgress={(p) =>
              setProgress((prev) => {
                // Take the page the viewer reports; `fraction` is not
                // invertible (see ReaderProgress.page).
                const page = p.page ?? prev.page;
                return prev.label === p.label
                  ? prev
                  : { page, fraction: p.fraction, label: p.label };
              })
            }
            onLocationChange={(page, off) =>
              onLocationChange?.(page, off, source?.pageCount ?? 0)
            }
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: theme.muted,
              fontFamily: FONT_SERIF_DISPLAY,
              fontSize: 18,
            }}
          >
            {tr("app.loadingBook")}
          </div>
        )}

        {/* Desktop: panels slide in over the viewer as an overlay sheet.
            Mobile keeps its own bottom-anchored overlay below. */}
        {!isMobile && (
          <SideSheet
            open={panel !== null}
            onClose={closePanel}
            side={panel === "settings" || panel === "progress" ? "right" : "left"}
            label={panelLabel}
          >
            {renderPanelBody()}
          </SideSheet>
        )}
      </div>

      {/* bottom scrubber — shared with the reflow reader (seeks pages) */}
      <ReaderScrubBar
        theme={theme}
        rtl={uiDir === "rtl"}
        fraction={progress.fraction}
        pctLabel={`${Math.round(progress.fraction * 100)}%`}
        label={title}
        prevLabel={locale === "ar" ? "الصفحة السابقة" : "Previous page"}
        nextLabel={locale === "ar" ? "الصفحة التالية" : "Next page"}
        onPrev={() => viewerRef.current?.goToPage(Math.max(0, progress.page - 1))}
        onNext={() =>
          viewerRef.current?.goToPage(Math.min(total - 1, progress.page + 1))
        }
        prevDisabled={progress.page <= 0}
        nextDisabled={progress.page >= total - 1}
        onSeek={(f) =>
          viewerRef.current?.goToPage(Math.round(f * Math.max(0, total - 1)))
        }
        ariaLabel={tr("reader.readingProgress")}
        valueMin={1}
        valueMax={Math.max(1, total)}
        valueNow={progress.page + 1}
        valueText={progress.label || pageCounter}
        padding={isMobile ? "10px 14px 14px" : "14px 80px 22px"}
      />

      {/* Mobile panels: the same bottom sheet the reflow reader raises, at the
          same default snap. It stays mounted while it animates out, so `open`
          drives the exit rather than an unmount. Desktop uses the SideSheet
          mounted inside the viewer above. */}
      {isMobile && (
        <MobileSheet
          theme={theme}
          open={panel !== null}
          onClose={closePanel}
          height="82%"
          label={panelLabel}
        >
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {renderPanelBody()}
          </div>
        </MobileSheet>
      )}

      {/* Highlighting popovers (DOCX). Positioned from viewport-coordinate rects. */}
      {sel && (
        <SelectionPopover
          theme={theme}
          anchor={sel.rect}
          onPick={(color) => createFromSelection(color)}
          onAddNote={(color, note) => createFromSelection(color, note)}
          onDismiss={() => setSel(null)}
        />
      )}
      {activeHl &&
        (() => {
          const hl = highlights.find((h) => h.id === activeHl.id);
          return hl ? (
            <HighlightActionPopover
              theme={theme}
              highlight={hl}
              anchor={activeHl.rect}
              onDelete={() => {
                onDeleteHighlight(hl.id);
                setActiveHl(null);
              }}
              onUpdateNote={(note) => {
                onUpdateHighlightNote(hl.id, note);
                setActiveHl(null);
              }}
              onDismiss={() => setActiveHl(null)}
            />
          ) : null;
        })()}
    </div>
  );
}

function sourcePageCount(source: FixedPageSource | null): number {
  return source ? source.pageCount : 1;
}

function OutlinePanel({
  theme,
  outline,
  title,
  current,
  onJump,
  onClose,
  side,
  width,
}: {
  theme: Theme;
  outline: TocEntry[];
  title: string;
  current: number;
  onJump: (page: number) => void;
  onClose: () => void;
  side?: "left" | "right";
  width?: number | string;
}) {
  const { tr, locale } = useI18n();
  return (
    <PanelShell
      theme={theme}
      title={tr("reader.toc")}
      subtitle={title || tr("common.untitled")}
      onClose={onClose}
      side={side}
      width={width}
    >
      <div style={{ padding: "8px 6px" }}>
        {outline.length === 0 && (
          <div style={{ padding: "32px 18px", textAlign: "center", color: theme.muted, fontSize: 12.5, lineHeight: 1.5 }}>
            {locale === "ar" ? "لا يحتوي هذا المستند على فهرس." : "This document has no contents."}
          </div>
        )}
        {outline.map((entry, i) => {
          const page = entry.dest.fmt === "page" ? entry.dest.page : 0;
          const active = page === current;
          return (
            <button
              key={i}
              onClick={() => onJump(page)}
              style={{
                width: "100%",
                textAlign: "start",
                border: "none",
                background: active ? theme.hover : "transparent",
                padding: "11px 14px",
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                color: theme.ink,
                paddingInlineStart: 14 + entry.level * 14,
              }}
            >
              <span
                style={{
                  fontFamily: FONT_SERIF_DISPLAY,
                  fontSize: 14.5,
                  fontStyle: "normal",
                  fontWeight: active ? 500 : 400,
                  color: theme.ink,
                  flex: 1,
                  lineHeight: 1.3,
                }}
              >
                {entry.title}
              </span>
            </button>
          );
        })}
      </div>
    </PanelShell>
  );
}

function PageProgressBody({
  theme,
  page,
  total,
  fmt,
  isAr,
}: {
  theme: Theme;
  page: number;
  total: number;
  fmt: (n: number) => string;
  isAr: boolean;
}) {
  const pct = total > 0 ? Math.round(((page + 1) / total) * 100) : 0;
  return (
    <div style={{ padding: 22, textAlign: "center" }}>
      <div
        style={{
          width: 132,
          height: 132,
          margin: "6px auto 16px",
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: `conic-gradient(${ACCENT} ${pct}%, ${theme.rule} 0)`,
        }}
      >
        <div
          style={{
            width: 104,
            height: 104,
            borderRadius: "50%",
            background: theme.chrome,
            display: "grid",
            placeItems: "center",
            fontSize: 24,
            fontWeight: 700,
            color: theme.ink,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {isAr ? `٪${fmt(pct)}` : `${pct}%`}
        </div>
      </div>
      <div style={{ color: theme.muted, fontSize: 13.5 }}>
        {isAr
          ? `صفحة ${fmt(page + 1)} من ${fmt(total)}`
          : `Page ${fmt(page + 1)} of ${fmt(total)}`}
      </div>
    </div>
  );
}
