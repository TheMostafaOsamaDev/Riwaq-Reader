// Full-screen, one feature per page, shown once after a BIG release (one
// whose notes define `stories`). Small releases never get here — see
// WhatsNewAfterUpdate.
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import { pick, type ReleaseNotes } from "../../store/releaseNotes";
import { type Theme, Z } from "../../styles/tokens";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { KindTag } from "./NotesView";

export function StoryPages({
  notes,
  theme,
  imageUrl,
  onDone,
}: {
  notes: ReleaseNotes;
  theme: Theme;
  imageUrl?: (name: string) => string | undefined;
  onDone: () => void;
}) {
  const { tr, locale } = useI18n();
  const pages = notes.stories ?? [];
  const [i, setI] = useState(0);
  // Escape leaves the tour, like it leaves any dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);
  const page = pages[i];
  if (!page) return null;
  const last = i === pages.length - 1;
  const src = page.image ? imageUrl?.(page.image) : undefined;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr("whatsNew.title", { v: notes.version })}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z.modal,
        background: theme.bg,
        color: theme.ink,
        display: "flex",
        flexDirection: "column",
        padding:
          "calc(env(safe-area-inset-top, 0px) + 20px) 22px calc(env(safe-area-inset-bottom, 0px) + 22px)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 11,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: theme.muted,
            fontWeight: 600,
          }}
        >
          {tr("whatsNew.title", { v: notes.version })}
        </span>
        <Button theme={theme} variant="ghost" size="sm" onClick={onDone}>
          {tr("whatsNew.skip")}
        </Button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: 22,
          background: theme.chrome,
          margin: "20px 0",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
        }}
      >
        {src ? (
          <img
            src={src}
            alt=""
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        ) : (
          <Icon name="book" size={84} stroke={1.2} />
        )}
      </div>
      {page.kind && (
        <span>
          <KindTag kind={page.kind} theme={theme} />
        </span>
      )}
      <h2
        style={{
          margin: "8px 0",
          fontSize: 22,
          fontWeight: 600,
          lineHeight: 1.25,
        }}
      >
        {pick(page.title, locale)}
      </h2>
      <p
        style={{
          margin: "0 0 18px",
          fontSize: 14,
          lineHeight: 1.55,
          color: theme.muted,
        }}
      >
        {pick(page.body, locale)}
      </p>
      <div
        role="img"
        aria-label={tr("whatsNew.page", { n: i + 1, total: pages.length })}
        style={{
          display: "flex",
          gap: 6,
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        {pages.map((p, k) => (
          <i
            key={p.title.en}
            style={{
              width: k === i ? 20 : 7,
              height: 7,
              borderRadius: 4,
              background: k === i ? theme.ink : theme.ruleStrong,
            }}
          />
        ))}
      </div>
      <Button
        theme={theme}
        variant="primary"
        fullWidth
        onClick={() => (last ? onDone() : setI(i + 1))}
      >
        {last ? tr("whatsNew.done") : tr("whatsNew.next")}
      </Button>
    </div>
  );
}
