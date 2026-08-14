import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatedSwap } from "./components/AnimatedSwap";
import { useLaunchIntent } from "./hooks/useLaunchIntent";
import { DesktopReader } from "./components/DesktopReader";
import { ImportProgress } from "./components/ImportProgress";
import { Library } from "./components/Library";
import { Lightbox } from "./components/Lightbox";
import { MobileReader } from "./components/MobileReader";
import { SourceStreamReader } from "./components/SourceStreamReader";
import { SettingsPage } from "./components/SettingsPage";
import { startDownloadNotifier } from "./store/downloadNotifier";
import {
  loadPersistedQueue,
  setDownloadConcurrency,
  setWifiOnlyDownloads,
} from "./store/downloadQueue";
import type { EpubBook } from "./epub/types";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useTweaks } from "./hooks/useTweaks";
import { useWakeLock } from "./hooks/useWakeLock";
import { close as closeLightbox, useLightbox } from "./store/lightbox";
import {
  deleteHighlights,
  listBooks,
  loadBook,
  markBookOpened,
  saveHighlight,
  updateHighlightNote,
  updateParagraphPosition,
  updateReadingPosition,
  type BookState,
  type Highlight,
} from "./store/library";
import { MOTION, setReduceMotionOverride, useReducedMotion } from "./styles/motion";
import type { HighlightColor } from "./styles/tokens";
import {
  FONT_READING_SANS,
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  THEMES,
  UI_FONT_STACKS,
  resolveTheme,
} from "./styles/tokens";
import type { ActivePanel } from "./types/reader";
import { I18nProvider } from "./i18n/I18nProvider";
import { detectLocale, DIR_FOR, makeTr } from "./i18n";

interface Loaded {
  book: EpubBook;
  state: BookState;
  currentChapter: number;
  /**
   * Paragraph index to scroll to when the chapter mounts. Set from the
   * persisted BookState on initial open, then reset to 0 whenever the user
   * navigates between chapters (each new chapter starts at the top). The
   * reader reads this only on chapter change — live scroll position lives
   * in the reader's own ref.
   */
  resumeParagraph: number;
  /**
   * 0..1 sub-paragraph scroll offset to resume at, paired with
   * resumeParagraph. Set from the persisted BookState on open, reset to 0 on
   * chapter change / highlight jump (those land at a paragraph's top).
   */
  resumeOffset: number;
  /**
   * Bumped by every highlight-jump (or other targeted scroll) so the
   * reader's chapter-mount effect re-fires even when the jump target is
   * inside the chapter already on screen. Without this, tapping a
   * highlight in the current chapter is a no-op for the scroll effect
   * (deps unchanged).
   */
  jumpNonce: number;
}

interface StreamingSession {
  sourceId: string;
  novelUrl: string;
  startChapterId?: number;
}

