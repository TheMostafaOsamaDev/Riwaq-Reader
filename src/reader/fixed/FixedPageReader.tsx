// The shared reader shell for fixed-layout books (PDF / DOCX): the same chrome
// + panels as the EPUB readers (Contents / Bookmarks / Progress / Settings via
// PanelShell, the shared SettingsSection primitives), with a FixedPageViewer in
// the center instead of reflowable text. Only the center differs by format; the
// shell is identical. The page source is created via a `createSource` factory
// so this component is agnostic to disk-vs-bytes loading (App passes a disk
// source; the dev harness passes an in-memory one).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ACCENT,
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  titleFontFor,
  type Theme,
  type ThemeKey,
} from "../../styles/tokens";
import { useReducedMotion } from "../../styles/motion";
import type { Tweaks, TocEntry } from "../../types/reader";
import type { BookState, FixedBook } from "../../store/library";
import type { FixedPageSource } from "./FixedPageSource";
import { FixedPageViewer, type FixedPageViewerHandle } from "./FixedPageViewer";
import { PanelShell } from "../../panels/PanelShell";
import { SideSheet } from "../../components/SideSheet";
import { ReaderTopBar } from "../chrome/ReaderTopBar";
import { ReaderScrubBar } from "../chrome/ReaderScrubBar";
import { ReaderIconButton } from "../chrome/ReaderIconButton";
import { Field, SegRow, ThemeField } from "../../components/SettingsSection";
import { useI18n } from "../../i18n/useI18n";

type SetTweak = <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
type Panel = null | "toc" | "bookmarks" | "progress" | "settings";

export interface FixedPageReaderProps {
  theme: Theme;
  themeKey: ThemeKey;
  t: Tweaks;
  setTweak: SetTweak;
  book: FixedBook;
  state: BookState;
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

function toArabicDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
}

/** Bordered +/- stepper button used by the settings Zoom row. */
function zoomStepStyle(theme: Theme): CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: `1px solid ${theme.rule}`,
    background: theme.hover,
    color: theme.ink,
    cursor: "pointer",
    fontSize: 18,
    lineHeight: 1,
    display: "grid",
    placeItems: "center",
  };
}

