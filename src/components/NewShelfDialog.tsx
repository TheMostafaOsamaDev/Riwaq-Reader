// Small modal to name and create a new shelf. (Shelves are UI-only for
// now; the real feature — persistence + book assignment — lands on its
// own branch.)

import { useEffect, useRef, useState } from "react";
import { FONT_STACKS, type Theme } from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";

interface Props {
  theme: Theme;
  existing: string[];
  /** When renaming, the current name (prefilled) and the value excluded from
   *  the duplicate check so re-saving the same name is allowed. */
  initialName?: string;
  title?: string;
  hint?: string;
  confirmLabel?: string;
  onCreate: (name: string) => void;
  onClose: () => void;
}

export function NewShelfDialog({
  theme,
  existing,
  initialName,
  title,
  hint,
  confirmLabel,
  onCreate,
  onClose,
}: Props) {
  const { tr } = useI18n();
  const [name, setName] = useState(initialName ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trimmed = name.trim();
  const dupe = existing.some(
    (s) =>
      s.toLowerCase() === trimmed.toLowerCase() &&
      s.toLowerCase() !== (initialName ?? "").trim().toLowerCase(),
  );
  const valid = trimmed.length > 0 && !dupe;
  const create = () => { if (valid) { onCreate(trimmed); onClose(); } };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1100,
        background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "16vh 20px 20px",
        fontFamily: FONT_STACKS.sans, animation: "riwaqFadeIn 130ms ease",
      }}
    >
      <style>{`@keyframes riwaqFadeIn{from{opacity:0}to{opacity:1}}@keyframes riwaqPop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: "100%", maxWidth: 400, background: theme.paper, color: theme.ink,
          border: `1px solid ${theme.rule}`, borderRadius: 16, padding: 22,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)", animation: "riwaqPop 150ms ease",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{title ?? tr("shelves.newShelf")}</div>
        <div style={{ fontSize: 12.5, color: theme.muted, marginBottom: 16 }}>
          {hint ?? tr("shelves.dialogHint")}
        </div>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          placeholder={tr("shelves.namePlaceholder")}
          style={{
            width: "100%", boxSizing: "border-box", border: `1px solid ${dupe ? "#c0503a" : theme.rule}`,
            background: theme.bg, color: theme.ink, borderRadius: 10, padding: "11px 13px",
            font: "inherit", fontSize: 14, outline: "none",
          }}
        />
        <div style={{ minHeight: 16, marginTop: 6, fontSize: 11.5, color: "#c0503a" }}>
          {dupe ? tr("shelves.duplicateName") : ""}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
          <button
            onClick={onClose}
            style={{ border: `1px solid ${theme.rule}`, background: "transparent", color: theme.ink, borderRadius: 10, padding: "9px 16px", font: "inherit", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
          >
            {tr("common.cancel")}
          </button>
          <button
            onClick={create}
            disabled={!valid}
            style={{ border: 0, background: theme.ink, color: theme.paper, borderRadius: 10, padding: "9px 18px", font: "inherit", fontSize: 13, fontWeight: 600, cursor: valid ? "pointer" : "default", opacity: valid ? 1 : 0.5 }}
          >
            {confirmLabel ?? tr("shelves.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
