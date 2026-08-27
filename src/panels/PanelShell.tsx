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
        style={{
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
          // Clearance for the phone's gesture bar. The sheet is drawn
          // edge-to-edge, so without this the last control sits under the
          // system navigation — barely tappable, and a mis-tap leaves the app.
          //
          // The `max()` floor is load-bearing, not belt-and-braces: this
          // WebView reports safe-area-inset-TOP correctly (52px) but
          // safe-area-inset-BOTTOM as 0 despite the gesture bar being there,
          // so relying on env() alone would add nothing on Android. Note the
          // env() fallback argument cannot help either — a fallback applies
          // only when env() is unsupported, not when it resolves to 0.
          // `--sheet-overhang` is how far the enclosing bottom sheet hangs
          // below the visible viewport at its current snap (MobileSheet sets
          // it; it is 0/absent for docked desktop panels). Without it the tail
          // of this list scrolls into the off-screen part of the sheet and the
          // last control cannot be reached at all — which no amount of
          // safe-area padding fixes, because the space it needs is below the
          // screen rather than behind the system bar.
          paddingBottom:
            "calc(var(--sheet-overhang, 0px) + max(40px, calc(env(safe-area-inset-bottom, 0px) + 24px)))",
          // Stop the inner list from chaining its overscroll into the sheet /
          // page, which is what made hitting the end feel like a stutter.
          // MobileSheet's drag handoff reads scrollTop in JS rather than
          // relying on chaining, so drag-to-dismiss is unaffected.
          overscrollBehaviorY: "contain",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {children}
      </div>
    </div>
  );
}
