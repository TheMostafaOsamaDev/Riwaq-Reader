// The shared reader shell for fixed-layout books (PDF / DOCX): the same chrome
// + panels as the EPUB readers (Contents / Bookmarks / Progress / Settings via
// PanelShell, the shared SettingsSection primitives), with a FixedPageViewer in
// the center instead of reflowable text. Only the center differs by format; the
// shell is identical. The page source is created via a `createSource` factory
// so this component is agnostic to disk-vs-bytes loading (App passes a disk
// source; the dev harness passes an in-memory one).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACCENT,
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
  type ThemeKey,
} from "../../styles/tokens";
import { EASE, MOTION, useReducedMotion } from "../../styles/motion";
import type { Tweaks, TocEntry } from "../../types/reader";
import type { BookState, FixedBook } from "../../store/library";
import type { FixedPageSource } from "./FixedPageSource";
import { FixedPageViewer, type FixedPageViewerHandle } from "./FixedPageViewer";
import { PanelShell } from "../../panels/PanelShell";
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
  /** Persist the reading position (debounced upstream in App). */
  onLocationChange?: (page: number, pageOffset: number) => void;
  onOpenFullSettings?: () => void;
  onBack: () => void;
}

function toArabicDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
}

const ICON = {
  back: "M15 18l-6-6 6-6",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  bookmark: "M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z",
  search: "M21 21l-4.3-4.3",
  sliders: "M4 8h10M18 8h2M4 16h2M10 16h10",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  fit: "M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4",
} as const;

