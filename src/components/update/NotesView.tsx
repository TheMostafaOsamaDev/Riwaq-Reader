import type { ReactNode } from "react";
import { useI18n } from "../../i18n/useI18n";
import {
  type ChangeKind,
  pick,
  type ReleaseNotes,
} from "../../store/releaseNotes";
import { RELEASES_PAGE_URL } from "../../store/updates";
import type { Theme } from "../../styles/tokens";
import { Icon } from "../Icon";

const KIND_ICON = {
  new: "plus",
  improved: "chevronsU",
  fixed: "check",
} as const;
const KIND_KEY = {
  new: "whatsNew.kind.new",
  improved: "whatsNew.kind.improved",
  fixed: "whatsNew.kind.fixed",
} as const;

/** Tag with an icon AND a word. Colour only reinforces it, so the meaning
 *  survives colour blindness and the monochrome OLED theme. */
export function KindTag({ kind, theme }: { kind: ChangeKind; theme: Theme }) {
  const { tr } = useI18n();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flex: "none",
        height: 20,
        padding: "0 7px",
        borderRadius: 6,
        fontSize: 10.5,
        fontWeight: 600,
        background: theme.hover,
        color: kind === "fixed" ? theme.danger : theme.ink,
      }}
    >
      <Icon name={KIND_ICON[kind]} size={11} stroke={2.2} />
      {tr(KIND_KEY[kind])}
    </span>
  );
}

export function NotesView({
  notes,
  theme,
  imageUrl,
  fallbackVersion,
}: {
  notes: ReleaseNotes | null;
  theme: Theme;
  imageUrl?: (name: string) => string | undefined;
  fallbackVersion?: string;
}): ReactNode {
  const { tr, locale } = useI18n();
  if (!notes) {
    return (
      <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
        <p style={{ margin: "0 0 10px" }}>
          {tr("whatsNew.noNotes", { v: fallbackVersion ?? "" })}
        </p>
        <a
          href={RELEASES_PAGE_URL}
          onClick={(e) => {
            e.preventDefault();
            void import("@tauri-apps/plugin-opener").then((m) =>
              m.openUrl(RELEASES_PAGE_URL),
            );
          }}
          style={{
            color: theme.ink,
            display: "inline-flex",
            gap: 6,
            alignItems: "center",
            minHeight: 44,
          }}
        >
          {tr("whatsNew.onGithub")} <Icon name="externalLink" size={14} />
        </a>
      </div>
    );
  }
  const h = notes.highlight;
  const src = h?.image ? imageUrl?.(h.image) : undefined;
  return (
    <div>
      {h && (
        <section
          style={{
            borderRadius: 16,
            background: theme.chrome,
            padding: 14,
            marginBottom: 12,
          }}
        >
          {src && (
            <img
              src={src}
              alt=""
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                maxHeight: 140,
                objectFit: "contain",
                borderRadius: 10,
                background: theme.bg,
                marginBottom: 12,
              }}
            />
          )}
          <span
            style={{
              fontSize: 10.5,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: theme.muted,
              fontWeight: 600,
            }}
          >
            {tr("whatsNew.highlight")}
          </span>
          <h3 style={{ margin: "6px 0 4px", fontSize: 15, fontWeight: 600 }}>
            {pick(h.title, locale)}
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: theme.muted,
            }}
          >
            {pick(h.body, locale)}
          </p>
        </section>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {notes.items.map((it) => (
          <li
            key={`${it.kind}:${it.en}`}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "9px 0",
              borderBottom: `0.5px solid ${theme.rule}`,
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            <KindTag kind={it.kind} theme={theme} />
            <span>{pick(it, locale)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
