import { useEffect, useState } from "react";
import { FONT_STACKS, type Theme, Z } from "../styles/tokens";

export type ToastKind = "info" | "warn" | "error";

/** The warning accent, shared with the background-import card so the two
 *  never disagree about what "partly went wrong" looks like. */
export const TOAST_WARN = "#c98b42";

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
  /** A CSS `bottom` for a toast lifted over the phone's bottom bar (the
   *  Android update toasts pass one). Passing it also sizes the toast to
   *  its sentence, up to the screen's width less a 16px gutter each side.
   *  Omitted, the toast renders exactly as it always has. */
  bottom?: string;
}

export function Toast({ theme, toast, onDismiss, ttl = 3500, bottom }: Props) {
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
        ? TOAST_WARN
        : theme.ink;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: bottom ?? 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: Z.toast,
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
        // With left:50% a shrink-to-fit box only gets half the viewport,
        // which on a phone wraps a sentence into a narrow column. A lifted
        // (phone) toast sizes to its content instead; 420px is the content
        // width, as on desktop; the 16px gutters plus the 36px padding and
        // 3.5px of border keep the whole box inside the screen.
        ...(bottom === undefined
          ? { maxWidth: 420 }
          : {
              width: "max-content",
              maxWidth: "min(420px, calc(100vw - 32px - 40px))",
            }),
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
