import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { AnimatedSwap } from "./components/AnimatedSwap";
import { markBoot, readPreviousLaunch } from "./lib/diagnostics/breadcrumbs";
import { record, setVerbose } from "./lib/diagnostics/recorder";
import {
  flushSession,
  installErrorCapture,
  startSession,
} from "./lib/diagnostics/store";
import { useLaunchIntent } from "./hooks/useLaunchIntent";
import { useIncomingFiles } from "./hooks/useIncomingFiles";
import { useBackgroundImportHost } from "./hooks/useBackgroundImportHost";
import { useFileDrop } from "./hooks/useFileDrop";
import { useDropOverlayState } from "./store/dropOverlay";
import { DesktopReader } from "./components/DesktopReader";
import { DropOverlay } from "./components/DropOverlay";
import { ImportProgress } from "./components/ImportProgress";
import { BackgroundImportToast } from "./components/BackgroundImportToast";
import { Library } from "./components/library/Library";
import { Lightbox } from "./components/Lightbox";
import { MobileReader } from "./components/MobileReader";
import { LazyViewFallback } from "./components/LazyViewFallback";
import { ReaderErrorBoundary } from "./components/ReaderErrorBoundary";
import { ReaderFallback } from "./components/ReaderFallback";
import { SettingsPage } from "./components/SettingsPage";
import { createPdfPageSource } from "./reader/fixed/PdfPageSource";
import { createDocxPageSource } from "./reader/fixed/DocxPageSource";
import { startBackgroundTaskCoordinator } from "./store/backgroundTasks";
import { startDownloadNotifier } from "./store/downloadNotifier";
import {
  loadPersistedQueue,
  setDownloadConcurrency,
  setWifiOnlyDownloads,
} from "./store/downloadQueue";
import type { EpubBook } from "./epub/types";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useReseedOnChange } from "./hooks/useReseedOnChange";
import { useTweaks } from "./hooks/useTweaks";
import { useWakeLock } from "./hooks/useWakeLock";
import { close as closeLightbox, useLightbox } from "./store/lightbox";
import {
  useNav,
  goReader,
  goSettings,
  openOverlay,
  back,
} from "./store/navigation";
import { installNavInput } from "./store/navInput";
import {
  deleteHighlights,
  getEntry,
  listBooks,
  loadBook,
  docxBlockMap,
  loadDocxFlowBook,
  setDocxReadingMode,
  loadFixedBook,
  markBookOpened,
  saveHighlight,
  updateHighlightNote,
  updatePagePosition,
  updatePageProgress,
  updateParagraphPosition,
  updateReadingPosition,
  type BookState,
  type DocxHighlightAnchor,
  type FixedBook,
  type Highlight,
  type PdfHighlightAnchor,
} from "./store/library";
import {
  MOTION,
  setReduceMotionOverride,
  useReducedMotion,
} from "./styles/motion";
import { installOverlayScrollbar } from "./styles/overlayScrollbar";
import type { HighlightColor } from "./styles/tokens";
import {
  FONT_READING_SANS,
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  THEMES,
  UI_FONT_ADJUST,
  UI_FONT_STACKS,
  Z,
  resolveTheme,
} from "./styles/tokens";
import type { ActivePanel } from "./types/reader";
import { I18nProvider } from "./i18n/I18nProvider";
import { detectLocale, DIR_FOR, makeTr } from "./i18n";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { DesktopUpdateLayer } from "./components/update/DesktopUpdateLayer";
import { ManualUpdateBanner, UpdatePill } from "./components/update/UpdatePill";
import { UpdateSheet, UpdateToasts } from "./components/update/UpdateSheet";
import {
  configure as configureAndroidUpdate,
  loadChannel as loadAndroidChannel,
  offer as offerAndroidUpdate,
} from "./store/androidUpdate";
import {
  configure as configureDesktopUpdate,
  offer as offerDesktopUpdate,
} from "./store/desktopUpdate";
import {
  WhatsNewAfterUpdate,
  bundledNotes,
} from "./components/update/WhatsNewAfterUpdate";
import { shouldShowWhatsNew } from "./store/whatsNew";
import { appVersion } from "virtual:whats-new";

// Kept off the startup path — neither of these is needed to paint the library,
// and a user who only reads EPUBs from their device never loads either.
// `src/bundleSplit.test.ts` fails if a static import pulls them back in.
//
// The fixed reader's page-source factories (createPdfPageSource /
// createDocxPageSource above) stay eager on purpose: they're ~10 kB combined,
// and `createSource` is a synchronous prop, so deferring them would mean
// reshaping FixedPageReader's interface for no measurable gain. The bulk —
// FixedPageViewer, 32 kB — travels with FixedPageReader into its chunk.
const SourceStreamReader = lazy(() =>
  import("./components/SourceStreamReader").then((m) => ({
    default: m.SourceStreamReader,
  })),
);
const FixedPageReader = lazy(() =>
  import("./reader/fixed/FixedPageReader").then((m) => ({
    default: m.FixedPageReader,
  })),
);

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