function Svg({ d, size = 21 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* search glyph needs a circle in addition to the handle path */}
      {d === ICON.search && <circle cx="11" cy="11" r="7" />}
      {(d === ICON.sliders && (
        <>
          <path d={d} />
          <circle cx="16" cy="8" r="2.4" />
          <circle cx="8" cy="16" r="2.4" />
        </>
      )) || <path d={d} />}
    </svg>
  );
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
  const [chrome, setChrome] = useState(true);
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

  const iconBtn = (
    key: string,
    d: string,
    label: string,
    onClick: () => void,
    active = false,
  ) => (
    <button
      key={key}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      style={{
        width: isMobile ? 44 : 40,
        height: isMobile ? 44 : 40,
        borderRadius: 10,
        border: "none",
        background: active ? theme.hover : "transparent",
        color: active ? ACCENT : theme.chromeInk,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <Svg d={d} />
    </button>
  );

  const barBase: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 6,
    background: theme.chrome,
    display: "flex",
    alignItems: "center",
    transition: reduced ? "none" : `transform ${MOTION.med}ms ${EASE.enter}`,
  };

  const title = book.title || tr("common.untitled");
  const formatLabel = book.kind === "pdf" ? "PDF" : "DOCX";

  return (
    <div
      dir={uiDir}
      style={{ position: "absolute", inset: 0, background: theme.bg, overflow: "hidden" }}
    >
      {/* top chrome */}
      <div
        style={{
          ...barBase,
          top: 0,
          height: isMobile ? 56 : 54,
          padding: "0 6px",
          gap: 2,
          borderBottom: `0.5px solid ${theme.rule}`,
          transform: chrome ? "none" : "translateY(-100%)",
        }}
      >
        {iconBtn(
          "back",
          ICON.back,
          tr("common.back"),
          onBack,
        )}
        <div style={{ flex: 1, minWidth: 0, padding: "0 6px" }}>
          <div
            style={{
              fontFamily: FONT_STACKS.sans,
              fontWeight: 600,
              fontSize: 14.5,
              color: theme.ink,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 11.5, color: theme.muted }}>{formatLabel}</div>
        </div>
        {iconBtn("toc", ICON.list, tr("reader.toc"), () => openPanel("toc"), panel === "toc")}
        {iconBtn("bm", ICON.bookmark, tr("reader.highlights"), () => openPanel("bookmarks"), panel === "bookmarks")}
        {!isMobile && iconBtn("search", ICON.search, tr("toc.searchChapters"), () => openPanel("toc"))}
        {iconBtn("set", ICON.sliders, tr("settings.title"), () => openPanel("settings"), panel === "settings")}
      </div>

      {/* center viewer */}
      <div
        style={{ position: "absolute", inset: 0 }}
        onClick={(e) => {
          // Tap the reading area (not a control) toggles immersive chrome.
          if ((e.target as HTMLElement).closest("button,input,a")) return;
          if (window.getSelection && String(window.getSelection())) return;
          setChrome((c) => !c);
        }}
      >
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
            onLocationChange={(page, off) => onLocationChange?.(page, off)}
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
              fontStyle: "italic",
              fontSize: 18,
            }}
          >
            {tr("app.loadingBook")}
          </div>
        )}
      </div>

      {/* bottom chrome */}
      <div
        style={{
          ...barBase,
          bottom: 0,
          minHeight: 60,
          padding: "8px 12px",
          gap: 12,
          borderTop: `0.5px solid ${theme.rule}`,
          flexWrap: "wrap",
          transform: chrome ? "none" : "translateY(110%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {iconBtn("zo", ICON.minus, "Zoom out", () => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2))))}
          <span
            style={{ fontSize: 11, color: theme.muted, minWidth: 42, textAlign: "center", fontVariantNumeric: "tabular-nums" }}
          >
            {fmt(Math.round(zoom * 100))}%
          </span>
          {iconBtn("zi", ICON.plus, "Zoom in", () => setZoom((z) => Math.min(2.5, +(z + 0.1).toFixed(2))))}
        </div>
        <div style={{ width: 1, height: 24, background: theme.rule }} />
        <div style={{ flex: 1, minWidth: 120, display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => openPanel("progress")}
            aria-label={tr("reader.readingProgress")}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: theme.ink,
              fontWeight: 600,
              fontSize: 13,
              fontVariantNumeric: "tabular-nums",
              fontFamily: FONT_STACKS.sans,
              minWidth: 92,
              textAlign: "center",
            }}
          >
            {progress.label || formatCounter(resume.page + 1, sourcePageCount(source))}
          </button>
          <input
            type="range"
            min={1}
            max={Math.max(1, sourcePageCount(source))}
            value={progress.page + 1}
            onChange={(e) => jumpToPageNoClose(+e.target.value - 1)}
            aria-label={tr("reader.readingProgress")}
            style={{ flex: 1, accentColor: ACCENT }}
          />
        </div>
        {iconBtn(
          "fit",
          ICON.fit,
          "Fit",
          () => setTweak("fixedFit", t.fixedFit === "width" ? "page" : "width"),
          t.fixedFit === "page",
        )}
      </div>

      {/* panels */}
      {panel && (
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
              top: isMobile ? "38%" : 54,
              bottom: 0,
              insetInlineStart: isMobile ? 0 : 0,
              insetInlineEnd: isMobile ? 0 : "auto",
              width: isMobile ? "100%" : 340,
            }}
          >
            {panel === "toc" && (
              <OutlinePanel
                theme={theme}
                outline={source ? source.outline : []}
                title={book.title}
                current={progress.page}
                onJump={jumpToPage}
                onClose={closePanel}
                side={uiDir === "rtl" ? "right" : "left"}
              />
            )}
            {panel === "bookmarks" && (
              <PanelShell
                theme={theme}
                title={tr("reader.highlights")}
                onClose={closePanel}
                side={uiDir === "rtl" ? "right" : "left"}
              >
                <div style={{ padding: "32px 18px", textAlign: "center", color: theme.muted, fontSize: 13, lineHeight: 1.5 }}>
                  {locale === "ar" ? "لا توجد علامات بعد." : "No bookmarks yet."}
                </div>
              </PanelShell>
            )}
            {panel === "progress" && (
              <PanelShell
                theme={theme}
                title={tr("reader.readingProgress")}
                onClose={closePanel}
                side={uiDir === "rtl" ? "right" : "left"}
              >
                <PageProgressBody
                  theme={theme}
                  page={progress.page}
                  total={sourcePageCount(source)}
                  fmt={fmt}
                  isAr={locale === "ar"}
                />
              </PanelShell>
            )}
            {panel === "settings" && (
              <PanelShell
                theme={theme}
                title={tr("settings.title")}
                onClose={closePanel}
                side={uiDir === "rtl" ? "right" : "left"}
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
            )}
          </div>
        </>
      )}
    </div>
  );

  function jumpToPageNoClose(page: number) {
    viewerRef.current?.goToPage(page);
  }
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
                  fontStyle: active ? "italic" : "normal",
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
