import type { Tr } from "../i18n";
import { FONT_STACKS, type Theme } from "../styles/tokens";

interface Props {
  theme: Theme;
  tr: Tr;
  /** True while the book is still being loaded. */
  loading: boolean;
  /** Why the open failed, when something said so. */
  error: string | null;
  onBack: () => void;
}

/**
 * What the reader route shows when it has no book to show.
 *
 * This branch used to be a bare `null`. While the load is in flight that is
 * right — App's full-page spinner is already covering the screen, and drawing
 * a second message behind it would flash on every open. But when the load
 * FAILS, the spinner comes down and `null` keeps rendering: the app is left on
 * a reader route with no book, no chrome, and nothing to press. Android users
 * can back out with the hardware button; on desktop it is a dead end.
 *
 * So: nothing while loading, and a way out once loading has stopped.
 */
export function ReaderFallback({ theme, tr, loading, error, onBack }: Props) {
  // Nothing to say while the load is in flight (the spinner has the screen),
  // and nothing to say before one has been attempted either: the restore path
  // flips the route to "reader" and only runs the loading effect afterwards,
  // so there is always a frame with no book and no error yet. The recovery
  // view is for a load that actually FAILED, which is the only state that
  // stays put.
  if (loading || !error) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        background: theme.bg,
        color: theme.ink,
        fontFamily: FONT_STACKS.sans,
      }}
    >
      <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
          {tr("reader.couldNotOpen")}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: theme.muted,
            marginBottom: 20,
            lineHeight: 1.6,
            wordBreak: "break-word",
          }}
        >
          {error}
        </div>
        <button
          type="button"
          onClick={onBack}
          style={{
            cursor: "pointer",
            font: "inherit",
            fontSize: 13,
            minHeight: 44,
            padding: "0 18px",
            borderRadius: 10,
            border: "none",
            background: theme.ink,
            color: theme.bg,
          }}
        >
          {tr("reader.backToLibrary")}
        </button>
      </div>
    </div>
  );
}
