// The "Shelves" content page — opened from the sidebar's Shelves item.
// Lists each shelf as its own section. Book assignment is UI-only for now
// (the real feature lands on its own branch), so each shelf shows an empty
// placeholder.

import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { Icon } from "./Icon";

interface Props {
  theme: Theme;
  shelves: string[];
  onNewShelf: () => void;
}

export function ShelvesPage({ theme, shelves, onNewShelf }: Props) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px 48px", fontFamily: FONT_STACKS.sans }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: FONT_SERIF_DISPLAY, fontStyle: "italic", fontWeight: 400, fontSize: 30, margin: 0, letterSpacing: "-0.01em", color: theme.ink }}>
            Shelves
          </h1>
          <div style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>
            {shelves.length} {shelves.length === 1 ? "shelf" : "shelves"} · your collections
          </div>
        </div>
        <button
          onClick={onNewShelf}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, border: 0, background: theme.ink, color: theme.paper, borderRadius: 10, padding: "10px 16px", font: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
        >
          <Icon name="plus" size={15} /> New shelf
        </button>
      </div>

      {shelves.length === 0 ? (
        <div style={{ maxWidth: 440, margin: "56px auto", padding: 32, borderRadius: 14, background: theme.chrome, border: `0.5px solid ${theme.rule}`, textAlign: "center" }}>
          <div style={{ fontFamily: FONT_SERIF_DISPLAY, fontStyle: "italic", fontSize: 24, color: theme.ink, marginBottom: 8 }}>No shelves yet</div>
          <div style={{ fontSize: 13, color: theme.muted, lineHeight: 1.55 }}>Create a shelf to group books your way.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {shelves.map((s) => (
            <section key={s}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
                <span style={{ color: theme.muted, display: "flex", alignSelf: "center" }}><Icon name="layers" size={16} /></span>
                <h2 style={{ fontFamily: FONT_SERIF_DISPLAY, fontStyle: "italic", fontWeight: 400, fontSize: 20, margin: 0, color: theme.ink }}>{s}</h2>
                <span style={{ fontSize: 12, color: theme.muted }}>0 books</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 110, border: `1px dashed ${theme.rule}`, borderRadius: 12, color: theme.muted, fontSize: 13 }}>
                No books in this shelf yet.
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
