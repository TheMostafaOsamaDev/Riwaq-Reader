// Store landing — one card per installed source extension.
//
// Static for now; the registry returns metadata synchronously so there's
// no loading state to manage. Sideloaded extensions (planned future work)
// would slot in here the same way.

import { useMemo } from "react";
import { useI18n } from "../i18n/useI18n";
import { listSources } from "../sources/registry";
import type { SourceMetadata } from "../sources/types";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { Icon } from "./Icon";

interface Props {
  theme: Theme;
  onOpenSource: (sourceId: string) => void;
}

export function SourcesListView({ theme, onOpenSource }: Props) {
  const { tr } = useI18n();
  const sources = useMemo(() => listSources(), []);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "28px 40px 40px",
        fontFamily: FONT_STACKS.sans,
        color: theme.ink,
      }}
    >
      <h2
        style={{
          fontFamily: FONT_SERIF_DISPLAY,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: 26,
          margin: "0 0 6px 0",
          letterSpacing: "-0.01em",
        }}
      >
        {tr("store.title")}
      </h2>
      <p
        style={{
          margin: "0 0 24px 0",
          color: theme.muted,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        {tr("store.subtitle")}
      </p>

      {sources.length === 0 ? (
        <div
          style={{
            padding: 40,
            color: theme.muted,
            textAlign: "center",
            fontSize: 13,
          }}
        >
          {tr("store.noSources")}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {sources.map((s) => (
            <SourceCard
              key={s.id}
              theme={theme}
              source={s}
              onClick={() => onOpenSource(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SourceCardProps {
  theme: Theme;
  source: SourceMetadata;
  onClick: () => void;
}

function SourceCard({ theme, source, onClick }: SourceCardProps) {
  const { tr } = useI18n();
  // Bundled sources set `descriptionKey` so this copy translates with the
  // UI language; `description` is a plain-text fallback for future
  // sideloaded/third-party sources that ship their own text directly.
  const description = source.descriptionKey
    ? tr(source.descriptionKey)
    : source.description;

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "start",
        display: "flex",
        flexDirection: "column",
        padding: 18,
        background: theme.chrome,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "transform 90ms ease, filter 120ms ease",
        gap: 12,
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = "scale(0.99)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: 10,
            background: theme.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: theme.ink,
          }}
        >
          <Icon name="globe" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            {source.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: theme.muted,
              marginTop: 2,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {source.language} · v{source.version}
          </div>
        </div>
        <Icon
          name="chevronR"
          size={16}
          className="rtl-flip-x"
          style={{ color: theme.muted, flexShrink: 0 }}
        />
      </div>
      {description && (
        <div
          style={{
            fontSize: 12.5,
            color: theme.muted,
            lineHeight: 1.5,
          }}
        >
          {description}
        </div>
      )}
      <div
        style={{
          fontSize: 11,
          color: theme.muted,
          marginTop: "auto",
          opacity: 0.7,
        }}
      >
        {source.baseUrl.replace(/^https?:\/\//, "")}
      </div>
    </button>
  );
}
