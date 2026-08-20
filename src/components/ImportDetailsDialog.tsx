// Shown right after picking a PDF/DOCX (single file or a folder queue): lets the
// user edit the title and pick a cover before the book is written to the
// library. Cover options are suggestions pulled from the file (PDF page
// thumbnails / DOCX embedded images), a "choose from device" tile, and a
// generated-spine fallback. Thumbnails load lazily from the draft's candidates
// so a big file doesn't decode everything at once.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Button } from "./Button";
import { BookCover } from "./BookCover";
import { paletteForId } from "../store/palette";
import {
  ACCENT,
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
} from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";
import type {
  CoverCandidate,
  CoverChoice,
  FixedImportDraft,
} from "../store/fixedImportStage";

interface Props {
  theme: Theme;
  draft: FixedImportDraft;
  /** 0-based position + total in the current queue (folder / multi-select). */
  index: number;
  total: number;
  busy: boolean;
  onConfirm: (title: string, cover: CoverChoice) => void;
  /** Import this file with defaults, advance (queue only). */
  onSkip: () => void;
  /** Import all remaining files with defaults (queue, >1 remaining). */
  onSkipRest: () => void;
  /** Single-file: dispose without importing. */
  onCancel: () => void;
  /** Open the OS image picker; returns bytes+ext or null if dismissed. */
  pickCustomImage: () => Promise<{ bytes: Uint8Array; ext: string } | null>;
  /** Locale-aware digit formatter for the "٢ / ٥" counter. */
  fmt: (n: number) => string;
}

function defaultChoice(draft: FixedImportDraft): CoverChoice {
  return draft.defaultCoverId
    ? { kind: "candidate", id: draft.defaultCoverId }
    : { kind: "none" };
}

