import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedSwap } from "./components/AnimatedSwap";
import { useLaunchIntent } from "./hooks/useLaunchIntent";
import { DesktopReader } from "./components/DesktopReader";
import { ImportProgress } from "./components/ImportProgress";
import { Library } from "./components/Library";
import { Lightbox } from "./components/Lightbox";
import { MobileReader } from "./components/MobileReader";
import { SourceStreamReader } from "./components/SourceStreamReader";
import { startDownloadNotifier } from "./store/downloadNotifier";
import { loadPersistedQueue } from "./store/downloadQueue";
import type { EpubBook } from "./epub/types";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useTweaks } from "./hooks/useTweaks";
import { close as closeLightbox, useLightbox } from "./store/lightbox";
import {
  deleteHighlights,
  loadBook,
  markBookOpened,
  saveHighlight,
  updateHighlightNote,
  updateParagraphPosition,
  updateReadingPosition,
  type BookState,
  type Highlight,
} from "./store/library";
import { MOTION, useReducedMotion } from "./styles/motion";
import type { HighlightColor } from "./styles/tokens";
import { FONT_SERIF_DISPLAY, FONT_STACKS, THEMES } from "./styles/tokens";
import type { ActivePanel } from "./types/reader";

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
  const [t, setTweak] = useTweaks();
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

  // Phones in landscape exceed 720px wide but still need the mobile reader
  // (tap-to-toggle chrome, single-column layout). Treat any coarse-pointer
  // device with a short viewport as mobile too.
  const isMobile = useMediaQuery(
    "(max-width: 720px), (pointer: coarse) and (max-height: 480px)",
  );
  const themeKey = t.theme;
  const theme = THEMES[themeKey];

  useEffect(() => {
    document.body.style.background = theme.bg;
    document.body.style.color = theme.ink;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (meta) meta.content = theme.bg;
  }, [theme.bg, theme.ink]);

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
        return { ...prev, currentChapter: clamped, resumeParagraph: 0 };
      });
    },
    [],
  );

  // Debounce paragraph saves so we don't hammer disk on every scroll event.
  const paragraphSaveTimer = useRef<number | null>(null);
  const onParagraphChange = useCallback((idx: number) => {
    if (paragraphSaveTimer.current)
      clearTimeout(paragraphSaveTimer.current);
    paragraphSaveTimer.current = window.setTimeout(() => {
      paragraphSaveTimer.current = null;
      setLoaded((prev) => {
        if (!prev) return prev;
        if (prev.state.paragraphIndex === idx) return prev;
        void updateParagraphPosition(prev.book.id, idx);
        return { ...prev, state: { ...prev.state, paragraphIndex: idx } };
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
    <div
      // Keep the app shell LTR — BookBody sets its own `dir` so the book
      // content flips to RTL while the surrounding reader UI (settings
      // panel, TOC, header, buttons) stays in its natural left-to-right
      // orientation.
      dir="ltr"
      style={{
        width: "100%",
        height: "100%",
        background: theme.bg,
        color: theme.ink,
        overflow: "hidden",
      }}
    >
      {loading && <FullPageSpinner theme={theme} label="Loading book…" />}
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
          inReader ? (isMobile ? "reader-mobile" : "reader-desktop") : "library"
        }
      >
        {!inReader ? (
          <Library
            theme={theme}
            themeKey={themeKey}
            setTweak={setTweak}
            layout={isMobile ? "mobile" : "desktop"}
            onOpen={openBook}
            onStreamRead={openStream}
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
            jumpNonce={loaded!.jumpNonce}
            onChapterChange={changeChapter}
            onParagraphChange={onParagraphChange}
            onCreateHighlight={createHighlight}
            onDeleteHighlight={removeHighlight}
            onUpdateHighlightNote={editHighlightNote}
            onJumpToHighlight={jumpToHighlight}
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
            jumpNonce={loaded!.jumpNonce}
            onChapterChange={changeChapter}
            onParagraphChange={onParagraphChange}
            onCreateHighlight={createHighlight}
            onDeleteHighlight={removeHighlight}
            onUpdateHighlightNote={editHighlightNote}
            onJumpToHighlight={jumpToHighlight}
            activePanel={activePanel}
            setActivePanel={setActivePanel}
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