export function FixedPageReader(props: FixedPageReaderProps) {
  const {
    theme,
    t,
    setTweak,
    book,
    state,
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
    (n: number) => (locale === "ar" ? toArabicDigits(String(n)) : String(n)),
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

  // Logical edge for a panel. Desktop follows the shared convention
  // (navigation panels lead, tool panels trail); mobile keeps its single
  // leading-edge overlay. SideSheet / PanelShell handle the RTL flip.
  const panelSide = (p: Panel): "left" | "right" =>
    isMobile
      ? uiDir === "rtl"
        ? "right"
        : "left"
      : p === "settings" || p === "progress"
        ? "right"
        : "left";

  // Body for the currently-open panel, reused by the desktop SideSheet and the
  // mobile overlay so the panel content lives in exactly one place.
  const renderPanelBody = () => {
    const side = panelSide(panel);
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
          />
        );
      case "bookmarks":
        return (
          <PanelShell
            theme={theme}
            title={tr("reader.highlights")}
            onClose={closePanel}
            side={side}
          >
            <div style={{ padding: "32px 18px", textAlign: "center", color: theme.muted, fontSize: 13, lineHeight: 1.5 }}>
              {locale === "ar" ? "لا توجد علامات بعد." : "No bookmarks yet."}
            </div>
          </PanelShell>
        );
      case "progress":
        return (
          <PanelShell
            theme={theme}
            title={tr("reader.readingProgress")}
            onClose={closePanel}
            side={side}
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
        return (
          <PanelShell
            theme={theme}
            title={tr("settings.title")}
            onClose={closePanel}
            side={side}
          >
            <ThemeField theme={theme} pref={t.theme} onChange={(p) => setTweak("theme", p)} />
            <Field label={locale === "ar" ? "طريقة العرض" : "Flow"} theme={theme}>
              <SegRow<Tweaks["fixedFlow"]>
                theme={theme}
                value={t.fixedFlow}
                onChange={(v) => setTweak("fixedFlow", v)}
                options={[
                  { value: "scroll", label: locale === "ar" ? "تمرير" : "Scroll" },
                  { value: "paged", label: locale === "ar" ? "صفحة" : "Page" },
                ]}
              />
            </Field>
            <Field label={locale === "ar" ? "الملاءمة" : "Fit"} theme={theme}>
              <SegRow<Tweaks["fixedFit"]>
                theme={theme}
                value={t.fixedFit}
                onChange={(v) => setTweak("fixedFit", v)}
                options={[
                  { value: "width", label: locale === "ar" ? "العرض" : "Width" },
                  { value: "page", label: locale === "ar" ? "الصفحة" : "Page" },
                ]}
              />
            </Field>
            <Field label={locale === "ar" ? "تدرّج الصفحة" : "Page tint"} theme={theme}>
              <SegRow<Tweaks["fixedPageTint"]>
                theme={theme}
                value={t.fixedPageTint}
                onChange={(v) => setTweak("fixedPageTint", v)}
                options={[
                  { value: "none", label: locale === "ar" ? "بلا" : "None" },
                  { value: "dim", label: locale === "ar" ? "تعتيم" : "Dim" },
                  { value: "invert", label: locale === "ar" ? "عكس" : "Invert" },
                ]}
              />
            </Field>
            {/* Zoom lives here (fixed-page only) — the reflow reader has no zoom. */}
            <Field label={locale === "ar" ? "التكبير" : "Zoom"} theme={theme}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}
                  aria-label={locale === "ar" ? "تصغير" : "Zoom out"}
                  style={zoomStepStyle(theme)}
                >
                  −
                </button>
                <span
                  style={{
                    minWidth: 52,
                    textAlign: "center",
                    fontVariantNumeric: "tabular-nums",
                    color: theme.ink,
                    fontSize: 13,
                  }}
                >
                  {fmt(Math.round(zoom * 100))}%
                </span>
                <button
                  onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.1).toFixed(2)))}
                  aria-label={locale === "ar" ? "تكبير" : "Zoom in"}
                  style={zoomStepStyle(theme)}
                >
                  +
                </button>
              </div>
            </Field>
            {onOpenFullSettings && (
              <div style={{ padding: 12 }}>
                <button
                  onClick={onOpenFullSettings}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: 10,
                    border: `1px solid ${theme.rule}`,
                    background: theme.hover,
                    color: theme.ink,
                    cursor: "pointer",
                    fontFamily: FONT_STACKS.sans,
                    fontSize: 13,
                  }}
                >
                  {tr("settings.title")}
                </button>
              </div>
            )}
          </PanelShell>
        );
      default:
        return null;
    }
  };

  const panelLabel =
    panel === "toc"
      ? tr("reader.toc")
      : panel === "bookmarks"
        ? tr("reader.highlights")
        : panel === "progress"
          ? tr("reader.readingProgress")
          : panel === "settings"
            ? tr("settings.title")
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
              icon="bookmark"
              label={tr("reader.highlights")}
              onClick={() => openPanel("bookmarks")}
              active={panel === "bookmarks"}
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
            theme={theme}
            resume={resume}
            reducedMotion={reduced}
            formatCounter={formatCounter}
            onProgress={(p) =>
              setProgress((prev) => {
                const page = Math.round(p.fraction * (sourcePageCount(source) - 1));
                return prev.label === p.label ? prev : { page, fraction: p.fraction, label: p.label };
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

      {/* Mobile panels: bottom-anchored overlay + scrim. Desktop uses the
          SideSheet mounted inside the viewer above. */}
      {isMobile && panel && (
        <>
          <div
            onClick={closePanel}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 8,
              background: "rgba(0,0,0,0.42)",
            }}
          />
          <div
            style={{
              position: "absolute",
              zIndex: 9,
              top: "38%",
              bottom: 0,
              insetInlineStart: 0,
              insetInlineEnd: 0,
              width: "100%",
            }}
          >
            {renderPanelBody()}
          </div>
        </>
      )}
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
}: {
  theme: Theme;
  outline: TocEntry[];
  title: string;
  current: number;
  onJump: (page: number) => void;
  onClose: () => void;
  side: "left" | "right";
}) {
  const { tr, locale } = useI18n();
  return (
    <PanelShell theme={theme} title={tr("reader.toc")} subtitle={title || tr("common.untitled")} onClose={onClose} side={side}>
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
