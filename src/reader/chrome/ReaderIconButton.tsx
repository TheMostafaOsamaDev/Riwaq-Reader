// Shared reader-chrome icon button. Both readers (reflow DesktopReader and
// fixed-page FixedPageReader) use it so toolbar glyphs, sizes, and active/
// disabled states are identical. Wraps the app's `Icon` set.

import type { CSSProperties } from "react";
import { Icon, type IconProps } from "../../components/Icon";
import type { Theme } from "../../styles/tokens";

type IconName = IconProps["name"];

/** The chrome button surface style (transparent → hover tint when active).
 *  Exported so callers that need the bare style (e.g. non-Icon buttons) match. */
export function chromeBtnStyle(theme: Theme, active = false): CSSProperties {
  return {
    borderRadius: 8,
    border: "none",
    background: active ? theme.hover : "transparent",
    color: active ? theme.ink : theme.chromeInk,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
}

interface Props {
  theme: Theme;
  icon: IconName;
  /** Accessible name (also drives aria-label). */
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Square button size. Default 34 (matches the reader top chrome). */
  size?: number;
  /** Glyph size. Default 16. */
  iconSize?: number;
  /** Mirror the glyph under RTL — for directional arrows only. */
  flip?: boolean;
}

export function ReaderIconButton({
  theme,
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  size = 34,
  iconSize = 16,
  flip = false,
}: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      style={{
        ...chromeBtnStyle(theme, active),
        width: size,
        height: size,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Icon name={icon} size={iconSize} className={flip ? "rtl-flip-x" : undefined} />
    </button>
  );
}
