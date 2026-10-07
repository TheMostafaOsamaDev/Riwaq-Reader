// Tabs along the top of the phone reader's sheet, for the bar styles that do
// not put a button for every panel on the bar (see barStyles.panelsInContents).
// With them, Contents opens on the chapter list and Highlights and Progress
// are one tap away inside it, so choosing a lighter bar never hides a panel.

import { useI18n } from "../../i18n/useI18n";
import type { Theme } from "../../styles/tokens";
import type { ReaderPanel } from "./ReaderTabBar";

const LABEL = {
  toc: "reader.bar.contents",
  highlights: "reader.bar.highlights",
  progress: "reader.bar.progress",
  settings: "reader.bar.text",
} as const;

export function PanelSwitcher({
  theme,
  panels,
  active,
  onSelect,
}: {
  theme: Theme;
  /** In order. Fewer than two and there is nothing to switch between. */
  panels: readonly ReaderPanel[];
  active: ReaderPanel | null;
  onSelect: (p: ReaderPanel) => void;
}) {
  const { tr } = useI18n();
  if (panels.length < 2 || !active || !panels.includes(active)) return null;
  return (
    <div
      role="tablist"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${panels.length}, minmax(0, 1fr))`,
        gap: 2,
        margin: "4px 16px 8px",
        padding: 3,
        borderRadius: 12,
        background: theme.hover,
        border: `0.5px solid ${theme.rule}`,
        flexShrink: 0,
      }}
    >
      {panels.map((p) => {
        const on = p === active;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(p)}
            style={{
              height: 36,
              border: "none",
              borderRadius: 9,
              background: on ? theme.bg : "transparent",
              color: on ? theme.ink : theme.chromeInk,
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: on ? 500 : 400,
              cursor: "pointer",
              boxShadow: on ? "0 1px 3px rgba(0,0,0,0.14)" : "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {tr(LABEL[p])}
          </button>
        );
      })}
    </div>
  );
}
