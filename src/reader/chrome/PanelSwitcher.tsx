// Tabs along the top of the phone reader's sheet, for the bar styles that do
// not put a button for every panel on the bar (see barStyles.panelsInContents).
// With them, Contents opens on the chapter list and Highlights and Progress
// are one tap away inside it, so choosing a lighter bar never hides a panel.

import {
  indicatorBaseStyle,
  useSlidingIndicator,
} from "../../hooks/useSlidingIndicator";
import { useI18n } from "../../i18n/useI18n";
import { raisedSurface, type Theme } from "../../styles/tokens";
import type { ReaderPanel } from "./ReaderTabBar";
import { PANEL_LABEL } from "./barStyles";

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
  const shown = panels.length >= 2 && !!active && panels.includes(active);
  // The segment slides between tabs, like the library's filter pills.
  const slide = useSlidingIndicator<ReaderPanel, HTMLDivElement>(
    shown ? active : null,
  );
  if (!shown) return null;
  return (
    <div
      ref={slide.containerRef}
      role="tablist"
      style={{
        position: "relative",
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
      <div
        ref={slide.indicatorRef}
        aria-hidden
        style={{
          ...indicatorBaseStyle,
          borderRadius: 9,
          background: raisedSurface(theme),
          boxShadow: "0 1px 3px rgba(0,0,0,0.14)",
        }}
      />
      {panels.map((p) => {
        const on = p === active;
        return (
          <button
            key={p}
            ref={slide.register(p)}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(p)}
            style={{
              height: 36,
              border: "none",
              borderRadius: 9,
              position: "relative",
              background: "transparent",
              color: on ? theme.ink : theme.chromeInk,
              transition: "color 200ms ease",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: on ? 500 : 400,
              cursor: "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {tr(PANEL_LABEL[p])}
          </button>
        );
      })}
    </div>
  );
}