export function ImportDetailsDialog({
  theme,
  draft,
  index,
  total,
  busy,
  onConfirm,
  onSkip,
  onSkipRest,
  onCancel,
  pickCustomImage,
  fmt,
}: Props) {
  const { tr, locale } = useI18n();
  const isAr = locale === "ar";
  const single = total <= 1;
  const remaining = total - index;

  const [title, setTitle] = useState(draft.title);
  const [choice, setChoice] = useState<CoverChoice>(() => defaultChoice(draft));
  const [custom, setCustom] = useState<{
    url: string;
    bytes: Uint8Array;
    ext: string;
  } | null>(null);
  const customUrlRef = useRef<string | null>(null);

  // Reset all state when the queue advances to the next draft.
  useEffect(() => {
    setTitle(draft.title);
    setChoice(defaultChoice(draft));
    if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current);
    customUrlRef.current = null;
    setCustom(null);
  }, [draft]);

  useEffect(
    () => () => {
      if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current);
    },
    [],
  );

  // Close (X / Esc / backdrop): single-file cancels; a queue skips the current.
  const dismiss = useCallback(() => {
    if (busy) return;
    if (single) onCancel();
    else onSkip();
  }, [busy, single, onCancel, onSkip]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const chooseCustom = async () => {
    const picked = await pickCustomImage();
    if (!picked) return;
    if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current);
    const url = URL.createObjectURL(new Blob([picked.bytes.slice().buffer]));
    customUrlRef.current = url;
    setCustom({ url, bytes: picked.bytes, ext: picked.ext });
    setChoice({ kind: "custom", bytes: picked.bytes, ext: picked.ext });
  };

  const confirm = () => onConfirm(title, choice);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr("dialog.importBook.title")}
      onClick={dismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: FONT_STACKS.sans,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100%)",
          maxHeight: "88vh",
          background: theme.bg,
          color: theme.ink,
          borderRadius: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
          border: `0.5px solid ${theme.rule}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `0.5px solid ${theme.rule}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: FONT_SERIF_DISPLAY,
                fontSize: 18,
                color: theme.ink,
              }}
            >
              {tr("dialog.importBook.title")}
            </div>
            <div
              style={{
                fontSize: 11,
                color: theme.muted,
                marginTop: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {draft.filename}
            </div>
          </div>
          {total > 1 && (
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: theme.muted,
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
              }}
            >
              {fmt(index + 1)} / {fmt(total)}
            </div>
          )}
          <button
            onClick={dismiss}
            aria-label={tr("common.close")}
            style={{
              width: 32,
              height: 32,
              border: "none",
              background: "transparent",
              color: theme.chromeInk,
              borderRadius: 8,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          <FieldLabel theme={theme} isAr={isAr}>
            {tr("dialog.importBook.fieldTitle")}
          </FieldLabel>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: theme.chrome,
              color: theme.ink,
              border: `0.5px solid ${theme.rule}`,
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: FONT_STACKS.sans,
              outline: "none",
              marginBottom: 20,
            }}
          />

          <FieldLabel theme={theme} isAr={isAr}>
            {tr("dialog.importBook.cover")}
          </FieldLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
              gap: 10,
              marginTop: 4,
            }}
          >
            {/* Suggestions from the file */}
            {draft.candidates.map((cand) => (
              <CoverTile
                key={cand.id}
                theme={theme}
                candidate={cand}
                selected={choice.kind === "candidate" && choice.id === cand.id}
                onSelect={() => setChoice({ kind: "candidate", id: cand.id })}
              />
            ))}

            {/* Generated (no image) */}
            <TileShell
              theme={theme}
              selected={choice.kind === "none"}
              onClick={() => setChoice({ kind: "none" })}
              ariaLabel={tr("dialog.importBook.coverGenerated")}
              noClip
            >
              <BookCover
                title={title || draft.title}
                author={draft.author}
                palette={paletteForId(draft.id)}
                size="sm"
                fluid
              />
            </TileShell>

            {/* Custom (device) picked image, once chosen */}
            {custom && (
              <TileShell
                theme={theme}
                selected={choice.kind === "custom"}
                onClick={() =>
                  setChoice({
                    kind: "custom",
                    bytes: custom.bytes,
                    ext: custom.ext,
                  })
                }
                ariaLabel={tr("dialog.importBook.coverFromFile")}
              >
                <img
                  src={custom.url}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </TileShell>
            )}

            {/* Choose from device — placed last so the upload action ends the grid */}
            <TileShell
              theme={theme}
              selected={false}
              onClick={chooseCustom}
              ariaLabel={tr("dialog.importBook.coverFromFile")}
              dashed
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  height: "100%",
                  color: theme.muted,
                  padding: 6,
                  textAlign: "center",
                }}
              >
                <Icon name="image" size={20} />
                <span style={{ fontSize: 10.5, lineHeight: 1.3 }}>
                  {tr("dialog.importBook.coverFromFile")}
                </span>
              </div>
            </TileShell>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: `0.5px solid ${theme.rule}`,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {!single && remaining > 1 && (
            <Button
              theme={theme}
              variant="ghost"
              size="sm"
              onClick={onSkipRest}
              disabled={busy}
            >
              {tr("dialog.importBook.skipRest")}
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <Button
            theme={theme}
            variant="outline"
            size="sm"
            onClick={single ? onCancel : onSkip}
            disabled={busy}
          >
            {single ? tr("common.cancel") : tr("dialog.importBook.skip")}
          </Button>
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            onClick={confirm}
            disabled={busy}
          >
            {busy ? tr("common.saving") : tr("dialog.importBook.add")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CoverTile({
  theme,
  candidate,
  selected,
  onSelect,
}: {
  theme: Theme;
  candidate: CoverCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    candidate
      .thumb()
      .then((u) => {
        if (live) setUrl(u);
      })
      .catch(() => {
        /* thumbnail failed — leave the skeleton */
      });
    return () => {
      live = false;
    };
  }, [candidate]);

  return (
    <TileShell theme={theme} selected={selected} onClick={onSelect}>
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <div style={{ width: "100%", height: "100%", background: theme.hover }} />
      )}
    </TileShell>
  );
}

function TileShell({
  theme,
  selected,
  onClick,
  children,
  ariaLabel,
  dashed = false,
  noClip = false,
}: {
  theme: Theme;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  dashed?: boolean;
  noClip?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={ariaLabel}
      style={{
        position: "relative",
        aspectRatio: "2 / 3",
        padding: 0,
        borderRadius: 8,
        overflow: noClip ? "visible" : "hidden",
        cursor: "pointer",
        background: theme.chrome,
        border: dashed
          ? `1px dashed ${theme.rule}`
          : `0.5px solid ${theme.rule}`,
        outline: selected ? `2.5px solid ${ACCENT}` : "none",
        outlineOffset: 1,
        transition: "outline-color 120ms ease",
      }}
    >
      {children}
      {selected && (
        <span
          style={{
            position: "absolute",
            top: 4,
            insetInlineEnd: 4,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: ACCENT,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }}
        >
          <Icon name="check" size={11} stroke={2.4} />
        </span>
      )}
    </button>
  );
}

function FieldLabel({
  theme,
  isAr,
  children,
}: {
  theme: Theme;
  isAr: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        color: theme.muted,
        letterSpacing: isAr ? "normal" : "0.08em",
        textTransform: isAr ? "none" : "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}