function App() {
  // Listen for Android launch-intent extras (e.g., notification taps
  // routing to the download queue). Has to live above the Library so
  // any emitted intents reach the Library's subscriber.
  useLaunchIntent();
  const [t, setTweak, applyTweaks] = useTweaks();
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const lightbox = useLightbox();
  // Streaming reader — opened from the Store when the user clicks "Read"
  // on a novel detail page. Non-null = full-viewport reader overlays
  // everything else (Library + Store). Closing returns to the Store at
  // the same novel.
  const [streaming, setStreaming] = useState<StreamingSession | null>(null);

  const openStream = useCallback(
    (sourceId: string, novelUrl: string, chapterId?: number) => {
      setStreaming({ sourceId, novelUrl, startChapterId: chapterId });
    },
    [],
  );
  const closeStream = useCallback(() => setStreaming(null), []);

  // Settings promoted to a top-level view (peer of Library/Reader). Opened from
  // the Library nav and the reader's quick-panel; Back re-derives the viewKey
  // back to whichever view is still mounted underneath.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Phones in landscape exceed 720px wide but still need the mobile reader
  // (tap-to-toggle chrome, single-column layout). Treat any coarse-pointer
  // device with a short viewport as mobile too.
  const isMobile = useMediaQuery(
    "(max-width: 720px), (pointer: coarse) and (max-height: 480px)",
  );
  // "system" resolves to light/dark from the OS setting; useMediaQuery
  // re-renders when the user flips OS appearance, so the whole app
  // (and the theme-aware brand mark) re-themes live.
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const themePref = t.theme;
  const themeKey = resolveTheme(themePref, prefersDark);
  const theme = THEMES[themeKey];

  const uiLocale = detectLocale(
    t.uiLang,
    typeof navigator !== "undefined" ? navigator.language : "en",
  );
  const uiDir = DIR_FOR[uiLocale];
  // App owns the I18nProvider (below), so it's above that context and
  // can't call useI18n() itself — build the translator directly instead.
  const tr = useMemo(() => makeTr(uiLocale), [uiLocale]);

  useEffect(() => {
    document.documentElement.lang = uiLocale;
    document.documentElement.dir = uiDir;
  }, [uiLocale, uiDir]);

  useEffect(() => {
    document.body.style.background = theme.bg;
    document.body.style.color = theme.ink;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (meta) meta.content = theme.bg;
    // Match the Android status/navigation-bar icon contrast to the
    // in-app theme. Light themes (light, sepia) need dark icons; dark
    // themes (dark, oled) need light icons. The OS DayNight setting
    // would otherwise leave white icons on a light bar. No-op / silent
    // throw off Android — invoke just rejects and we ignore it.
    const darkIcons = themeKey === "light" || themeKey === "sepia";
    void invoke("set_status_bar_style", { darkIcons }).catch(() => {});
  }, [theme.bg, theme.ink, themeKey]);

  // Apply the selectable UI (chrome) font through a CSS variable that
  // FONT_STACKS.sans falls back through. Set on documentElement so any
  // portalled overlays inherit it too. Unset → defaults to Readex Pro.
  useEffect(() => {
    // Fallback guards a corrupt/unknown uiFont (e.g. from imported settings):
    // an undefined lookup would set the var to the string "undefined" and break
    // the entire chrome font.
    document.documentElement.style.setProperty(
      "--ui-font",
      UI_FONT_STACKS[t.uiFont] ?? FONT_READING_SANS,
    );
  }, [t.uiFont]);

  // App-level reduce-motion override ("auto" = follow the OS). Composes on
  // top of the OS preference inside useReducedMotion via a tiny pub-sub, so
  // every call site (AnimatedSwap, panels, readers) picks it up.
  useEffect(() => {
    setReduceMotionOverride(t.reduceMotion);
  }, [t.reduceMotion]);

  // Push download-queue runtime config from the tweaks.
  useEffect(() => {
    setDownloadConcurrency(t.maxConcurrentDownloads);
  }, [t.maxConcurrentDownloads]);
  useEffect(() => {
    setWifiOnlyDownloads(t.wifiOnlyDownloads);
  }, [t.wifiOnlyDownloads]);

  // Bridge the download queue to the system notification tray.
  // Idempotent — subsequent calls are no-ops, so React 18 dev
  // re-mount doesn't double-subscribe.
  useEffect(() => {
    // Restore any jobs that were in flight when the app last died.
    // The function is idempotent. Order matters: load BEFORE the
    // notifier subscribes so the initial emit (which marks
    // interrupted jobs) doesn't trigger a notification flurry on
    // launch.
    (async () => {
      await loadPersistedQueue();
      startDownloadNotifier();
    })();
  }, []);

  const reduced = useReducedMotion();
  // Hold a screen wake lock while actively reading (a book is open or a
  // stream is playing) and the user enabled it. Best-effort; no-ops where
  // the Wake Lock API is unavailable.
  useWakeLock(t.keepScreenAwake && (loaded !== null || streaming !== null));
  // Holds the deferred setLoading(false) so a rapid re-open of a different
  // book can clear it before it fires for the previous load.
  const loadingTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, []);

  const openBook = useCallback(
    async (id: string) => {
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      setLoading(true);
      setError(null);
      try {
        const { book, state } = await loadBook(id);
        // Stamp `lastReadAt` on open so the Library's "Continue reading"
        // hero picks the book the user just opened, even when they exit
        // before a chapter change has triggered `updateReadingPosition`.
        // Awaited so the write commits before the Library remounts on
        // back-out and re-fetches the index.
        await markBookOpened(id);
        setLoaded({
          book,
          state,
          currentChapter: state.currentChapter,
          resumeParagraph: state.paragraphIndex,
          resumeOffset: state.paragraphOffset ?? 0,
          jumpNonce: 0,
        });
        setActivePanel(null);
        // Keep the spinner up over the AnimatedSwap crossfade so the
        // user doesn't catch the Library through the reader's fade-in.
        // The delay matches the .leaflet-view-enter keyframe (MOTION.med
        // = 240ms); reduced-motion users get the swap instantly, so
        // there's nothing to wait for.
        if (reduced) {
          setLoading(false);
        } else {
          loadingTimeoutRef.current = window.setTimeout(() => {
            loadingTimeoutRef.current = null;
            setLoading(false);
          }, MOTION.med);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    },
    [reduced],
  );

  // First-run startup routing. When "Resume last book" is chosen, open the
  // most-recently-read local book once on mount (listBooks is sorted newest
  // first). Guarded so React's dev double-invoke doesn't fire it twice.
  const didStartupRef = useRef(false);
  useEffect(() => {
    if (didStartupRef.current) return;
    didStartupRef.current = true;
    if (t.startupView !== "resume") return;
    // No cancellation guard: didStartupRef already dedupes, and the App root
    // never unmounts mid-startup. A `cancelled` flag here would be flipped by
    // StrictMode's dev cleanup and suppress the one legitimate run.
    void (async () => {
      try {
        const books = await listBooks();
        const newest = books.find((b) => b.kind !== "source");
        if (newest) void openBook(newest.id);
      } catch {
        // ignore — fall back to the Library
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeBook = useCallback(() => {
    setLoaded(null);
    setActivePanel(null);
    setError(null);
  }, []);

  const changeChapter = useCallback(
    (order: number) => {
      setLoaded((prev) => {
        if (!prev) return prev;
        const clamped = Math.max(
          0,
          Math.min(prev.book.chapters.length - 1, order),
        );
        void updateReadingPosition(
          prev.book.id,
          clamped,
          prev.book.chapters.length,
        );
        // New chapter starts at the top — clear any pending paragraph save
        // and reset the resume hint so the reader scrolls to paragraph 0.
        if (paragraphSaveTimer.current) {
          clearTimeout(paragraphSaveTimer.current);
          paragraphSaveTimer.current = null;
        }
        return {
          ...prev,
          currentChapter: clamped,
          resumeParagraph: 0,
          resumeOffset: 0,
        };
      });
    },
    [],
  );

  // Debounce paragraph saves so we don't hammer disk on every scroll event.
  const paragraphSaveTimer = useRef<number | null>(null);
  const onParagraphChange = useCallback((idx: number, offset?: number) => {
    if (paragraphSaveTimer.current)
      clearTimeout(paragraphSaveTimer.current);
    paragraphSaveTimer.current = window.setTimeout(() => {
      paragraphSaveTimer.current = null;
      setLoaded((prev) => {
        if (!prev) return prev;
        const off = offset ?? 0;
        if (
          prev.state.paragraphIndex === idx &&
          (prev.state.paragraphOffset ?? 0) === off
        )
          return prev;
        void updateParagraphPosition(prev.book.id, idx, off);
        return {
          ...prev,
          state: { ...prev.state, paragraphIndex: idx, paragraphOffset: off },
        };
      });
    }, 600);
  }, []);

  useEffect(() => {
    return () => {
      if (paragraphSaveTimer.current)
        clearTimeout(paragraphSaveTimer.current);
    };
  }, []);

  const createHighlight = useCallback(
    async (input: {
      chapter: number;
      paragraphIndex: number;
      charStart: number;
      charEnd: number;
      text: string;
      color: HighlightColor;
      note?: string;
      groupId?: string;
    }) => {
      if (!loaded) return;
      const saved = await saveHighlight(loaded.book.id, input);
      setLoaded((prev) =>
        prev
          ? {
              ...prev,
              state: {
                ...prev.state,
                highlights: [...prev.state.highlights, saved],
              },
            }
          : prev,
      );
    },
    [loaded],
  );

  const removeHighlight = useCallback(
    async (highlightId: string) => {
      if (!loaded) return;
      // If the highlight is part of a multi-paragraph group, delete
      // every member of the group so the user-visible "one selection
      // = one highlight" mental model holds.
      const target = loaded.state.highlights.find((h) => h.id === highlightId);
      if (!target) return;
      const ids = target.groupId
        ? loaded.state.highlights
            .filter((h) => h.groupId === target.groupId)
            .map((h) => h.id)
        : [highlightId];
      await deleteHighlights(loaded.book.id, ids);
      const idSet = new Set(ids);
      setLoaded((prev) =>
        prev
          ? {
              ...prev,
              state: {
                ...prev.state,
                highlights: prev.state.highlights.filter(
                  (h) => !idSet.has(h.id),
                ),
              },
            }
          : prev,
      );
    },
    [loaded],
  );

  const editHighlightNote = useCallback(
    async (highlightId: string, note: string) => {
      if (!loaded) return;
      const trimmed = note.trim();
      await updateHighlightNote(loaded.book.id, highlightId, trimmed);
      setLoaded((prev) =>
        prev
          ? {
              ...prev,
              state: {
                ...prev.state,
                highlights: prev.state.highlights.map((h) =>
                  h.id === highlightId
                    ? { ...h, note: trimmed.length > 0 ? trimmed : undefined }
                    : h,
                ),
              },
            }
          : prev,
      );
    },
    [loaded],
  );

  // Jump from the sidebar to a highlight's exact spot. Reuses the
  // existing chapter-mount scroll-to-paragraph effect by setting the
  // resumeParagraph alongside the chapter switch.
  const jumpToHighlight = useCallback(
    (h: Highlight) => {
      if (!loaded) return;
      void updateReadingPosition(
        loaded.book.id,
        h.chapter,
        loaded.book.chapters.length,
      );
      if (paragraphSaveTimer.current) {
        clearTimeout(paragraphSaveTimer.current);
        paragraphSaveTimer.current = null;
      }
      setLoaded((prev) =>
        prev
          ? {
              ...prev,
              currentChapter: h.chapter,
              resumeParagraph: h.paragraphIndex,
              // A highlight jump lands at the paragraph's top, not a stale
              // mid-paragraph offset from wherever the reader last was.
              resumeOffset: 0,
              // Bump even if chapter + paragraph are identical to what
              // they were last jump — guarantees the reader's scroll
              // effect re-runs and lands on the highlight.
              jumpNonce: prev.jumpNonce + 1,
            }
          : prev,
      );
    },
    [loaded],
  );

  const inReader = loaded !== null;

  return (
    <I18nProvider locale={uiLocale}>
      <div
        // Shell direction follows the UI language. BookBody sets its own dir,
        // so book content stays independent of the chrome.
        dir={uiDir}
        style={{
          width: "100%",
          height: "100%",
          background: theme.bg,
          color: theme.ink,
          overflow: "hidden",
        }}
      >
        {loading && <FullPageSpinner theme={theme} label={tr("app.loadingBook")} />}
        {error && !loading && (
          <div
            style={{
              position: "absolute",
              top: 20,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 50,
              padding: "10px 16px",
              background: "rgba(180,60,60,0.12)",
              border: "0.5px solid rgba(180,60,60,0.4)",
              borderRadius: 8,
              fontSize: 12,
              color: theme.ink,
              fontFamily: FONT_STACKS.sans,
            }}
          >
            {error}
          </div>
        )}
        {/* Stream reader overlay. AnimatedSwap's slots are position:absolute
            with no z-index, so without this wrapper the next AnimatedSwap
            (Library/Reader) sits on top in document order and hides the
            streaming layer for the duration of its fade-in. The wrapper's
            z-index keeps the streaming layer above the Library throughout
            the animation; pointer-events flips off when no stream is active
            so the empty slot doesn't swallow clicks meant for the Library. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 30,
            pointerEvents: streaming ? "auto" : "none",
          }}
        >
          <AnimatedSwap viewKey={streaming ? "stream" : "none"}>
            {streaming ? (
              <SourceStreamReader
                theme={theme}
                themeKey={themeKey}
                t={t}
                setTweak={setTweak}
                layout={isMobile ? "mobile" : "desktop"}
                sourceId={streaming.sourceId}
                novelUrl={streaming.novelUrl}
                startChapterId={streaming.startChapterId}
                onClose={closeStream}
              />
            ) : null}
          </AnimatedSwap>
        </div>
        {/* Library ↔ Reader transition. viewKey is derived from the open
            book + layout so a layout change (e.g., rotating into landscape
            on mobile-landscape) ALSO crossfades cleanly. */}
        <AnimatedSwap
          viewKey={
            settingsOpen
              ? "settings"
              : inReader
                ? isMobile
                  ? "reader-mobile"
                  : "reader-desktop"
                : "library"
          }
        >
          {settingsOpen ? (
            <SettingsPage
              theme={theme}
              themeKey={themeKey}
              t={t}
              setTweak={setTweak}
              applyTweaks={applyTweaks}
              layout={isMobile ? "mobile" : "desktop"}
              onClose={closeSettings}
            />
          ) : !inReader ? (
            <Library
              theme={theme}
              themeKey={themeKey}
              layout={isMobile ? "mobile" : "desktop"}
              onOpen={openBook}
              onStreamRead={openStream}
              streamActive={streaming !== null}
              onOpenSettings={openSettings}
              confirmDelete={t.confirmDelete}
            />
          ) : isMobile ? (
            <MobileReader
              theme={theme}
              themeKey={themeKey}
              t={t}
              setTweak={setTweak}
              book={loaded!.book}
              state={loaded!.state}
              currentChapter={loaded!.currentChapter}
              resumeParagraph={loaded!.resumeParagraph}
              resumeOffset={loaded!.resumeOffset}
              jumpNonce={loaded!.jumpNonce}
              onChapterChange={changeChapter}
              onParagraphChange={onParagraphChange}
              onCreateHighlight={createHighlight}
              onDeleteHighlight={removeHighlight}
              onUpdateHighlightNote={editHighlightNote}
              onJumpToHighlight={jumpToHighlight}
              onOpenFullSettings={openSettings}
              onBack={closeBook}
            />
          ) : (
            <DesktopReader
              theme={theme}
              themeKey={themeKey}
              t={t}
              setTweak={setTweak}
              book={loaded!.book}
              state={loaded!.state}
              currentChapter={loaded!.currentChapter}
              resumeParagraph={loaded!.resumeParagraph}
              resumeOffset={loaded!.resumeOffset}
              jumpNonce={loaded!.jumpNonce}
              onChapterChange={changeChapter}
              onParagraphChange={onParagraphChange}
              onCreateHighlight={createHighlight}
              onDeleteHighlight={removeHighlight}
              onUpdateHighlightNote={editHighlightNote}
              onJumpToHighlight={jumpToHighlight}
              activePanel={activePanel}
              setActivePanel={setActivePanel}
              onOpenFullSettings={openSettings}
              onBack={closeBook}
            />
          )}
        </AnimatedSwap>
        {/* Mounted at the app root so a docx import keeps showing across the
            Library → Reader transition (e.g. user clicks "Continue in
            background" then opens an existing book while the import finishes). */}
        <ImportProgress theme={theme} />
        {/* Image lightbox — opens when a chapter image is tapped, anywhere. */}
        <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={closeLightbox} />
      </div>
    </I18nProvider>
  );
}

function FullPageSpinner({
  theme,
  label,
}: {
  theme: { bg: string; ink: string; muted: string };
  label: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: theme.bg,
        color: theme.ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT_SERIF_DISPLAY,
        fontStyle: "italic",
        fontSize: 20,
        zIndex: 40,
      }}
    >
      {label}
    </div>
  );
}

export default App;
