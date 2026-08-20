import { useState } from "react";
import { Icon } from "../components/Icon";
import type { Highlight } from "../store/library";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  HIGHLIGHT_COLORS,
  hlBg,
  type Theme,
  type ThemeKey,
} from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";
import { PanelShell } from "./PanelShell";

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  onClose?: () => void;
  highlights: Highlight[];
  onJump?: (h: Highlight) => void;
  onDelete?: (id: string) => void;
  onUpdateNote?: (id: string, note: string) => void;
  width?: number | string;
  side?: "left" | "right";
}

interface HighlightGroup {
  /** Stable key for React reconciliation. `groupId` for multi-paragraph
   *  selections; the highlight's own id for ungrouped (single-paragraph or
   *  legacy) entries. */
  key: string;
  /** First member by paragraphIndex — what every per-group operation
   *  targets. Creation logic in MobileReader.createFromSelection puts
   *  the note on the first segment only, so its color/chapter/note
   *  already represent the group as a whole. */
  representative: Highlight;
  /** All members, sorted by paragraphIndex ascending. Includes the
   *  representative. */
  members: Highlight[];
}

function groupHighlights(highlights: Highlight[]): HighlightGroup[] {
  const buckets = new Map<string, Highlight[]>();
  for (const h of highlights) {
    // Solo key uses the highlight id to guarantee uniqueness — a future
    // migration that adds groupId to legacy entries can't collide with it.
    const key = h.groupId ?? `__solo_${h.id}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(h);
    else buckets.set(key, [h]);
  }
  const groups: HighlightGroup[] = [];
  for (const [key, members] of buckets) {
    members.sort((a, b) => a.paragraphIndex - b.paragraphIndex);
    groups.push({ key, representative: members[0], members });
  }
  // Most recent first — matches the order people expect when scanning
  // for "what did I just save?"
  groups.sort((a, b) => b.representative.ts - a.representative.ts);
  return groups;
}

export function HighlightsPanel({
  theme,
  themeKey,
  onClose,
  highlights,
  onJump,
  onDelete,
  onUpdateNote,
  width,
  side = "left",
}: Props) {
  const { tr } = useI18n();
  const groups = groupHighlights(highlights);
  return (
    <PanelShell
      theme={theme}
      title={tr("highlights.title")}
      subtitle={
        groups.length === 0
          ? tr("highlights.subtitleNone")
          : tr(
              groups.length === 1
                ? "highlights.subtitleCountOne"
                : "highlights.subtitleCountOther",
              { n: groups.length },
            )
      }
      onClose={onClose}
      icon={<Icon name="highlight" size={14} />}
      width={width}
      side={side}
    >
      {groups.length === 0 ? (
        <Empty theme={theme} />
      ) : (
        <div style={{ padding: "10px" }}>
          {groups.map((g) => (
            <HighlightRow
              key={g.key}
              theme={theme}
              themeKey={themeKey}
              group={g}
              onJump={onJump}
              onDelete={onDelete}
              onUpdateNote={onUpdateNote}
            />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function HighlightRow({
  theme,
  themeKey,
  group,
  onJump,
  onDelete,
  onUpdateNote,
}: {
  theme: Theme;
  themeKey: ThemeKey;
  group: HighlightGroup;
  onJump?: (h: Highlight) => void;
  onDelete?: (id: string) => void;
  onUpdateNote?: (id: string, note: string) => void;
}) {
  // Per-group operations target the representative — note edits stay
  // on the first segment (matching creation), delete is group-aware in
  // App.removeHighlight, and jump lands on the first paragraph of the
  // selection.
  const { tr } = useI18n();
  const h = group.representative;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(h.note ?? "");

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(h.note ?? "");
    setEditing(true);
  };
  const save = () => {
    if (onUpdateNote) onUpdateNote(h.id, draft);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(h.note ?? "");
    setEditing(false);
  };

  return (
    <div
      onClick={() => {
        if (editing) return;
        if (onJump) onJump(h);
      }}
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        marginBottom: 4,
        borderInlineStart: `3px solid ${HIGHLIGHT_COLORS[h.color].dot}`,
        background: hlBg(h.color, themeKey),
        cursor: editing ? "default" : onJump ? "pointer" : "default",
        position: "relative",
      }}
    >
      <div
        style={{
          // App UI font — matches the panel chrome and the reader's top
          // bar, and avoids the editorial serif's faux-italic look on
          // Arabic glyphs that the reader header used to show.
          fontFamily: FONT_STACKS.sans,
          fontSize: 13.5,
          lineHeight: 1.55,
          color: theme.ink,
          paddingInlineEnd: 56,
        }}
      >
        {group.members.map((m, i) => (
          <p
            key={m.id}
            // dir="auto" picks the paragraph direction from the first
            // strong directional character — so Arabic segments render
            // RTL even though the surrounding panel chrome is LTR.
            dir="auto"
            style={{
              margin: 0,
              marginBlockEnd:
                i < group.members.length - 1 ? 8 : 0,
            }}
          >
            {m.text}
          </p>
        ))}
      </div>

      {editing ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ marginTop: 8 }}
        >
          <textarea
            value={draft}
            autoFocus
            // Auto-detect direction so an Arabic note flips to RTL while
            // the caret is in it; English notes stay LTR.
            dir="auto"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              }
            }}
            placeholder={tr("highlights.notePlaceholder")}
            rows={3}
            style={{
              width: "100%",
              background: theme.chrome,
              color: theme.ink,
              border: `0.5px solid ${theme.rule}`,
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 11.5,
              fontFamily: FONT_STACKS.sans,
              outline: "none",
              resize: "vertical",
              minHeight: 50,
            }}
          />
          <div
            style={{
              display: "flex",
              gap: 6,
              marginTop: 6,
              justifyContent: "flex-end",
            }}
          >
            <button onClick={cancel} style={ghostBtn(theme)}>
              {tr("common.cancel")}
            </button>
            <button onClick={save} style={primaryBtn(theme)}>
              {tr("common.save")}
            </button>
          </div>
        </div>
      ) : h.note ? (
        <div
          // dir="auto" + logical inline-start padding/border put the
          // quote bar on the side closest to the note's reading start
          // (left for English, right for Arabic).
          dir="auto"
          style={{
            fontFamily: FONT_STACKS.sans,
            fontSize: 11.5,
            color: theme.ink,
            marginTop: 8,
            paddingInlineStart: 10,
            borderInlineStart: `1.5px solid ${theme.rule}`,
            lineHeight: 1.4,
          }}
        >
          {h.note}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: theme.muted,
            fontFamily: FONT_STACKS.sans,
          }}
        >
          {tr("highlights.chapterLabel", { n: h.chapter + 1 })}
        </div>
        {!editing && (
          <div
            role="group"
            aria-label={tr("highlights.actions")}
            style={{ display: "flex", gap: 2 }}
          >
            {onUpdateNote && (
              <button
                onClick={startEdit}
                aria-label={h.note ? tr("highlights.editNote") : tr("highlights.addNote")}
                title={h.note ? tr("highlights.editNote") : tr("highlights.addNote")}
                style={iconBtn(theme)}
              >
                <Icon name="pencil" size={12} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(h.id);
                }}
                aria-label={tr("highlights.delete")}
                title={tr("highlights.delete")}
                style={iconBtn(theme)}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ theme }: { theme: Theme }) {
  const { tr } = useI18n();
  return (
    <div style={{ padding: "40px 24px", textAlign: "center" }}>
      <div
        style={{
          fontFamily: FONT_SERIF_DISPLAY,
          fontSize: 16,
          color: theme.ink,
          marginBottom: 6,
        }}
      >
        {tr("highlights.emptyTitle")}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: theme.muted,
          lineHeight: 1.5,
          maxWidth: 260,
          margin: "0 auto",
        }}
      >
        {tr("highlights.emptyBody")}
      </div>
    </div>
  );
}

function iconBtn(theme: Theme): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    border: "none",
    borderRadius: 5,
    background: "transparent",
    color: theme.muted,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function ghostBtn(theme: Theme): React.CSSProperties {
  return {
    padding: "4px 9px",
    border: `0.5px solid ${theme.rule}`,
    borderRadius: 6,
    background: "transparent",
    color: theme.ink,
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: FONT_STACKS.sans,
  };
}

function primaryBtn(theme: Theme): React.CSSProperties {
  return {
    padding: "4px 9px",
    border: "none",
    borderRadius: 6,
    background: theme.ink,
    color: theme.bg,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT_STACKS.sans,
  };
}
