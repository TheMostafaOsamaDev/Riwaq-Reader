
import {
  Fragment,
  useState,
} from "react";
import { novelCoverCandidates } from "../novelCoverCandidates";
import { looksLikeMissingPlaceholder } from "../../sources/images";
import type { SourceNovel } from "../../sources/types";

import {
  FONT_SERIF_DISPLAY,
  type Theme,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Hero } from "../Hero";
import { SourceBadge } from "../SourceBadge";

export interface NovelHeroProps {
  theme: Theme;
  layout: "desktop" | "mobile";
  novel: SourceNovel;
  sourceName: string;
  sourceIconUrl?: string;
  working: boolean;
  chapterCount: number;
  /** True when the novel is already a library entry — swaps Add for Remove. */
  inLibrary: boolean;
  /** The saved cover on disk, when this novel is in the library. Preferred
   *  over `novel.coverUrl` so opening a saved novel never waits on the
   *  source site. Null while unresolved, or when there is no local file. */
  localCoverUrl: string | null;
  /** False while the library lookup is in flight — Add/Remove stays disabled
   *  so a fast click can't double-add before we know which to render. */
  libraryCheckDone: boolean;
  onRead: () => void;
  onAddToLibrary: () => void;
  onRemoveFromLibrary: () => void;
  onOpenRangeDialog: () => void;
  /** Only present for in-library, source-backed entries. */
  onOpenSaveOffline?: () => void;
  /** Only present when the book is in the library AND the parent passed
   *  shelf props — opens the ShelfChecklist popover. */
  onOpenShelfList?: () => void;
}

/** The cinematic top of the detail page: the cover blurred into a backdrop,
 *  with the sharp cover, source chip, title, key metadata, a description
 *  teaser, and the primary action cluster overlaid on a dark scrim. Actions
 *  use Button's `surface="onImage"` treatment so they read on the imagery in
 *  any app theme. */
