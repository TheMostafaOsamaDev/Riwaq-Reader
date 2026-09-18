// The Store — top-level container for browsing source extensions.
//
// Owns the in-store navigation state:
//
//   sources    → cards for every installed extension
//   extensions → the manager: install/update/remove, and repositories
//   source     → one source's homepage (sections + search)
//   novel      → one novel's detail page (header, accordion, actions)
//
// Each sub-view receives a small set of callbacks (`onOpenSource`,
// `onOpenNovel`, `onBack`) so navigation flows in one direction through
// here. The Store is mounted inside the Library's body only while the
// "Store" tab is active — AnimatedSwap actually unmounts it (after its
// exit-fade) the moment the user switches away, and mounts a fresh
// instance on return. That is deliberate and load-bearing for the effect
// below, not just an implementation detail: switching tabs does NOT
// preserve `view`/`rangeDialog` state.
//
// initExtensions() is called from THIS component's own mount effect, not
// from App.tsx's startup. It used to be App's — three separate,
// increasingly-desperate attempts at starting it during app startup
// (undeferred; deferred past page load same as main.tsx's
// migrateLegacyRoot; deferred AND serialized behind migrateLegacyRoot) each
// independently reproduced this codebase's documented Android
// lock-ordering deadlock (main.tsx's migrateLegacyRoot comment) on live
// device testing — confirmed via `debuggerd -b` thread dumps, at roughly a
// coin-flip rate across all three, none of them distinguishable from each
// other or from the pre-existing single-call baseline. The common thread:
// all three started extensions' first fs call somewhere in the app's
// STARTUP window, which is the one time window a native page-load race is
// even possible.
//
// The Store is reached only by user navigation, long after page load has
// finished — there is no page-load race window left to lose at all, which
// closes the hazard structurally rather than narrowing it probabilistically
// the way every startup-side deferral attempt did.
//
// That argument is about the TIMING, not about this component, and the
// Store is not the only view the user navigates to. A library-backed novel
// page and the Store are arms of one ternary in DesktopLibrary /
// MobileLibrary, so a novel page is on screen precisely when the Store has
// never mounted — and with the load living only here, the registry was
// empty underneath it. Those views now inherit this same reasoning through
// `ensureExtensions()` (sources/useExtensions.ts): same "reached by user
// navigation" premise, one memoised load between them. This call stays as
// it is because it is the REFRESH — re-listing per Store visit is what
// picks up an install or removal — and it must not move to App startup or
// to the Library's mount.
//
// The accepted cost that remains: a download auto-resuming at launch can't
// find its source until some navigated view has loaded the registry in this
// session; that path already null-checks a missing source and reports it,
// so it degrades visibly rather than silently or unsafely.
import { useCallback, useEffect, useState } from "react";
import { ExtensionsView } from "./ExtensionsView";
import { SourcesListView } from "./SourcesListView";
import {
  onOpenExtensionsManager,
  onOpenStoreSource,
  takePendingExtensionsManager,
  takePendingStoreSource,
} from "../store/uiIntents";
import { SourceHomeView } from "./SourceHomeView";
import { NovelDetailView } from "./novel/NovelDetailView";
import { DownloadRangeDialog } from "./DownloadRangeDialog";
import { ThemedSkeleton } from "./Skeleton";
import { initExtensions } from "../sources/registry";
import type { Theme } from "../styles/tokens";

interface Props {
  theme: Theme;
  layout: "desktop" | "mobile";
  /** Open the source streaming reader for a novel at the given chapter
   *  (defaults to the first chapter when not specified). */
  onStreamRead: (
    sourceId: string,
    novelUrl: string,
    chapterId?: number,
  ) => void;
  /** Called once a source-import finishes so the parent library can
   *  refresh its shelf — the new book is already persisted by the
   *  importer; the parent just needs to re-list. */
  onImportComplete: () => void;
}

type StoreView =
  | { kind: "sources" }
  | { kind: "extensions" }
  | { kind: "source"; sourceId: string }
  | { kind: "novel"; sourceId: string; novelUrl: string };

