import { useEffect, useState } from "react";
import { FONT_STACKS, type Theme } from "../styles/tokens";

export type ToastKind = "info" | "warn" | "error";

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
  /** Optional trailing action (e.g. "Undo"). Rendered as a small text
   *  button; clicking it does not itself dismiss the toast — the auto-
   *  dismiss timer (or a later toast) still owns that. */
  action?: { label: string; onClick: () => void };
}

interface Props {
  theme: Theme;
  toast: ToastMessage | null;
  onDismiss: () => void;
  /** Auto-dismiss timeout in ms. Default 3500. */
  ttl?: number;
}

export function Toast({ theme, toast, onDismiss, ttl = 3500 }: Props) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, ttl);
    return () => clearTimeout(t);
  }, [toast, onDismiss, ttl]);

  if (!toast) return null;

  const accent =
    toast.kind === "error"
      ? "#c04a3a"
      : toast.kind === "warn"
        ? "#c98b42"
        : theme.ink;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: theme.chrome,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        borderInlineStart: `3px solid ${accent}`,
        borderRadius: 8,
        padding: "12px 18px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontFamily: FONT_STACKS.sans,
        fontSize: 13,
        lineHeight: 1.4,
        maxWidth: 420,
        boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
      }}
    >
      <span>{toast.text}</span>
      {toast.action && (
        <ToastActionButton
          theme={theme}
          label={toast.action.label}
          onClick={toast.action.onClick}
        />
      )}
    </div>
  );
}

function ToastActionButton({
  theme,
  label,
  onClick,
}: {
  theme: Theme;
  label: string;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flexShrink: 0,
        border: 0,
        background: "transparent",
        color: theme.ink,
        font: "inherit",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        padding: "2px 4px",
        marginInlineEnd: -4,
        borderRadius: 4,
        textDecoration: hover ? "underline" : "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
