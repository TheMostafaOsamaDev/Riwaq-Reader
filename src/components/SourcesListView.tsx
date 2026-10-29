// Store landing — one card per installed source extension.
//
// Static for now; the registry returns metadata synchronously so there's
// no loading state to manage. Sideloaded extensions (planned future work)
// would slot in here the same way.

import { useMemo } from "react";
import { useI18n } from "../i18n/useI18n";
import { pickDescription } from "../sources/description";
import { languageName, useSiteFilter } from "../sources/filter";
import { listSources } from "../sources/registry";
import type { SourceMetadata } from "../sources/types";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  homeBarInset,
  PHONE_TAB_TITLE,
  type Theme,
} from "../styles/tokens";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { SiteFilterBar } from "./SiteFilterBar";
import { SourceIcon } from "./SourceIcon";

interface Props {
  theme: Theme;
  onOpenSource: (sourceId: string) => void;
  /** Open the Extensions manager — the sources ON this page are what it
   *  manages, so it is reached from here rather than from a tab of its
   *  own. */
  onOpenExtensions: () => void;
  /** "mobile": the Store is a tab of the phone's home shell, and this page
   *  is its root — the title is the tab's title, sized and inset like the
   *  Library's, with no desktop gutters. */
  layout?: "desktop" | "mobile";
}

export function SourcesListView({
  theme,
  onOpenSource,
  onOpenExtensions,
  layout = "desktop",
}: Props) {
  const isMobile = layout === "mobile";
  const { tr } = useI18n();
  const sources = useMemo(() => listSources(), []);
  // Live filter over the installed sources by name / URL / description,
  // and by language once one is chosen.
  const filter = useSiteFilter(sources);
  const filtered = sources.filter(filter.matches);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: isMobile ? "16px 22px 40px" : "28px 40px 40px",
        // Room to scroll clear of the phone's floating bottom bar; the
        // variable is only set inside the phone shell, so 0 elsewhere.
        paddingBottom: homeBarInset(40),
        fontFamily: FONT_STACKS.sans,
        color: theme.ink,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ minWidth: isMobile ? 0 : 220, flex: 1 }}>
          <h2
            style={{
              ...(isMobile
                ? PHONE_TAB_TITLE
                : {
                    fontFamily: FONT_SERIF_DISPLAY,
                    fontWeight: 400,
                    fontSize: 26,
                    letterSpacing: "-0.01em",
                  }),
              margin: "0 0 6px 0",
            }}
          >
            {tr("store.title")}
          </h2>
          <p
            style={{
              margin: 0,
              color: theme.muted,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {tr("store.subtitle")}
          </p>
        </div>
        <Button
          theme={theme}
          variant="secondary"
          size="sm"
          style={{ minHeight: 44, paddingInline: 14, flexShrink: 0 }}
          leadingIcon={<Icon name="layers" size={14} />}
          onClick={onOpenExtensions}
        >
          {tr("extensions.manage")}
        </Button>
      </div>

      {sources.length > 0 && (
        <SiteFilterBar
          theme={theme}
          filter={filter}
          placeholder={tr("store.filterWebsites")}
        />
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
          {tr("store.noMatchingWebsites", { query: filter.query.trim() })}
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
  const { locale } = useI18n();
  const language = languageName(source.language, locale);
  // An extension ships its own description as a locale map — it cannot
  // reach the app's message catalogue, so this is not an i18n key.
  const description = pickDescription(source.description, locale);

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
              fontWeight: 500,
            }}
          >
            {language} · v{source.version}
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