export function Store({
  theme,
  layout,
  onStreamRead,
  onImportComplete,
}: Props) {
  const [view, setView] = useState<StoreView>({ kind: "sources" });
  const [rangeDialog, setRangeDialog] = useState<{
    sourceId: string;
    novelUrl: string;
  } | null>(null);

  // True once initExtensions() has settled for THIS mount. No deferral
  // needed here — unlike the app's startup window, there is no native
  // page-load race left to dodge by the time the user has navigated to the
  // Store. initExtensions() never rejects (see registry.ts's doc comment),
  // so this needs no `.catch`.
  //
  // Re-running it on every re-mount is deliberate: the Store unmounts on a
  // tab switch, and re-listing is what picks up a source installed or
  // removed since the last visit without an app restart. registry.ts caches
  // each bundle's evaluation by `id@sha256`, so the repeat cost is a
  // directory listing and a couple of small reads, not a fresh blob-URL
  // import and re-execution of every extension per visit.
  const [extensionsReady, setExtensionsReady] = useState(false);
  useEffect(() => {
    // The load is not cancellable (it is filesystem reads and module
    // evaluation), but the setState must not land on an unmounted tree: a
    // fast tab-switch away and back leaves the first mount's promise still
    // in flight. React 19 drops that update silently; this makes the intent
    // explicit rather than relying on it.
    let live = true;
    void initExtensions().finally(() => {
      if (live) setExtensionsReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const openSource = useCallback((sourceId: string) => {
    setView({ kind: "source", sourceId });
  }, []);

  const openExtensions = useCallback(() => {
    setView({ kind: "extensions" });
  }, []);

  const openNovel = useCallback((sourceId: string, novelUrl: string) => {
    setView({ kind: "novel", sourceId, novelUrl });
  }, []);

  const backToSources = useCallback(() => {
    setView({ kind: "sources" });
  }, []);

  const backToSource = useCallback(() => {
    setView((prev) => {
      if (prev.kind === "novel") {
        return { kind: "source", sourceId: prev.sourceId };
      }
      return prev;
    });
  }, []);

  // Open a source targeted from outside the Store (the main search's Websites
  // results). A request that arrived before we mounted — e.g. the search
  // jumped in from the shelf — is consumed on mount; later ones arrive live
  // through the subscription.
  useEffect(() => {
    const pending = takePendingStoreSource();
    if (pending) setView({ kind: "source", sourceId: pending });
    return onOpenStoreSource((sourceId) =>
      setView({ kind: "source", sourceId }),
    );
  }, []);

  // "Open Extensions", asked for from anywhere — in practice the notice a
  // saved novel shows when its extension is gone. Consumed on mount too:
  // the request usually arrives from a library-backed novel page, i.e.
  // while this component does not exist yet, and the Library answers it by
  // switching to the Store — which is what mounts us.
  useEffect(() => {
    if (takePendingExtensionsManager()) setView({ kind: "extensions" });
    return onOpenExtensionsManager(() => {
      if (takePendingExtensionsManager()) setView({ kind: "extensions" });
    });
  }, []);

  return (
    <>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {view.kind === "sources" &&
          (extensionsReady ? (
            <SourcesListView
              theme={theme}
              onOpenSource={openSource}
              onOpenExtensions={openExtensions}
            />
          ) : (
            <ThemedSkeleton theme={theme} style={{ flex: 1 }} />
          ))}
        {/* Not gated on `extensionsReady`: the manager loads its own
            catalogue, and it is the one view that must stay reachable when
            nothing loaded. Coming back re-mounts SourcesListView, which
            re-lists the registry — so an install or a removal shows up
            there without an app restart. */}
        {view.kind === "extensions" && (
          <ExtensionsView theme={theme} onBack={backToSources} />
        )}
        {view.kind === "source" && (
          <SourceHomeView
            theme={theme}
            layout={layout}
            sourceId={view.sourceId}
            onBack={backToSources}
            onOpenNovel={(novelUrl) => openNovel(view.sourceId, novelUrl)}
          />
        )}
        {view.kind === "novel" && (
          <NovelDetailView
            theme={theme}
            layout={layout}
            sourceId={view.sourceId}
            novelUrl={view.novelUrl}
            onBack={backToSource}
            onStreamRead={(chapterId) =>
              onStreamRead(view.sourceId, view.novelUrl, chapterId)
            }
            onImportComplete={onImportComplete}
            onOpenRangeDialog={() =>
              setRangeDialog({
                sourceId: view.sourceId,
                novelUrl: view.novelUrl,
              })
            }
          />
        )}
      </div>
      <DownloadRangeDialog
        theme={theme}
        layout={layout}
        open={rangeDialog !== null}
        sourceId={rangeDialog?.sourceId}
        novelUrl={rangeDialog?.novelUrl}
        onCancel={() => setRangeDialog(null)}
        onStarted={() => setRangeDialog(null)}
        onCompleted={() => onImportComplete()}
      />
    </>
  );
}
