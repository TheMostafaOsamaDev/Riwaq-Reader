// The "Shelves" content page — opened from the sidebar's Shelves item.
// Lists each shelf as its own section. Book assignment is UI-only for now
// (the real feature lands on its own branch), so each shelf shows an empty
// placeholder.

import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/useI18n";
import type { Shelf } from "../store/shelves";

interface Props {
  theme: Theme;
  shelves: Shelf[];
  onNewShelf: () => void;
}

export function ShelvesPage({ theme, shelves, onNewShelf }: Props) {
  const { tr } = useI18n();
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px 48px", fontFamily: FONT_STACKS.sans }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: FONT_SERIF_DISPLAY, fontWeight: 400, fontSize: 30, margin: 0, letterSpacing: "-0.01em", color: theme.ink }}>
            {tr("shelves.title")}
          </h1>
          <div style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>
            {tr(shelves.length === 1 ? "shelves.countOne" : "shelves.countOther", { n: shelves.length })}
          </div>
        </div>
        <button
          onClick={onNewShelf}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, border: 0, background: theme.ink, color: theme.paper, borderRadius: 10, padding: "10px 16px", font: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
        >
          <Icon name="plus" size={15} /> {tr("shelves.newShelf")}
        </button>
      </div>

      {shelves.length === 0 ? (
        <div style={{ maxWidth: 440, margin: "56px auto", padding: 32, borderRadius: 14, background: theme.chrome, border: `0.5px solid ${theme.rule}`, textAlign: "center" }}>
          <div style={{ fontFamily: FONT_SERIF_DISPLAY, fontSize: 24, color: theme.ink, marginBottom: 8 }}>{tr("shelves.empty")}</div>
          <div style={{ fontSize: 13, color: theme.muted, lineHeight: 1.55 }}>{tr("shelves.emptyHint")}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {shelves.map((s) => (
            <section key={s.id}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
                <span style={{ color: theme.muted, display: "flex", alignSelf: "center" }}><Icon name="layers" size={16} /></span>
                <h2 style={{ fontFamily: FONT_SERIF_DISPLAY, fontWeight: 400, fontSize: 20, margin: 0, color: theme.ink }}>{s.name}</h2>
                <span style={{ fontSize: 12, color: theme.muted }}>{tr("shelves.zeroBooks")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 110, border: `1px dashed ${theme.rule}`, borderRadius: 12, color: theme.muted, fontSize: 13 }}>
                {tr("shelves.sectionEmpty")}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