export function NovelHero({
  theme,
  layout,
  novel,
  sourceName,
  sourceIconUrl,
  working,
  chapterCount,
  inLibrary,
  localCoverUrl,
  libraryCheckDone,
  onRead,
  onAddToLibrary,
  onRemoveFromLibrary,
  onOpenRangeDialog,
  onOpenSaveOffline,
  onOpenShelfList,
}: NovelHeroProps) {
  const { tr } = useI18n();
  const isMobile = layout === "mobile";
  const coverW = isMobile ? 116 : 152;
  const desc = novel.description ?? "";

  // Compact, dot-separated metadata line. Lead with the chapter count (the
  // most useful "how big is this" signal), then the source's own label/value
  // pairs; fall back to the detected author when the source surfaced no meta.
  const metaItems: string[] = [];
  if (chapterCount > 0) {
    metaItems.push(tr("novel.chapterCountShort", { n: chapterCount }));
  }
  if (novel.meta.length > 0) {
    for (const m of novel.meta.slice(0, 4)) {
      const value = m.value?.trim();
      if (!value) continue;
      const label = m.label?.trim();
      metaItems.push(label ? `${label}: ${value}` : value);
    }
  } else if (novel.author && novel.author !== tr("common.unknownAuthor")) {
    metaItems.push(novel.author);
  }

  // One resolved list drives both the sharp cover and the blurred backdrop,
  // so the header never fetches the same image twice.
  const coverCandidates = novelCoverCandidates({
    local: localCoverUrl,
    remote: novel.coverUrl,
    height: isMobile ? 400 : 600,
  });

  return (
    <Hero layout={layout} backdropUrl={coverCandidates[0]}>
      <div
        style={{
          display: "flex",
          gap: isMobile ? 16 : 26,
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "stretch" : "flex-end",
        }}
      >
        <div
          style={{
            width: coverW,
            flexShrink: 0,
            alignSelf: isMobile ? "flex-start" : "flex-end",
          }}
        >
          <div
            style={{
              width: "100%",
              aspectRatio: "2 / 3",
              borderRadius: 12,
              overflow: "hidden",
              background: "rgba(255,255,255,0.06)",
              border: "0.5px solid rgba(255,255,255,0.16)",
              boxShadow: "0 10px 34px rgba(0,0,0,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {coverCandidates.length > 0 ? (
              // Keyed on the best candidate so a cover that resolves to a
              // local file after mount restarts the walk rather than sticking
              // with whatever the network had already begun loading.
              <NovelCoverImage
                key={coverCandidates[0]}
                candidates={coverCandidates}
                theme={theme}
              />
            ) : (
              <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                {tr("novel.noCover")}
              </span>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 12 }}>
            <SourceBadge
              theme={theme}
              variant="chip"
              iconUrl={sourceIconUrl}
              name={sourceName}
              label={tr("novel.fromSource", { source: sourceName })}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <h1
              style={{
                fontFamily: FONT_SERIF_DISPLAY,
                fontWeight: 400,
                fontSize: isMobile ? 27 : 36,
                margin: 0,
                letterSpacing: "-0.015em",
                lineHeight: 1.08,
                color: "#ffffff",
                direction: novel.direction,
                textShadow: "0 1px 24px rgba(0,0,0,0.45)",
              }}
            >
              {novel.title || tr("common.untitled")}
            </h1>
            {novel.status && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  background: "rgba(255,255,255,0.16)",
                  border: "0.5px solid rgba(255,255,255,0.28)",
                  color: "#ffffff",
                  padding: "3px 9px",
                  borderRadius: 999,
                  backdropFilter: "blur(6px)",
                  WebkitBackdropFilter: "blur(6px)",
                }}
              >
                {novel.status}
              </span>
            )}
          </div>

          {novel.originalTitle && (
            <div
              style={{
                fontSize: 13.5,
                color: "rgba(255,255,255,0.72)",
                marginTop: 5,
                direction: novel.direction,
              }}
            >
              {novel.originalTitle}
            </div>
          )}

          {metaItems.length > 0 && (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                fontSize: 12.5,
                color: "rgba(255,255,255,0.82)",
                direction: novel.direction,
              }}
            >
              {metaItems.map((it, i) => (
                <Fragment key={i}>
                  {i > 0 && (
                    <span aria-hidden style={{ margin: "0 9px", opacity: 0.5 }}>
                      ·
                    </span>
                  )}
                  <span>{it}</span>
                </Fragment>
              ))}
            </div>
          )}

          {desc.length > 0 && (
            <p
              style={{
                margin: "14px 0 0 0",
                fontSize: 13.5,
                lineHeight: 1.6,
                color: "rgba(255,255,255,0.86)",
                direction: novel.direction,
                textAlign: "start",
                maxWidth: 640,
                display: "-webkit-box",
                WebkitBoxOrient: "vertical" as const,
                WebkitLineClamp: isMobile ? 3 : 2,
                overflow: "hidden",
              }}
            >
              {desc}
            </p>
          )}

          <div
            style={{
              marginTop: 20,
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
            }}
          >
            <Button
              theme={theme}
              surface="onImage"
              variant="primary"
              shape="pill"
              size="lg"
              onClick={onRead}
              leadingIcon={
                <Icon name="play" size={13} fill="currentColor" stroke={0} />
              }
            >
              {tr("novel.read")}
            </Button>
            {inLibrary ? (
              <Button
                theme={theme}
                surface="onImage"
                variant="outline"
                shape="pill"
                size="lg"
                onClick={onRemoveFromLibrary}
                disabled={working || !libraryCheckDone}
                leadingIcon={<Icon name="trash" size={14} />}
              >
                {working ? tr("novel.removing") : tr("library.removeFromLibrary")}
              </Button>
            ) : (
              <Button
                theme={theme}
                surface="onImage"
                variant="outline"
                shape="pill"
                size="lg"
                onClick={onAddToLibrary}
                disabled={working || !libraryCheckDone}
                leadingIcon={<Icon name="bookmark" size={14} />}
              >
                {working ? tr("novel.adding") : tr("novel.addToLibrary")}
              </Button>
            )}
            {onOpenShelfList && (
              <Button
                theme={theme}
                surface="onImage"
                variant="outline"
                shape="pill"
                size="lg"
                onClick={onOpenShelfList}
                leadingIcon={<Icon name="layers" size={14} />}
              >
                {tr("novel.shelves")}
              </Button>
            )}
            <Button
              theme={theme}
              surface="onImage"
              variant="outline"
              shape="pill"
              size="lg"
              onClick={onOpenRangeDialog}
              disabled={working || chapterCount === 0}
              leadingIcon={<Icon name="slider" size={14} />}
            >
              {tr("novel.downloadRange")}
            </Button>
            {onOpenSaveOffline && (
              <Button
                theme={theme}
                surface="onImage"
                variant="outline"
                shape="pill"
                size="lg"
                onClick={onOpenSaveOffline}
                disabled={working || chapterCount === 0}
                leadingIcon={<Icon name="download" size={14} />}
              >
                {tr("downloads.saveOffline.title")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Hero>
  );
}

// ── about (tags + full description) ──────────────────────────────────────────

/** Cover for the novel-detail header, walking `novelCoverCandidates` from the
 *  local file down to the source site's original. Each step is a strictly
 *  worse-but-still-valid source, so any failure just advances the index. */
export function NovelCoverImage({
  candidates,
  theme,
}: {
  candidates: string[];
  theme: Theme;
}) {
  const { tr } = useI18n();
  const [i, setI] = useState(0);
  const src = candidates[i];
  const hasNext = i < candidates.length - 1;
  if (!src) {
    return (
      <span style={{ color: theme.muted, fontSize: 12 }}>
        {tr("novel.noCover")}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={(e) => {
        // Same 200-OK placeholder detection as NovelCard — KolNovel serves a
        // 600×330 landscape "Could not get image" graphic when the requested
        // thumbnail size doesn't exist, so a load is not proof of a cover.
        if (hasNext && looksLikeMissingPlaceholder(e.currentTarget)) {
          setI(i + 1);
        }
      }}
      onError={() => setI(hasNext ? i + 1 : candidates.length)}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}

// ── chapter search ─────────────────────────────────────────────────────────