/** State for an open fixed-layout (PDF/DOCX) book. Kept separate from `Loaded`
 *  (the reflowable path) so the EPUB reader's handlers stay untouched. */
interface LoadedFixed {
  book: FixedBook;
  state: BookState;
}

function App() {
  // Listen for Android launch-intent extras (e.g., notification taps
  // routing to the download queue). Has to live above the Library so
  // any emitted intents reach the Library's subscriber.
  useLaunchIntent();
  // Files handed to us from outside — Open with, the Android share sheet,
  // a drag-and-drop — into the incoming-files buffer, which the background
  // importer (useBackgroundImportHost, below) drains.
  useIncomingFiles();
  const [t, setTweak, applyTweaks] = useTweaks();

  // The recorder's tier, restored from the persisted tweak.
  //
  // Its one consumer is hostile to arriving late: DesktopReader's
  // session-start effect (DesktopReader.tsx) reads the tier synchronously on
  // mount and is keyed to [book.id], so a tier that lands after it doesn't
  // just land late — that book records no geometry at all for the rest of the
  // session, with the switch in Settings showing On. Nothing about that is
  // visible from the UI.
  //
  // Declaration order is NOT what protects that. React flushes passive
  // effects depth-first, child BEFORE parent: any reader mounted in App's
  // first commit would run its session-start effect before this one, however
  // high up the file this sits. What actually saves it is that `loaded`
  // starts null (below) and is only ever filled from the async openBook path
  // — including the startupView:"resume" route, which awaits listBooks() — so
  // there is no reader in the first commit for the ordering to matter to.
  //
  // So: if anyone ever opens a book synchronously (a lazy useState
  // initialiser, a book hydrated from cache during render), this effect is
  // too late and the tier has to be applied before React renders at all.
  // Being above the boot effect is only about the session log itself.
  //
  // Kept as its own effect rather than a line inside the toggle's handler so
  // the paths that change the tweak WITHOUT touching the switch — Import
  // settings, Reset to defaults — apply it too.
  useEffect(() => {
    setVerbose(t.verboseDiagnostics);
  }, [t.verboseDiagnostics]);

  // Breadcrumb 4 of 4, and the start of the session log.
  //
  // This runs after the first commit, so reaching it means a frame really
  // did reach the screen.
  //
  // The previous launch's record was rotated aside by index.html before this
  // launch wrote its first mark — it cannot be rotated from here, because a
  // launch that stalls never reaches this code to rotate anything. So this
  // only reads the verdict; see index.html and breadcrumbs.ts.
  //
  // Everything except the mark is deliberately AFTER it: markBoot is
  // synchronous and IPC-free, while startSession crosses the bridge. If the
  // bridge is dead the mark is still on record, which is the whole design.
  useEffect(() => {
    markBoot("mounted");
    const previous = readPreviousLaunch();
    const uninstall = installErrorCapture();
    void startSession().then(() => {
      if (previous && !previous.ok) {
        record("previousLaunchBlank", {
          reached: previous.reached,
          stalledAt: previous.stalledAt,
          durationMs: previous.durationMs,
        });
      }
      return flushSession();
    });
    const timer = window.setInterval(() => void flushSession(), 2000);
    return () => {
      window.clearInterval(timer);
      uninstall();
      void flushSession();
    };
  }, []);

  const update = useUpdateCheck(t, setTweak);
  // Decided synchronously at first render from versions alone: nothing is
  // awaited before paint, and it works whoever performed the update.
  const [whatsNewOpen, setWhatsNewOpen] = useState(() =>
    shouldShowWhatsNew({
      bundled: bundledNotes?.version ?? null,
      lastSeen: t.lastSeenWhatsNew,
    }),
  );
  // Stable, so the dialogs' Escape listeners are not re-added every render.
  const closeWhatsNew = useCallback(() => {
    setWhatsNewOpen(false);
    setTweak("lastSeenWhatsNew", appVersion);
  }, [setTweak]);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadedFixed, setLoadedFixed] = useState<LoadedFixed | null>(null);
  const lightbox = useLightbox();

  // Navigation is the single source of truth for which destination is shown.
  // `base` drives App's top-level view swap (Library / Reader / Settings);
  // `overlay` layers the streaming reader (and, inside Library, the download
  // queue) on top without unmounting the base underneath.
  const nav = useNav();
  const base = nav.snapshot.base;
  const overlay = nav.snapshot.overlay;
  const streaming = overlay?.kind === "stream" ? overlay : null;

  // Streaming reader — opened from the Store when the user clicks "Read" on a
  // novel detail page. Rendered as an overlay so the Library (with the open
  // novel detail) stays mounted underneath; Back closes it and returns there.
  const openStream = useCallback(
    (sourceId: string, novelUrl: string, chapterId?: number) =>
      openOverlay({ kind: "stream", sourceId, novelUrl, chapterId }),
    [],
  );
  const closeStream = useCallback(() => back(), []);

  // Settings is a top-level base destination (peer of Library/Reader). Opening
  // it pushes a history entry; Back pops to whatever was showing before.
  const openSettings = useCallback(() => goSettings(), []);
  const closeSettings = useCallback(() => back(), []);

  // Phones in landscape exceed 720px wide but still need the mobile reader
  // (tap-to-toggle chrome, single-column layout). Treat any coarse-pointer
  // device with a short viewport as mobile too.
  //
  // 719.98, not 720: the desktop window's minWidth is 720 (tauri.conf.json),
  // and an inclusive 720 meant dragging the window to its narrowest flipped
  // the whole app into the phone UI — bottom tab bar, remounted sidebar — and
  // back again one pixel wider. A desktop window now never reaches it.
  const isMobile = useMediaQuery(
    "(max-width: 719.98px), (pointer: coarse) and (max-height: 480px)",
  );
  // Drag-and-drop is desktop-only: Android has no pointer drag onto the
  // window, and Tauri emits no drag events there. Gate on the actual OS via
  // plugin-os's platform() — NOT window width. `isMobile` is a media query
  // (narrow width OR coarse pointer + short viewport), so it breaks in both
  // directions here: a desktop user narrowing the window past 720px (normal
  // for side-by-side reading) would silently lose drag-and-drop, and a
  // large Android tablet in landscape reports isMobile === false, which
  // would subscribe the hook on a platform that never emits the events.
  //
  // platform() itself is synchronous (it reads a value the plugin stashes
  // at webview init, not an IPC round-trip) but throws outside a real Tauri
  // webview — e.g. `pnpm dev` in a plain browser — so it's wrapped the same
  // defensive way backgroundTasks.ts's isAndroid() and
  // downloadNotifier/transport.ts's getPlatform() are. Lazy useState
  // initializer: runs once, no need for an effect since there's nothing
  // async to wait on.
  const [dropCapable] = useState(() => {
    try {
      // Mirrors the Rust `desktop` cfg alias (not(any(android, ios))) —
      // ios has no gen/ scaffold yet, but the exclusion is cheap and keeps
      // this in lockstep with the backend's own definition of "desktop".
      const p = platform();
      return p !== "android" && p !== "ios";
    } catch {
      return false;
    }
  });
  useFileDrop(dropCapable);
  // The in-app update flow: Android has the pill, sheet and Settings card;
  // desktop (dropCapable: not android, not ios) has the sidebar card and its
  // dialogs. Same defensive platform() read as dropCapable.
  const [isAndroid] = useState(() => {
    try {
      return platform() === "android";
    } catch {
      return false;
    }
  });
  // Fed after paint, never awaited: the store only reacts to these.
  useEffect(() => {
    if (!isAndroid) return;
    configureAndroidUpdate({
      running: appVersion,
      skipped: t.skippedUpdateVersion,
      pref: t.updateOverMobile,
      saveSkipped: (v) => setTweak("skippedUpdateVersion", v),
    });
  }, [isAndroid, t.skippedUpdateVersion, t.updateOverMobile, setTweak]);
  // Who updates this install, for Settings → About, whether or not an
  // update is offered.
  useEffect(() => {
    if (isAndroid) void loadAndroidChannel();
  }, [isAndroid]);
  useEffect(() => {
    if (isAndroid && update.info) void offerAndroidUpdate(update.info);
  }, [isAndroid, update.info]);
  // Desktop: the same skip tweak and clear-skip rule, fed after paint.
  useEffect(() => {
    if (!dropCapable) return;
    configureDesktopUpdate({
      running: appVersion,
      skipped: t.skippedUpdateVersion,
      saveSkipped: (v) => setTweak("skippedUpdateVersion", v),
    });
  }, [dropCapable, t.skippedUpdateVersion, setTweak]);
  useEffect(() => {
    if (dropCapable && update.info) void offerDesktopUpdate(update.info);
  }, [dropCapable, update.info]);
  const dropState = useDropOverlayState();
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
    // Publish the theme-aware values that plain CSS needs (it can't read the
    // inline `theme` object). global.css consumes these for `::placeholder`
    // and the overlay scrollbar so every input/scroll area themes in lock-step
    // instead of relying on browser defaults (which render the placeholder as
    // a bright tint of `ink` in dark mode — like pre-filled text).
    //
    // The bar takes `muted` rather than `ruleStrong`: it's a solid value, so
    // the overlay's own opacity is free to carry the translucency (an
    // alpha-baked colour can only ever get more opaque, never less).
    const root = document.documentElement.style;
    root.setProperty("--ph", theme.muted);
    root.setProperty("--sb-thumb", theme.muted);
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (meta) meta.content = theme.bg;
    // Match the Android status/navigation-bar icon contrast to the
    // in-app theme. Light themes (light, sepia) need dark icons; dark
    // themes (dark, oled) need light icons. The OS DayNight setting
    // would otherwise leave white icons on a light bar. No-op / silent
    // throw off Android — invoke just rejects and we ignore it.
    //
    // `background` is stashed natively and painted as the launch window on
    // the next cold start, so startup no longer shows a black frame in front
    // of the app while the webview boots.
    const darkIcons = themeKey === "light" || themeKey === "sepia";
    void invoke("set_status_bar_style", {
      darkIcons,
      background: theme.bg,
    }).catch(() => {});
    // Desktop: paint the native window itself in the theme's background.
    // Whenever the webview does not cover the window — a frame of a
    // maximize or full-screen animation, a resize the webview has not caught
    // up with — that bare window shows through, and the OS default is a grey
    // that reads as a broken band across the app. `dropCapable` is the
    // desktop-OS check (see above).
    if (dropCapable) {
      void getCurrentWindow()
        .setBackgroundColor(theme.bg)
        .catch(() => {});
    }
  }, [theme.bg, theme.ink, theme.muted, themeKey, dropCapable]);

  // Overlay scrollbars for every scroll area in the app: a slim, translucent
  // bar that floats over the content while scrolling and fades once it stops.
  // One delegated listener, installed once — see styles/overlayScrollbar.ts.
  useEffect(() => installOverlayScrollbar(), []);

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
    // Per-font glyph-size normalization: keeps each UI font's apparent size
    // consistent WITHOUT changing the layout (font-size-adjust only scales
    // glyph rendering). Book content opts out (font-size-adjust:none).
    document.documentElement.style.setProperty(
      "--ui-font-adjust",
      String(UI_FONT_ADJUST[t.uiFont] ?? 0.525),
    );
  }, [t.uiFont]);

  // App-level reduce-motion override ("auto" = follow the OS). Composes on
  // top of the OS preference inside useReducedMotion via a tiny pub-sub, so
  // every call site (AnimatedSwap, panels, readers) picks it up.
  useEffect(() => {
    setReduceMotionOverride(t.reduceMotion);
  }, [t.reduceMotion]);

  // Keyboard and mouse back/forward (see navInput.ts for the side-button
  // story). Android's hardware Back arrives as popstate instead.
  useEffect(() => installNavInput(), []);

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
      try {
        await loadPersistedQueue();
      } catch (e) {
        // A queue file that cannot be read must not take the other two
        // down with it. Without them the session has no tray progress for
        // downloads and no background task at all, and the rejection was
        // also unhandled — surfacing only as a console warning at launch.
        console.error("[downloads] could not restore the persisted queue:", e);
      }
      startDownloadNotifier();
      startBackgroundTaskCoordinator();
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
  /** openBook is defined below switchDocxMode; a ref avoids reordering the
   *  file just to satisfy declaration order. */
  const openBookRef = useRef<((id: string) => Promise<void>) | null>(null);
  /** Id of the DOCX currently open in flowing text, if any. The reflowable
   *  readers serve EPUBs too, so they need this to know whether to offer the
   *  layout toggle — and, crucially, the way back to pages. */
  const [flowDocxId, setFlowDocxId] = useState<string | null>(null);
  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Switch a DOCX between fixed pages and flowing text.
   *
   * The blockMap comes from building the flow document either way — it is
   * the only thing that knows which top-level block each paragraph came
   * from, and that is what carries the reading position across. Re-opening
   * the book is what swaps the reader; `setDocxReadingMode` has already
   * rewritten the position by then, so it resumes in the new mode where the
   * old one left off.
   */
  const switchDocxMode = useCallback(
    async (id: string, to: "pages" | "flow", from: "pages" | "flow") => {
      // SegRow fires for the already-selected option too. Re-running the
      // switch would reparse the document twice and remount the reader for
      // nothing, losing up to 600ms of debounced scroll position on the way.
      if (to === from) return;
      try {
        const { blockMap } = await loadDocxFlowBook(id, (n) =>
          tr("reader.chapterNumber", { n }),
        );
        await setDocxReadingMode(id, to, blockMap);
        await openBookRef.current?.(id);
      } catch (e) {
        // A failed switch must not strand the reader on a blank view: the
        // book is still open in the mode it was already in.
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [tr],
  );

  const openBook = useCallback(
    async (id: string) => {
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      setLoading(true);
      setError(null);
      try {
        // Route fixed-layout books (PDF/DOCX) to their own reader; everything
        // else stays on the reflowable EPUB path. Stamp `lastReadAt` on open so
        // the Library's "Continue reading" hero picks the just-opened book.
        const entry = await getEntry(id);
        await markBookOpened(id);
        // A DOCX the reader has switched to flowing text goes down the
        // reflowable path instead, built from the same content.html the
        // fixed reader paginates. Absent readingMode means "pages", so
        // every DOCX imported before this existed is unaffected.
        const isFixed = entry?.kind === "pdf" || entry?.kind === "docx";
        // Read once and keep it: the pages branch below needs the same two
        // files this probe already opened.
        const fixed = isFixed ? await loadFixedBook(id) : null;
        // A flow DOCX is built from the same content.html the fixed reader
        // paginates. If that build fails — the file is gone, book.json is
        // malformed — fall back to pages rather than stranding the book: the
        // toggle that would set the mode back lives inside the reader that
        // could not open, so an unguarded throw here is unrecoverable without
        // a re-import.
        let flow: Awaited<ReturnType<typeof loadDocxFlowBook>> | null = null;
        if (entry?.kind === "docx" && fixed?.state.readingMode === "flow") {
          try {
            flow = await loadDocxFlowBook(id, (n) =>
              tr("reader.chapterNumber", { n }),
            );
          } catch (e) {
            // Fall back to pages so the book still opens — but SAY SO. A
            // silent fallback is indistinguishable from the toggle not
            // working: the mode is set on disk, the reader shows pages, and
            // nothing anywhere explains why.
            flow = null;
            // eslint-disable-next-line no-console
            console.error("[docx] flow mode failed, falling back to pages:", e);
            setError(e instanceof Error ? e.message : String(e));
          }
        }
        // Pages mode: bridge the other way, so a highlight made in flowing
        // text is visible here and the panel can jump to it. Costs one parse
        // of content.html, on open of a DOCX that has highlights at all.
        if (!flow && fixed && entry?.kind === "docx") {
          const needsBridge = fixed.state.highlights.some(
            (h) => !h.fixed && h.charEnd > h.charStart,
          );
          if (needsBridge) {
            try {
              const [{ bridgeDocxHighlights }, blockMap] = await Promise.all([
                import("./docx/highlightBridge"),
                docxBlockMap(id),
              ]);
              fixed.state = {
                ...fixed.state,
                highlights: bridgeDocxHighlights(
                  fixed.state.highlights,
                  blockMap,
                ),
              };
            } catch (e) {
              // Highlights are an enhancement; the book still opens without
              // the bridge. Never let this path block reading.
              // eslint-disable-next-line no-console
              console.warn("[docx] could not bridge highlights:", e);
            }
          }
        }
        if (flow) {
          setFlowDocxId(id);
          const { book, state } = flow;
          setLoadedFixed(null);
          setLoaded({
            book,
            state,
            currentChapter: state.currentChapter,
            resumeParagraph: state.paragraphIndex,
            resumeOffset: state.paragraphOffset ?? 0,
            jumpNonce: 0,
          });
        } else if (fixed) {
          setFlowDocxId(null);
          setLoaded(null);
          setLoadedFixed(fixed);
        } else {
          setFlowDocxId(null);
          const { book, state } = await loadBook(id);
          setLoadedFixed(null);
          setLoaded({
            book,
            state,
            currentChapter: state.currentChapter,
            resumeParagraph: state.paragraphIndex,
            resumeOffset: state.paragraphOffset ?? 0,
            jumpNonce: 0,
          });
        }
        setActivePanel(null);
        // Data is ready — now flip the base to the reader so the crossfade
        // lands on a fully-loaded view (no blank frame). A no-op push when
        // we're already on this reader entry (the restore path below).
        goReader(id);
        // Keep the spinner up over the AnimatedSwap crossfade so the
        // user doesn't catch the Library through the reader's fade-in.
        // The delay matches the .riwaq-view-enter keyframe (MOTION.med
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
  openBookRef.current = openBook;
  // Books opened from outside import here, whichever screen is up — see
  // store/backgroundImport.ts.
  useBackgroundImportHost(openBookRef, tr);

  // Reader data is keyed to the nav location. The common path (openBook) loads
  // first, then navigates — so this effect no-ops there. It's the safety net
  // for the other direction: landing on a reader entry WITHOUT its data (a
  // browser-forward back into a book, or a dev reload) loads it; leaving the
  // reader drops the data so a later re-open starts fresh.
  const readerBookId = base.screen === "reader" ? base.bookId : null;
  useEffect(() => {
    if (readerBookId == null) {
      setLoaded(null);
      setLoadedFixed(null);
      setActivePanel(null);
      setError(null);
      return;
    }
    if (
      loaded?.book.id === readerBookId ||
      loadedFixed?.book.id === readerBookId
    )
      return;
    void openBook(readerBookId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerBookId]);

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

  // Back out of the reader by popping history — returns to wherever the book
  // was opened from (shelf, search, a novel detail…). The reader-location
  // effect above clears the loaded book once the base leaves the reader.
  const closeBook = useCallback(() => back(), []);

  const changeChapter = useCallback((order: number) => {
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
  }, []);

  // Debounce paragraph saves so we don't hammer disk on every scroll event.
  const paragraphSaveTimer = useRef<number | null>(null);
  // Where the reader is right now, ahead of the debounced save. A layout flip
  // mounts a fresh reader, and it has to start here — see the reseed below.
  // Stamped with the book, chapter and jump it was reported under: opening a
  // book, changing chapter or jumping to a highlight sets a new resume hint,
  // and a position reported before that no longer applies. The stamp retires
  // it without every one of those paths having to clear it by hand.
  const livePara = useRef<{
    bookId: string;
    chapter: number;
    jumpNonce: number;
    idx: number;
    off: number;
  } | null>(null);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const onParagraphChange = useCallback((idx: number, offset?: number) => {
    const l = loadedRef.current;
    if (l) {
      livePara.current = {
        bookId: l.book.id,
        chapter: l.currentChapter,
        jumpNonce: l.jumpNonce,
        idx,
        off: offset ?? 0,
      };
    }
    if (paragraphSaveTimer.current) clearTimeout(paragraphSaveTimer.current);
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

  // Position reports are taken only from the reader of the CURRENT layout.
  // A layout flip crossfades the two readers, and the outgoing one stays
  // mounted for that fade at the new window size: its text reflows under an
  // unchanged scrollTop, and its scroll listener reports whatever paragraph
  // now sits at its top. Measured: reading at paragraph 35, a mobile -> desktop
  // flip saved paragraph 115. Read through a ref, so a report that lands after
  // the flip's render is judged by the layout it lands in.
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  const reportFrom = useMemo(
    () => ({
      mobile: (idx: number, offset?: number) => {
        if (isMobileRef.current) onParagraphChange(idx, offset);
      },
      desktop: (idx: number, offset?: number) => {
        if (!isMobileRef.current) onParagraphChange(idx, offset);
      },
    }),
    [onParagraphChange],
  );

  useEffect(() => {
    return () => {
      if (paragraphSaveTimer.current) clearTimeout(paragraphSaveTimer.current);
    };
  }, []);

  // Debounced persistence of fixed-page (PDF/DOCX) reading position + progress.
  const pageSaveTimer = useRef<number | null>(null);
  const savePagePosition = useCallback(
    (
      bookId: string,
      pageCount: number,
      page: number,
      pageOffset: number,
      blockId?: string,
    ) => {
      if (pageSaveTimer.current) clearTimeout(pageSaveTimer.current);
      pageSaveTimer.current = window.setTimeout(() => {
        pageSaveTimer.current = null;
        void updatePagePosition(
          bookId,
          page,
          pageOffset,
          // The portable half of the position. Without it `fixedAnchor` is
          // never written, and a switch to flowing text has nothing to
          // translate — it would always land on the first paragraph.
          blockId ? { blockId, frac: pageOffset } : undefined,
        );
        void updatePageProgress(bookId, page, pageCount);
      }, 600);
    },
    [],
  );
  useEffect(() => {
    return () => {
      if (pageSaveTimer.current) clearTimeout(pageSaveTimer.current);
    };
  }, []);

  // A layout flip (rotation, fold/unfold, split-screen, a desktop window
  // dragged across 720px) swaps MobileReader for DesktopReader, and a fresh
  // reader starts at its resume hint — the place the book was OPENED at. Move
  // the hint to where the reader actually is first, or the flip throws them
  // back and the new reader saves that over their real position.
  useReseedOnChange(isMobile, () => {
    const para = livePara.current;
    if (!para) return;
    setLoaded((prev) =>
      prev &&
      para.bookId === prev.book.id &&
      para.chapter === prev.currentChapter &&
      para.jumpNonce === prev.jumpNonce
        ? { ...prev, resumeParagraph: para.idx, resumeOffset: para.off }
        : prev,
    );
  });

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

  // Fixed-layout (PDF/DOCX) highlight handlers. The EPUB handlers above operate
  // on `loaded`, which is null for a fixed book — these mirror them against
  // `loadedFixed`. Fixed highlights carry a `fixed` anchor and leave the reflow
  // fields (chapter/paragraph/char) at 0.
  const createFixedHighlight = useCallback(
    async (h: {
      text: string;
      color: HighlightColor;
      note?: string;
      groupId?: string;
      fixed: DocxHighlightAnchor | PdfHighlightAnchor;
    }) => {
      if (!loadedFixed) return;
      const saved = await saveHighlight(loadedFixed.book.id, {
        chapter: 0,
        paragraphIndex: 0,
        charStart: 0,
        charEnd: 0,
        text: h.text,
        color: h.color,
        note: h.note,
        groupId: h.groupId,
        fixed: h.fixed,
      });
      setLoadedFixed((prev) =>
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
    [loadedFixed],
  );

  const removeFixedHighlight = useCallback(
    async (highlightId: string) => {
      if (!loadedFixed) return;
      const target = loadedFixed.state.highlights.find(
        (h) => h.id === highlightId,
      );
      if (!target) return;
      const ids = target.groupId
        ? loadedFixed.state.highlights
            .filter((h) => h.groupId === target.groupId)
            .map((h) => h.id)
        : [highlightId];
      await deleteHighlights(loadedFixed.book.id, ids);
      const idSet = new Set(ids);
      setLoadedFixed((prev) =>
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
    [loadedFixed],
  );

  const editFixedHighlightNote = useCallback(
    async (highlightId: string, note: string) => {
      if (!loadedFixed) return;
      const trimmed = note.trim();
      await updateHighlightNote(loadedFixed.book.id, highlightId, trimmed);
      setLoadedFixed((prev) =>
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
    [loadedFixed],
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
        {isAndroid ? (
          <>
            {/* Over the library's shelves only: not over a book, the
                downloads page, or a novel's detail page (which has no
                bottom bar to sit above). */}
            {base.screen === "library" &&
              !overlay &&
              base.view.kind !== "novel" &&
              base.view.kind !== "downloads" && (
                <UpdatePill
                  theme={theme}
                  layout={isMobile ? "mobile" : "desktop"}
                />
              )}
            <UpdateSheet theme={theme} themeKey={themeKey} />
            <UpdateToasts
              theme={theme}
              layout={isMobile ? "mobile" : "desktop"}
            />
            {/* Install source unknown: the release-page link, as before. */}
            {update.info && (
              <ManualUpdateBanner
                info={update.info}
                theme={theme}
                onDismiss={update.dismiss}
              />
            )}
          </>
        ) : null}
        {dropCapable && <DesktopUpdateLayer theme={theme} />}
        <WhatsNewAfterUpdate
          theme={theme}
          open={whatsNewOpen}
          onClose={closeWhatsNew}
          layout={isMobile ? "mobile" : "desktop"}
        />
        {loading && (
          <FullPageSpinner theme={theme} label={tr("app.loadingBook")} />
        )}
        {error && !loading && (
          <div
            style={{
              position: "absolute",
              top: 20,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: Z.hint,
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
            zIndex: Z.streamLayer,
            pointerEvents: streaming ? "auto" : "none",
          }}
        >
          <AnimatedSwap viewKey={streaming ? "stream" : "none"}>
            {streaming ? (
              <ReaderErrorBoundary theme={theme} onBack={closeStream}>
                <Suspense fallback={<LazyViewFallback background={theme.bg} />}>
                  <SourceStreamReader
                    theme={theme}
                    themeKey={themeKey}
                    t={t}
                    setTweak={setTweak}
                    layout={isMobile ? "mobile" : "desktop"}
                    sourceId={streaming.sourceId}
                    novelUrl={streaming.novelUrl}
                    startChapterId={streaming.chapterId}
                    onClose={closeStream}
                  />
                </Suspense>
              </ReaderErrorBoundary>
            ) : null}
          </AnimatedSwap>
        </div>
        {/* Library ↔ Reader transition. viewKey is derived from the open
            book + layout so a layout change (e.g., rotating into landscape
            on mobile-landscape) ALSO crossfades cleanly. */}
        <AnimatedSwap
          viewKey={
            // On the phone, Settings is a tab of the same home shell as the
            // Library (with the bottom bar): one key, so moving between
            // them is the shell's own transition, not a cross-fade of two
            // screens.
            base.screen === "settings" && !isMobile
              ? "settings"
              : base.screen === "reader"
                ? // The fixed reader is one component for both layouts and
                  // takes `layout` as a prop, so it keeps its key and is NOT
                  // remounted by a flip — it keeps its page and its decoded
                  // pages. The flowing readers are two components; their key
                  // has to change, and useReseedOnChange carries the position.
                  loadedFixed?.book.id === base.bookId
                  ? "reader-fixed"
                  : isMobile
                    ? "reader-mobile"
                    : "reader-desktop"
                : "library"
          }
        >
          {base.screen === "settings" && !isMobile ? (
            <SettingsPage
              theme={theme}
              themeKey={themeKey}
              t={t}
              setTweak={setTweak}
              applyTweaks={applyTweaks}
              layout={isMobile ? "mobile" : "desktop"}
              onClose={closeSettings}
              onCheckUpdates={update.check}
              updateChecking={update.checking}
              updateResult={update.result}
              onOpenWhatsNew={
                bundledNotes ? () => setWhatsNewOpen(true) : undefined
              }
              android={isAndroid}
              desktopUpdates={dropCapable}
            />
          ) : base.screen === "library" || base.screen === "settings" ? (
            <Library
              theme={theme}
              themeKey={themeKey}
              layout={isMobile ? "mobile" : "desktop"}
              view={base.screen === "library" ? base.view : { kind: "shelf" }}
              settingsTab={
                base.screen === "settings" ? (
                  <SettingsPage
                    theme={theme}
                    themeKey={themeKey}
                    t={t}
                    setTweak={setTweak}
                    applyTweaks={applyTweaks}
                    layout="mobile"
                    embedded
                    category={base.category}
                    onClose={closeSettings}
                    onCheckUpdates={update.check}
                    updateChecking={update.checking}
                    updateResult={update.result}
                    onOpenWhatsNew={
                      bundledNotes ? () => setWhatsNewOpen(true) : undefined
                    }
                    android={isAndroid}
                    desktopUpdates={dropCapable}
                  />
                ) : undefined
              }
              onOpen={openBook}
              onStreamRead={openStream}
              streamActive={streaming !== null}
              onOpenSettings={openSettings}
              confirmDelete={t.confirmDelete}
              heroStyle={t.heroStyle}
              homeBar={t.homeBar}
            />
          ) : loadedFixed && loadedFixed.book.id === base.bookId ? (
            <Suspense fallback={<LazyViewFallback background={theme.bg} />}>
              <FixedPageReader
                sourceKey={`${t.fontFamily}|${t.fontSize}`}
                docxMode={
                  loadedFixed.book.kind === "docx" ? "pages" : undefined
                }
                onDocxModeChange={
                  loadedFixed.book.kind === "docx"
                    ? (m) =>
                        void switchDocxMode(loadedFixed.book.id, m, "pages")
                    : undefined
                }
                theme={theme}
                themeKey={themeKey}
                t={t}
                setTweak={setTweak}
                book={loadedFixed.book}
                state={loadedFixed.state}
                highlights={loadedFixed.state.highlights}
                onCreateHighlight={createFixedHighlight}
                onDeleteHighlight={removeFixedHighlight}
                onUpdateHighlightNote={editFixedHighlightNote}
                layout={isMobile ? "mobile" : "desktop"}
                uiDir={uiDir}
                createSource={() => {
                  const b = loadedFixed.book;
                  return b.kind === "pdf"
                    ? createPdfPageSource(b)
                    : createDocxPageSource(b, {
                        fontFamily: t.fontFamily,
                        fontSize: t.fontSize,
                      });
                }}
                onLocationChange={(page, off, pageCount, blockId) =>
                  savePagePosition(
                    loadedFixed.book.id,
                    pageCount,
                    page,
                    off,
                    blockId,
                  )
                }
                onOpenFullSettings={openSettings}
                onBack={closeBook}
              />
            </Suspense>
          ) : loaded && loaded.book.id === base.bookId ? (
            <ReaderErrorBoundary theme={theme} onBack={closeBook}>
              {isMobile ? (
                <MobileReader
                  docxMode={loaded.book.id === flowDocxId ? "flow" : undefined}
                  onDocxModeChange={
                    loaded.book.id === flowDocxId
                      ? (m) => void switchDocxMode(loaded.book.id, m, "flow")
                      : undefined
                  }
                  theme={theme}
                  themeKey={themeKey}
                  t={t}
                  setTweak={setTweak}
                  book={loaded.book}
                  state={loaded.state}
                  currentChapter={loaded.currentChapter}
                  resumeParagraph={loaded.resumeParagraph}
                  resumeOffset={loaded.resumeOffset}
                  jumpNonce={loaded.jumpNonce}
                  onChapterChange={changeChapter}
                  onParagraphChange={reportFrom.mobile}
                  onCreateHighlight={createHighlight}
                  onDeleteHighlight={removeHighlight}
                  onUpdateHighlightNote={editHighlightNote}
                  onJumpToHighlight={jumpToHighlight}
                  nextChapterAvailability="device"
                  onOpenFullSettings={openSettings}
                  onBack={closeBook}
                />
              ) : (
                <DesktopReader
                  docxMode={loaded.book.id === flowDocxId ? "flow" : undefined}
                  onDocxModeChange={
                    loaded.book.id === flowDocxId
                      ? (m) => void switchDocxMode(loaded.book.id, m, "flow")
                      : undefined
                  }
                  theme={theme}
                  themeKey={themeKey}
                  t={t}
                  setTweak={setTweak}
                  book={loaded.book}
                  state={loaded.state}
                  currentChapter={loaded.currentChapter}
                  resumeParagraph={loaded.resumeParagraph}
                  resumeOffset={loaded.resumeOffset}
                  jumpNonce={loaded.jumpNonce}
                  onChapterChange={changeChapter}
                  onParagraphChange={reportFrom.desktop}
                  onCreateHighlight={createHighlight}
                  onDeleteHighlight={removeHighlight}
                  onUpdateHighlightNote={editHighlightNote}
                  onJumpToHighlight={jumpToHighlight}
                  nextChapterAvailability="device"
                  activePanel={activePanel}
                  setActivePanel={setActivePanel}
                  onOpenFullSettings={openSettings}
                  onBack={closeBook}
                />
              )}
            </ReaderErrorBoundary>
          ) : (
            // base is reader but there is no book to show. Two ways to get
            // here: the reader-location effect is still loading it (a
            // browser-forward into a book, or a dev reload), or the load
            // failed outright. ReaderFallback draws nothing in the first case
            // — App's full-page spinner is already covering the screen — and
            // a way back in the second, so a failed open is never a dead end
            // on a chrome-less page.
            <ReaderFallback
              theme={theme}
              tr={tr}
              loading={loading}
              error={error}
              onBack={closeBook}
            />
          )}
        </AnimatedSwap>
        {/* Mounted at the app root so a docx import keeps showing across the
            Library → Reader transition (e.g. user clicks "Continue in
            background" then opens an existing book while the import finishes). */}
        <ImportProgress theme={theme} />
        {/* Status for a book opened from outside (Open with, share, drop),
            on whatever screen is up — the import runs in the background. */}
        <BackgroundImportToast
          theme={theme}
          layout={isMobile ? "mobile" : "desktop"}
          onOpenBook={(id) => void openBook(id)}
        />
        {/* Image lightbox — opens when a chapter image is tapped, anywhere. */}
        <Lightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={closeLightbox}
        />
        {/* Drag-and-drop overlay — last, so it layers above the reader, the
            library, and any open dialog while a drag is in progress. */}
        <DropOverlay state={dropState} theme={theme} />
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
        fontSize: 20,
        zIndex: Z.floating,
      }}
    >
      {label}
    </div>
  );
}

export default App;
