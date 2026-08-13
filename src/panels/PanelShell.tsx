import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import { FONT_STACKS, type Theme } from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";

interface PanelShellProps {
  theme: Theme;
  title: string;
  subtitle?: string;
  onClose?: () => void;
  children: ReactNode;
  width?: number | string;
  actions?: ReactNode;
  icon?: ReactNode;
  // Side border faces the reader column on desktop. Omit on mobile —
  // the bottom sheet already renders its own chrome edge-to-edge.
  side?: "left" | "right";
}

export function PanelShell({
  theme,
  title,
  subtitle,
  onClose,
  children,
  width = 340,
  actions,
  icon,
  side,
}: PanelShellProps) {
  const { tr } = useI18n();
  const borderSide =
    side === "left"
      ? { borderInlineEnd: `0.5px solid ${theme.rule}` }
      : side === "right"
      ? { borderInlineStart: `0.5px solid ${theme.rule}` }
      : {};
  return (
    <div
      style={{
        width,
        height: "100%",
        // Match the reader body so the panel reads as continuous with
        // the page — only the rule border separates them. Using
        // theme.chrome here produced a subtle but visible step against
        // the reader column, which looked like a theming bug.
        background: theme.bg,
        color: theme.ink,
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT_STACKS.sans,
        flexShrink: 0,
        ...borderSide,
      }}
    >
      <div
        style={{
          padding: "18px 18px 14px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          borderBottom: `0.5px solid ${theme.rule}`,
          // touch-action: none lets MobileSheet's pointer-down handler
          // (attached to the outer sheet div) start a drag from the
          // header strip without the browser first guessing the touch
          // is a scroll attempt. The X close button still receives its
          // click because MobileSheet's onDragPointerDown early-returns
          // on `closest("button")`.
          touchAction: "none",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
          {icon && <div style={{ color: theme.chromeInk, paddingTop: 2 }}>{icon}</div>}
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: theme.ink,
              }}
            >
              {title}
            </div>
            {subtitle && (
              <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {actions}
          {onClose && (
            <button
              onClick={onClose}
              aria-label={tr("panel.close")}
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                border: "none",
                background: "transparent",
                color: theme.chromeInk,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>
      <div
        data-sheet-scrollable="true"
        style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
      >
        {children}
      </div>
    </div>
  );
}
