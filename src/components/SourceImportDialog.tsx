// Dialog that triggers a Source-driven import.
//
// Layout: list of installed sources on top, URL input at the bottom. Pasting
// a URL auto-selects the source whose canHandle() accepts it. Clicking
// Import kicks off `importFromSourceUrl` — the existing import-progress
// modal (rendered at the app root) takes over from there, so this dialog
// closes immediately. That keeps a one-progress-modal-at-a-time invariant
// and matches how DOCX importing already feels.
//
// Mounted from Library.tsx behind a toolbar button. Nothing about this
// flow knows or cares which source was picked — the registry handles
// instantiation, the importer handles the rest.

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { findSourceForUrl, listSources } from "../sources/registry";
import type { SourceMetadata } from "../sources/types";

interface Props {
  theme: Theme;
  onCancel: () => void;
  /** Called after the dialog has handed off to the importer. The progress
   *  modal owns the rest of the lifecycle; the caller usually just closes
   *  the dialog and refreshes the library when the import finishes. */
  onSubmit: (sourceId: string, url: string) => void;
}

export function SourceImportDialog({ theme, onCancel, onSubmit }: Props) {
  const sources = useMemo(() => listSources(), []);
  const [selectedId, setSelectedId] = useState<string | null>(
    sources[0]?.id ?? null,
  );
  const [url, setUrl] = useState("");
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    urlRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Whenever the URL changes, see if any source recognizes it — if so,
  // jump the selection over. The user can still override by clicking a
  // different source row; auto-detect is a hint, not a constraint.
  useEffect(() => {
    if (!url.trim()) return;
    try {
      const auto = findSourceForUrl(url.trim());
      if (auto && auto.meta.id !== selectedId) {
        setSelectedId(auto.meta.id);
      }
    } catch {
      // ignore invalid URLs during typing
    }
  }, [url, selectedId]);

  const trimmedUrl = url.trim();
  const selected = sources.find((s) => s.id === selectedId) ?? null;
  // Show a soft warning if the URL doesn't match the selected source's base
  // domain. Doesn't block submit — the user might be using a mirror — but
  // signals that they may have picked the wrong source.
  const urlMatchesSelected = useMemo(() => {
    if (!selected || !trimmedUrl) return true;
    try {
      const u = new URL(trimmedUrl);
      const base = new URL(selected.baseUrl);
      // Suffix match so subdomains of the same brand (free.kolnovel.com)
      // count as the same source.
      return (
        u.hostname === base.hostname ||
        u.hostname.endsWith("." + base.hostname.replace(/^www\./, "")) ||
        base.hostname.endsWith("." + u.hostname.replace(/^www\./, ""))
      );
    } catch {
      return false;
    }
  }, [selected, trimmedUrl]);

  const canSubmit = !!selectedId && /^https?:\/\//i.test(trimmedUrl);
  const submit = () => {
    if (!canSubmit || !selectedId) return;
    onSubmit(selectedId, trimmedUrl);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-import-title"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9700,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: FONT_STACKS.sans,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 100%)",
          maxHeight: "90vh",
          background: theme.bg,
          color: theme.ink,
          borderRadius: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
          border: `0.5px solid ${theme.rule}`,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "22px 22px 8px" }}>
          <div
            id="source-import-title"
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontStyle: "italic",
              fontSize: 22,
              color: theme.ink,
              letterSpacing: "-0.01em",
              marginBottom: 6,
            }}
          >
            Add from a source
          </div>
          <div
            style={{
              fontSize: 13,
              color: theme.muted,
              lineHeight: 1.5,
            }}
          >
            Pick a website extension and paste the novel's index page URL.
            Leaflet will fetch every chapter and turn it into an EPUB.
          </div>
        </div>

        <div
          style={{
            padding: "8px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: theme.muted,
              marginTop: 4,
              marginBottom: 2,
            }}
          >
            Source
          </div>
          {sources.length === 0 ? (
            <div
              style={{
                color: theme.muted,
                fontSize: 13,
                padding: "12px 0",
              }}
            >
              No sources installed.
            </div>
          ) : (
            sources.map((s) => (
              <SourceRow
                key={s.id}
                theme={theme}
                source={s}
                selected={s.id === selectedId}
                onClick={() => setSelectedId(s.id)}
              />
            ))
          )}
        </div>

        <div style={{ padding: "16px 22px 8px" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: theme.muted,
              marginBottom: 6,
            }}
          >
            Novel URL
          </div>
          <input
            ref={urlRef}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              selected
                ? `${selected.baseUrl.replace(/\/$/, "")}/series/your-novel`
                : "https://…"
            }
            spellCheck={false}
            autoComplete="off"
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 13,
              fontFamily: "inherit",
              color: theme.ink,
              background: theme.chrome,
              border: `0.5px solid ${theme.rule}`,
              borderRadius: 8,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {trimmedUrl && !urlMatchesSelected && (
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: theme.muted,
                lineHeight: 1.4,
              }}
            >
              This URL doesn't match {selected?.name ?? "this source"}'s base
              domain. Continue if you're using a mirror — otherwise pick the
              right source above.
            </div>
          )}
        </div>

        <div
          style={{
            padding: "12px 22px 16px",
            borderTop: `0.5px solid ${theme.rule}`,
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <Button theme={theme} variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            disabled={!canSubmit}
            onClick={submit}
            leadingIcon={<Icon name="download" size={13} />}
          >
            Import
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SourceRowProps {
  theme: Theme;
  source: SourceMetadata;
  selected: boolean;
  onClick: () => void;
}

function SourceRow({ theme, source, selected, onClick }: SourceRowProps) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        background: selected ? theme.ink : theme.chrome,
        color: selected ? theme.bg : theme.ink,
        border: selected ? "none" : `0.5px solid ${theme.rule}`,
        borderRadius: 8,
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "filter 100ms ease",
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          flexShrink: 0,
          borderRadius: 8,
          background: selected ? "rgba(255,255,255,0.12)" : theme.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: selected ? theme.bg : theme.ink,
        }}
      >
        <Icon name="globe" size={16} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            marginBottom: 2,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "-0.005em",
            }}
          >
            {source.name}
          </span>
          <span
            style={{
              fontSize: 11,
              color: selected ? "rgba(255,255,255,0.55)" : theme.muted,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {source.language}
          </span>
        </span>
        <span
          style={{
            display: "block",
            fontSize: 12,
            color: selected ? "rgba(255,255,255,0.72)" : theme.muted,
            lineHeight: 1.4,
          }}
        >
          {source.description ?? source.baseUrl}
        </span>
      </span>
    </button>
  );
}
