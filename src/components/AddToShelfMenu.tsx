// Small popover offering the two ways to add books to a shelf: pick from
// the existing library, or import new files straight onto this shelf.
// Self-contained overlay (owns its own scrim + centering + a light fade/pop
// animation) — same shape as NewShelfDialog, so it is rendered directly by
// Library.tsx rather than wrapped in AnimatedDialog.

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, type IconProps } from "./Icon";
import { FONT_STACKS, type Theme } from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";

interface Props {
  theme: Theme;
  onFromLibrary: () => void;
  onFromDevice: () => void;
  onClose: () => void;
}

export function AddToShelfMenu({
  theme,
  onFromLibrary,
  onFromDevice,
  onClose,
}: Props) {
  const { tr } = useI18n();
  const firstRowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRowRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9500,
        background: "rgba(0,0,0,0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: FONT_STACKS.sans,
        animation: "leafletAddShelfFade 130ms ease",
      }}
    >
      <style>{`
        @keyframes leafletAddShelfFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes leafletAddShelfPop {
          from { opacity: 0; transform: translateY(6px) scale(0.98); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        role="menu"
        aria-label={tr("shelves.addBook")}
        style={{
          width: "min(300px, calc(100vw - 32px))",
          background: theme.bg,
          color: theme.ink,
          border: `0.5px solid ${theme.rule}`,
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
          animation: "leafletAddShelfPop 150ms ease",
        }}
      >
        <div
          style={{
            padding: "14px 16px 10px",
            fontSize: 12.5,
            fontWeight: 600,
            color: theme.muted,
            borderBottom: `0.5px solid ${theme.rule}`,
          }}
        >
          {tr("shelves.addBook")}
        </div>
        <div style={{ padding: 6 }}>
          <MenuRow
            ref={firstRowRef}
            theme={theme}
            icon="grid"
            label={tr("shelves.addFromLibrary")}
            onClick={() => {
              onFromLibrary();
              onClose();
            }}
          />
          <MenuRow
            theme={theme}
            icon="download"
            label={tr("shelves.addFromDevice")}
            onClick={() => {
              onFromDevice();
              onClose();
            }}
          />
        </div>
        <div
          style={{
            borderTop: `0.5px solid ${theme.rule}`,
            padding: 6,
          }}
        >
          <MenuRow theme={theme} label={tr("common.cancel")} onClick={onClose} muted centered />
        </div>
      </div>
    </div>
  );
}

interface MenuRowProps {
  theme: Theme;
  icon?: IconProps["name"];
  label: ReactNode;
  onClick: () => void;
  muted?: boolean;
  centered?: boolean;
}

const MenuRow = forwardRef<HTMLButtonElement, MenuRowProps>(function MenuRow(
  { theme, icon, label, onClick, muted, centered },
  ref,
) {
  const [hover, setHover] = useState(false);
  return (
    <button
      ref={ref}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: centered ? "center" : "flex-start",
        gap: 12,
        border: "none",
        background: hover ? theme.hover : "transparent",
        color: muted ? theme.muted : theme.ink,
        borderRadius: 8,
        padding: "10px 12px",
        font: "inherit",
        fontSize: 13.5,
        fontWeight: 500,
        cursor: "pointer",
        transition: "background 120ms ease",
        textAlign: "start",
      }}
    >
      {icon && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            flexShrink: 0,
            color: theme.ink,
          }}
        >
          <Icon name={icon} size={17} stroke={1.7} />
        </span>
      )}
      <span>{label}</span>
    </button>
  );
});
