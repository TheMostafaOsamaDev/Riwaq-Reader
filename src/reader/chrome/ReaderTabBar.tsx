// The reader's bottom tab row: contents · highlights · show-progress ·
// progress · settings.
//
// The EPUB reader has always put these at the bottom of the phone screen, where
// a thumb can reach them; the fixed-page reader kept the same four in its top
// bar, so the two formats felt like different apps. One row, one implementation,
// both readers.

import type { CSSProperties } from "react";
import { Icon } from "../../components/Icon";
import { useI18n } from "../../i18n/useI18n";
import type { Theme } from "../../styles/tokens";

export type ReaderPanel = "toc" | "highlights" | "progress" | "settings";

/** 44×44 — the platform minimum, and wide enough that the five tabs spread
 *  evenly across a phone without crowding. */
export function readerTabStyle(theme: Theme, active = false): CSSProperties {
  return {
    width: 44,
    height: 44,
    borderRadius: 10,
    border: "none",
    background: active ? theme.hover : "transparent",
    color: active ? theme.ink : theme.chromeInk,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

interface Props {
  theme: Theme;
  /** Which panel is open, so its tab reads as selected. */
  active?: ReaderPanel | null;
  onOpen: (panel: ReaderPanel) => void;
  /** Whether the progress bar above is showing. */
  showProgress: boolean;
  onToggleProgress: () => void;
}

export function ReaderTabBar({
  theme,
  active = null,
  onOpen,
  showProgress,
  onToggleProgress,
}: Props) {
  const { tr } = useI18n();
  return (
    <div style={{ display: "flex", justifyContent: "space-around" }}>
      <button
        onClick={() => onOpen("toc")}
        style={readerTabStyle(theme, active === "toc")}
        aria-label={tr("reader.toc")}
        aria-pressed={active === "toc"}
      >
        <Icon name="list" size={18} />
      </button>
      <button
        onClick={() => onOpen("highlights")}
        style={readerTabStyle(theme, active === "highlights")}
        aria-label={tr("reader.highlights")}
        aria-pressed={active === "highlights"}
      >
        <Icon name="highlight" size={18} />
      </button>
      <button
        onClick={onToggleProgress}
        style={readerTabStyle(theme)}
        aria-label={
          showProgress ? tr("reader.hideProgressBar") : tr("reader.showProgressBar")
        }
        aria-pressed={showProgress}
      >
        <Icon name="slider" size={18} />
      </button>
      <button
        onClick={() => onOpen("progress")}
        style={readerTabStyle(theme, active === "progress")}
        aria-label={tr("reader.progress")}
        aria-pressed={active === "progress"}
      >
        <Icon name="clock" size={18} />
      </button>
      <button
        onClick={() => onOpen("settings")}
        style={readerTabStyle(theme, active === "settings")}
        aria-label={tr("reader.settings")}
        aria-pressed={active === "settings"}
      >
        <Icon name="type" size={18} />
      </button>
    </div>
  );
}
