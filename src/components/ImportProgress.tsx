// The detail view for the document-import flow: a full overlay with an
// animated stepper + progress bar, shown while the import is active and not
// minimized.
//
// Minimized renders nothing. The bottom bar's centre FAB carries the ring
// (see store/importIndicator.ts) and a tap on it un-minimizes this modal —
// there used to be a floating chip here doing the same job, which meant two
// progress indicators on screen for one import.
//
// The import itself lives in the module-scoped store (`useImportProgress`),
// so it keeps running regardless of what is mounted — closing the modal does
// NOT cancel.

import { useEffect } from "react";
import {
  dismiss,
  setMinimized,
  useImportProgress,
  type Step,
} from "../store/importProgress";
import { ACCENT, FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";
import { errorLabel, phaseLabel } from "../i18n/statusLabels";

interface Props {
  theme: Theme;
}

// Auto-clear the store this many ms after a successful run finishes — gives
// the dock/modal a moment to flash the completion state before disappearing.
const AUTO_DISMISS_MS = 2200;

export function ImportProgress({ theme }: Props) {
  const state = useImportProgress();

  // Auto-dismiss success runs. Errors stick around so the user can read the
  // message and dismiss manually.
  useEffect(() => {
    if (!state.active) return;
    if (state.finishedAt === null) return;
    if (state.error) return;
    const t = setTimeout(() => dismiss(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [state.active, state.finishedAt, state.error]);

  if (!state.active) return null;
  // Minimized means "no chrome at all". The bottom-bar FAB is the only
  // import indicator now, and tapping it un-minimizes this modal back into
  // view — so a floating chip would just be the same progress twice.
  if (state.minimized) return null;

  return (
    <>
      <KeyframesOnce />
      <Modal theme={theme} />
    </>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────

function Modal({ theme }: { theme: Theme }) {
  const { tr } = useI18n();
  const state = useImportProgress();
  const onMinimize = () => setMinimized(true);
  const onDismiss = () => dismiss();

  // Esc → minimize while running, dismiss after finish/error.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (state.finishedAt !== null) onDismiss();
      else onMinimize();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.finishedAt]);

  const finished = state.finishedAt !== null;
  const errored = state.error !== null;
  const titleText = errored
    ? tr("import.progress.titleFailed")
    : finished
      ? tr("import.progress.titleComplete")
      : tr("import.progress.titleImporting");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-progress-title"
      onClick={() => (finished ? onDismiss() : onMinimize())}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: FONT_STACKS.sans,
        animation: "import-fade-in 200ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(440px, 100%)",
          background: theme.bg,
          color: theme.ink,
          borderRadius: 16,
          border: `0.5px solid ${theme.rule}`,
          boxShadow: "0 28px 80px rgba(0,0,0,0.45)",
          overflow: "hidden",
          animation: "import-modal-in 320ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 20px 4px",
          }}
        >
          <div
            id="import-progress-title"
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontSize: 19,
              color: theme.ink,
              letterSpacing: "-0.01em",
            }}
          >
            {titleText}
          </div>
          <button
            onClick={finished ? onDismiss : onMinimize}
            aria-label={finished ? tr("common.close") : tr("import.progress.continueInBackground")}
            title={finished ? tr("common.close") : tr("import.progress.continueInBackground")}
            style={{
              border: "none",
              background: "transparent",
              color: theme.muted,
              cursor: "pointer",
              padding: 6,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CloseGlyph size={16} />
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ padding: "8px 20px 0" }}>
          <ProgressBar
            theme={theme}
            value={state.overall}
            errored={errored}
          />
        </div>

        {/* Steps */}
        <div
          style={{
            padding: "16px 20px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {state.steps.map((s) => (
            <StepRow key={s.id} theme={theme} step={s} />
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px 18px",
            borderTop: `0.5px solid ${theme.rule}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            fontSize: 12,
            color: theme.muted,
          }}
        >
          {errored ? (
            <>
              <div style={{ flex: 1, color: "#c04a3a", lineHeight: 1.4 }}>
                {errorLabel(state.error ?? "", tr)}
              </div>
              <button
                onClick={onDismiss}
                style={pillButton(theme)}
              >
                {tr("import.progress.dismiss")}
              </button>
            </>
          ) : finished ? (
            <>
              <div style={{ flex: 1 }}>{tr("import.progress.addedToLibrary")}</div>
              <button onClick={onDismiss} style={pillButton(theme)}>
                {tr("common.close")}
              </button>
            </>
          ) : (
            <>
              <div style={{ flex: 1 }}>{tr("import.progress.staysRunning")}</div>
              <button onClick={onMinimize} style={pillButton(theme)}>
                {tr("import.progress.continueInBackground")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function pillButton(theme: Theme): React.CSSProperties {
  return {
    border: `0.5px solid ${theme.rule}`,
    background: theme.chrome,
    color: theme.ink,
    fontSize: 12,
    fontWeight: 500,
    padding: "6px 12px",
    borderRadius: 999,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

// ── Progress bar ──────────────────────────────────────────────────────────

function ProgressBar({
  theme,
  value,
  errored,
}: {
  theme: Theme;
  value: number;
  errored: boolean;
}) {
  const pct = Math.round(value * 100);
  const fill = errored ? "#c04a3a" : ACCENT;
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        width: "100%",
        height: 4,
        background: theme.rule,
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: fill,
          borderRadius: 2,
          transition: "width 360ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
    </div>
  );
}

// ── Step row ──────────────────────────────────────────────────────────────

function StepRow({ theme, step }: { theme: Theme; step: Step }) {
  const { tr } = useI18n();
  const isActive = step.status === "active";
  const isDone = step.status === "done";
  const isError = step.status === "error";

  const opacity = isActive ? 1 : isDone ? 0.7 : isError ? 1 : 0.4;
  const fontWeight = isActive ? 600 : 500;
  const color = isError
    ? "#c04a3a"
    : isActive
      ? ACCENT
      : theme.ink;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 4px",
        opacity,
        transition: "opacity 280ms ease, color 280ms ease",
        color,
      }}
    >
      <StepIcon status={step.status} themeMuted={theme.muted} />
      <div
        style={{
          fontSize: 13.5,
          fontWeight,
          letterSpacing: "-0.005em",
          transition: "font-weight 200ms ease",
        }}
      >
        {phaseLabel(step.label, tr)}
      </div>
    </div>
  );
}

function StepIcon({
  status,
  themeMuted,
}: {
  status: Step["status"];
  themeMuted: string;
}) {
  if (status === "active") {
    return (
      <span
        style={{
          width: 18,
          height: 18,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          animation: "import-pulse 1400ms ease-in-out infinite",
        }}
      >
        <svg
          width={18}
          height={18}
          viewBox="0 0 18 18"
          aria-hidden
        >
          <circle cx={9} cy={9} r={8} fill={ACCENT} />
          <path
            d="M5 9l3 3 5-6"
            fill="none"
            stroke="#fff"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "done") {
    return (
      <svg
        width={18}
        height={18}
        viewBox="0 0 18 18"
        aria-hidden
      >
        <circle cx={9} cy={9} r={8} fill={themeMuted} opacity={0.45} />
        <path
          d="M5 9l3 3 5-6"
          fill="none"
          stroke="#fff"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.95}
        />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
        <circle cx={9} cy={9} r={8} fill="#c04a3a" />
        <path
          d="M6 6l6 6M12 6l-6 6"
          fill="none"
          stroke="#fff"
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  // pending
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
      <circle
        cx={9}
        cy={9}
        r={7.5}
        fill="none"
        stroke={themeMuted}
        strokeWidth={1.2}
        opacity={0.5}
      />
    </svg>
  );
}

function CloseGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
    >
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Keyframes ─────────────────────────────────────────────────────────────
//
// Injected once into the document head. We do this in a component effect so
// SSR / hot-reload don't accumulate duplicate <style> tags — only the first
// render inserts.

let keyframesInjected = false;

function KeyframesOnce() {
  useEffect(() => {
    if (keyframesInjected) return;
    keyframesInjected = true;
    const style = document.createElement("style");
    style.dataset.importProgress = "true";
    style.textContent = KEYFRAMES;
    document.head.appendChild(style);
  }, []);
  return null;
}

const KEYFRAMES = `
@keyframes import-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes import-modal-in {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}
@keyframes import-pulse {
  0%, 100% { transform: scale(1);   filter: brightness(1); }
  50%      { transform: scale(1.10); filter: brightness(1.12); }
}
`;
