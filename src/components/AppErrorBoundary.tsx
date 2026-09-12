import { Component, type ErrorInfo, type ReactNode } from "react";
import { Z } from "../styles/tokens";

/**
 * The last line of defence against a blank screen.
 *
 * `ReaderErrorBoundary` covers the two reader views. Nothing covered anything
 * else, so a render error in the Library, the import dialog, ImportProgress,
 * the lightbox — or App itself — unmounted the entire tree. What is left is the
 * boot background and nothing at all: no chrome, and not even the app-level
 * spinner or error toast, since those go with it. From a screenshot that is
 * indistinguishable from a book that loaded blank, and the two have completely
 * different causes.
 *
 * It leans on as little of the app as it can. Colours come from the `--boot-*`
 * custom properties index.html sets before any module runs, with literals as a
 * fallback, and the copy is English-only rather than reaching for an i18n
 * provider that may itself be the casualty — a boundary that re-enters the
 * broken subtree shows nothing, which is the bug it exists to prevent.
 *
 * The one import is `Z`, for the stacking scale the whole app shares (a bare
 * z-index here is a lint failure, and rightly). That is safe: a boundary
 * catches errors thrown while RENDERING, and a tokens module that failed at
 * IMPORT would stop main.tsx loading at all, long before any boundary could
 * help.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? null });
    console.error("[app] render error", error, info.componentStack);
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    const details = [error.stack || error.message, stack ?? ""]
      .join("\n\n")
      .trim();

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: Z.appError,
          background: "var(--boot-bg, #f4ecd8)",
          color: "var(--boot-ink, #3a2f1f)",
          font: "14px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          direction: "ltr",
          overflow: "auto",
        }}
      >
        <div style={{ width: "100%", maxWidth: 620 }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
            Riwaq hit an unexpected error
          </div>
          <div style={{ opacity: 0.75, marginBottom: 16, fontSize: 13 }}>
            Your library is on disk and was not touched. Reloading is safe — if
            it happens again, the details below say where it broke.
          </div>
          <pre
            style={{
              margin: 0,
              maxHeight: "45vh",
              overflow: "auto",
              padding: 12,
              borderRadius: 8,
              background: "rgba(127,127,127,0.14)",
              border: "1px solid rgba(127,127,127,0.35)",
              font: "11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            {details || String(error)}
          </pre>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => {
                window.location.reload();
              }}
              style={{
                cursor: "pointer",
                font: "inherit",
                fontSize: 13,
                minHeight: 44,
                padding: "0 18px",
                borderRadius: 10,
                border: "none",
                background: "var(--boot-ink, #3a2f1f)",
                color: "var(--boot-bg, #f4ecd8)",
              }}
            >
              Reload Riwaq
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(details);
              }}
              style={{
                cursor: "pointer",
                font: "inherit",
                fontSize: 13,
                minHeight: 44,
                padding: "0 18px",
                borderRadius: 10,
                background: "transparent",
                color: "inherit",
                border: "1px solid rgba(127,127,127,0.55)",
              }}
            >
              Copy details
            </button>
          </div>
        </div>
      </div>
    );
  }
}
