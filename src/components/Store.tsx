// The Store — top-level container for browsing source extensions.
//
// Owns the in-store navigation state:
//
//   sources    → cards for every installed extension
//   source     → one source's homepage (sections + search)
//   novel      → one novel's detail page (header, accordion, actions)
//
// Each sub-view receives a small set of callbacks (`onOpenSource`,
// `onOpenNovel`, `onBack`) so navigation flows in one direction through
// here. The Store itself is mounted inside the Library's body when the
// "Store" tab is active; switching tabs back to "Library" leaves this
// component's state intact (React keeps the instance alive), so the user
// returns to whatever they were browsing.

import { useCallback, useEffect, useState } from "react";
import { SourcesListView } from "./SourcesListView";
import {
  onOpenStoreSource,
  takePendingStoreSource,
} from "../store/uiIntents";
import { SourceHomeView } from "./SourceHomeView";
import { NovelDetailView } from "./NovelDetailView";
import { DownloadRangeDialog } from "./DownloadRangeDialog";
import type { Theme } from "../styles/tokens";

interface Props {
  theme: Theme;
  layout: "desktop" | "mobile";
  /** Open the source streaming reader for a novel at the given chapter
   *  (defaults to the first chapter when not specified). */
  onStreamRead: (sourceId: string, novelUrl: string, chapterId?: number) => void;
  /** Called once a source-import finishes so the parent library can
   *  refresh its shelf — the new book is already persisted by the
   *  importer; the parent just needs to re-list. */
  onImportComplete: () => void;
}

type StoreView =
  | { kind: "sources" }
  | { kind: "source"; sourceId: string }
  | { kind: "novel"; sourceId: string; novelUrl: string };

export function Store({ theme, layout, onStreamRead, onImportComplete }: Props) {
  const [view, setView] = useState<StoreView>({ kind: "sources" });
  const [rangeDialog, setRangeDialog] = useState<{
    sourceId: string;
    novelUrl: string;
  } | null>(null);

  const openSource = useCallback((sourceId: string) => {
    setView({ kind: "source", sourceId });
  }, []);

  const openNovel = useCallback(
    (sourceId: string, novelUrl: string) => {
      setView({ kind: "novel", sourceId, novelUrl });
    },
    [],
  );

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
        {view.kind === "sources" && (
          <SourcesListView theme={theme} onOpenSource={openSource} />
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
      {rangeDialog && (
        <DownloadRangeDialog
          theme={theme}
          sourceId={rangeDialog.sourceId}
          novelUrl={rangeDialog.novelUrl}
          onCancel={() => setRangeDialog(null)}
          onStarted={() => {
            setRangeDialog(null);
          }}
          onCompleted={() => {
            onImportComplete();
          }}
        />
      )}
    </>
  );
}
