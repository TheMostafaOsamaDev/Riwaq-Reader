// Store landing — one card per installed source extension.
//
// Static for now; the registry returns metadata synchronously so there's
// no loading state to manage. Sideloaded extensions (planned future work)
// would slot in here the same way.

import { useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { listSources } from "../sources/registry";
import type { SourceMetadata } from "../sources/types";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { Icon } from "./Icon";
import { SourceIcon } from "./SourceIcon";

interface Props {
  theme: Theme;
  onOpenSource: (sourceId: string) => void;
}

export function SourcesListView({ theme, onOpenSource }: Props) {
  const { tr } = useI18n();
  const sources = useMemo(() => listSources(), []);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  // Live filter over the installed sources by name / URL / description. The
  // description may be an i18n key (bundled sources) or plain text (future
  // sideloaded ones), so resolve it before matching.
  const filtered = useMemo(() => {
    if (!q) return sources;
    return sources.filter((s) => {
      const desc = s.descriptionKey ? tr(s.descriptionKey) : s.description ?? "";
      return (
        s.name.toLowerCase().includes(q) ||
        s.baseUrl.toLowerCase().includes(q) ||
        desc.toLowerCase().includes(q)
      );
    });
  }, [sources, q, tr]);

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
          margin: "0 0 20px 0",
          color: theme.muted,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        {tr("store.subtitle")}
      </p>

      {sources.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: theme.bg,
            border: `1px solid ${theme.rule}`,
            borderRadius: 11,
            padding: "10px 13px",
            marginBottom: 22,
          }}
        >
          <span style={{ color: theme.muted, display: "flex", flexShrink: 0 }}>
            <Icon name="search" size={16} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("store.filterWebsites")}
            aria-label={tr("store.filterWebsites")}
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: "none",
              background: "transparent",
              font: "inherit",
              fontSize: 14,
              color: theme.ink,
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label={tr("common.close")}
              style={{
                display: "flex",
                flexShrink: 0,
                border: 0,
                background: "transparent",
                color: theme.muted,
                cursor: "pointer",
                padding: 2,
              }}
            >
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
      )}

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
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: 40,
            color: theme.muted,
            textAlign: "center",
            fontSize: 13,
          }}
        >
          {tr("store.noMatchingWebsites", { query: query.trim() })}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {filtered.map((s) => (
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
        <SourceIcon
          theme={theme}
          iconUrl={source.iconUrl}
          size={44}
          radius={10}
          glyphSize={22}
        />
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
