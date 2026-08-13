// Reusable cover-art card for source novel listings (homepage sections
// and search results both use this). One card = one clickable novel.
//
// Image optimization: KolNovel serves cards' covers at their original
// upload resolution (often 1500×2000+) even though they're rendered at
// ~140px wide — a 50× bandwidth waste. We derive WordPress's auto-
// generated thumbnail URL (`image-225x300.jpg`) and use that first; if
// it 404s (the size wasn't generated for that upload) we fall back to
// the original. The browser cache absorbs the retry across a session
// so the fallback only hurts the first load of an unusual image.
//
// `decoding="async"` keeps the main thread free of image-decode work
// during scroll, and `referrerPolicy="no-referrer"` keeps Tauri's
// future policy default explicit (some hotlink-protected hosts will
// 403 if a referer leaks).

import { useState } from "react";
import type { NovelCard as NovelCardData } from "../sources/types";
import type { Theme } from "../styles/tokens";
import {
  looksLikeMissingPlaceholder,
  optimizedCoverUrl,
} from "../sources/images";
import { useI18n } from "../i18n/useI18n";

interface Props {
  theme: Theme;
  card: NovelCardData;
  onClick: () => void;
}

export function NovelCard({ theme, card, onClick }: Props) {
  const { tr } = useI18n();
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  // Two-tier source: thumbnail first, full-size fallback on error.
  // Tracked in a single state so we don't retry the same fallback
  // indefinitely.
  const initialSrc = card.coverUrl
    ? optimizedCoverUrl(card.coverUrl, 300)
    : undefined;
  const [src, setSrc] = useState<string | undefined>(initialSrc);

  return (
    <button
      onClick={onClick}
      title={card.title}
      style={{
        display: "flex",
        flexDirection: "column",
        textAlign: "start",
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        fontFamily: "inherit",
        color: theme.ink,
        width: "100%",
      }}
    >
      <div
        style={{
          aspectRatio: "2 / 3",
          width: "100%",
          borderRadius: 10,
          overflow: "hidden",
          background: theme.chrome,
          border: `0.5px solid ${theme.rule}`,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {card.coverUrl && !imgFailed && src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            width={140}
            height={210}
            onLoad={(e) => {
              // KolNovel returns 200 + a 600×330 landscape placeholder
              // JPEG when a thumbnail size doesn't exist (instead of
              // 404), so `onError` won't fire. Detect that by aspect
              // ratio and treat it as a load failure.
              if (
                src !== card.coverUrl &&
                looksLikeMissingPlaceholder(e.currentTarget)
              ) {
                setImgLoaded(false);
                setSrc(card.coverUrl);
                return;
              }
              setImgLoaded(true);
            }}
            onError={() => {
              // Genuine 404 path — server actually rejected. Retry
              // with the original URL once.
              if (src !== card.coverUrl) {
                setImgLoaded(false);
                setSrc(card.coverUrl);
              } else {
                setImgFailed(true);
              }
            }}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: imgLoaded ? 1 : 0,
              transition: "opacity 180ms ease",
            }}
          />
        ) : (
          <div
            style={{
              fontSize: 11,
              color: theme.muted,
              padding: 8,
              textAlign: "center",
            }}
          >
            {tr("novel.noCover")}
          </div>
        )}
        {card.badges && card.badges.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: 6,
              right: 6,
              bottom: 6,
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
            }}
          >
            {card.badges.slice(0, 2).map((b) => (
              <span
                key={b}
                style={{
                  fontSize: 10,
                  background: "rgba(0,0,0,0.55)",
                  color: "#fff",
                  padding: "2px 6px",
                  borderRadius: 999,
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                }}
              >
                {b}
              </span>
            ))}
          </div>
        )}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.35,
          letterSpacing: "-0.005em",
          // Clamp to two lines so cards in a grid stay uniform height.
          display: "-webkit-box",
          WebkitBoxOrient: "vertical" as const,
          WebkitLineClamp: 2 as const,
          overflow: "hidden",
        }}
      >
        {card.title}
      </div>
      {card.subtitle && (
        <div
          style={{
            marginTop: 2,
            fontSize: 11,
            color: theme.muted,
            lineHeight: 1.3,
            display: "-webkit-box",
            WebkitBoxOrient: "vertical" as const,
            WebkitLineClamp: 1 as const,
            overflow: "hidden",
          }}
        >
          {card.subtitle}
        </div>
      )}
    </button>
  );
}
