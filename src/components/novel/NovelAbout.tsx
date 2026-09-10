
import type { SourceNovel } from "../../sources/types";

import type {
  Theme,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";

export interface NovelAboutProps {
  theme: Theme;
  layout: "desktop" | "mobile";
  novel: SourceNovel;
  showFullDesc: boolean;
  setShowFullDesc: (b: boolean) => void;
}

/** The details that sit below the hero: genre/tag chips and the full
 *  synopsis (collapsed past a threshold). The hero shows only a short teaser,
 *  so this is where the reader gets the whole description. */
export function NovelAbout({
  theme,
  layout,
  novel,
  showFullDesc,
  setShowFullDesc,
}: NovelAboutProps) {
  const { tr } = useI18n();
  const desc = novel.description ?? "";
  const hasDesc = desc.length > 0;
  const hasTags = novel.tags.length > 0;
  if (!hasDesc && !hasTags) return null;

  const isLongDesc = desc.length > 300;
  const visibleDesc =
    showFullDesc || !isLongDesc ? desc : `${desc.slice(0, 300)}…`;

  return (
    <div
      style={{
        padding: layout === "mobile" ? "18px 18px 4px" : "26px 40px 4px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {hasTags && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {novel.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 11.5,
                padding: "4px 10px",
                borderRadius: 999,
                border: `0.5px solid ${theme.rule}`,
                color: theme.muted,
                background: theme.chrome,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {hasDesc && (
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.65,
            color: theme.ink,
            direction: novel.direction,
            textAlign: "start",
          }}
        >
          {visibleDesc}
          {isLongDesc && (
            <button
              onClick={() => setShowFullDesc(!showFullDesc)}
              style={{
                marginInlineStart: 6,
                background: "transparent",
                border: "none",
                color: theme.muted,
                cursor: "pointer",
                fontSize: 12.5,
                textDecoration: "underline",
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              {showFullDesc ? tr("novel.descLess") : tr("novel.descMore")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
