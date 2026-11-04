// A search field with a language filter beside it — the one control row
// over both lists of sites: the Store's installed sources and the
// Extensions manager's catalogue. The state and what "matches" means live
// in sources/filter.ts (useSiteFilter); this only draws the controls.
//
// The language chips appear only when the list holds more than one
// language. With one, "All" and that language would always show the same
// thing, so the row would offer a choice that changes nothing.
//
// The row wraps rather than squeezing: on a phone the chips drop under the
// field instead of shrinking it below a usable width. Flexbox mirrors the
// order under `dir="rtl"`, so nothing here is hand-flipped.

import { useI18n } from "../i18n/useI18n";
import type { SiteFilter } from "../sources/filter";
import type { Theme } from "../styles/tokens";
import { Icon } from "./Icon";

interface Props {
  theme: Theme;
  filter: SiteFilter;
  placeholder: string;
}

export function SiteFilterBar({ theme, filter, placeholder }: Props) {
  const { tr } = useI18n();
  const { query, setQuery, languages, language, setLanguage } = filter;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        marginBottom: 22,
      }}
    >
      <div
        style={{
          flex: "1 1 240px",
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: theme.bg,
          border: `1px solid ${theme.rule}`,
          borderRadius: 11,
          padding: "10px 13px",
          minHeight: 44,
          boxSizing: "border-box",
        }}
      >
        <span style={{ color: theme.muted, display: "flex", flexShrink: 0 }}>
          <Icon name="search" size={16} />
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: "none",
            background: "transparent",
            font: "inherit",
            fontSize: 14,
            color: theme.ink,
            // The engine's own clear button would sit beside ours.
            appearance: "none",
            WebkitAppearance: "none",
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={tr("store.clear")}
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

      {languages.length > 1 && (
        <div
          role="group"
          aria-label={tr("store.languageFilter")}
          style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
        >
          <LanguageChip
            theme={theme}
            label={tr("store.allLanguages")}
            selected={language === null}
            onSelect={() => setLanguage(null)}
          />
          {languages.map((l) => (
            <LanguageChip
              key={l.code}
              theme={theme}
              label={l.name}
              selected={language === l.code}
              onSelect={() => setLanguage(l.code)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LanguageChip({
  theme,
  label,
  selected,
  onSelect,
}: {
  theme: Theme;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        // 44px tall, the same as the field beside it: this ships on
        // Android, where a smaller chip is a miss as often as a hit.
        minHeight: 44,
        paddingInline: 16,
        borderRadius: 999,
        border: selected ? `1px solid ${theme.ink}` : `1px solid ${theme.rule}`,
        background: selected ? theme.ink : theme.bg,
        color: selected ? theme.bg : theme.ink,
        font: "inherit",
        fontSize: 13,
        fontWeight: selected ? 600 : 500,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
