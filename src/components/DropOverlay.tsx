// The full-window drag-and-drop overlay.
//
// Three states, not two. Refusing has to be VISIBLE — an overlay that
// simply never appears for an unsupported file reads as a broken app —
// and it names the formats, because an error should say how to fix
// itself. "Received" exists because the library's import toast is
// unreachable while the reader is on screen, which is exactly when a drop
// most needs acknowledging. A mixed drop (some supported, some not) also
// reports what got skipped here, for the same reason: the toast that would
// normally say so lives in Library, and Library may not be mounted when
// the drop lands.
//
// Purely presentational: it takes state and renders. The drag plumbing
// lives in hooks/useFileDrop.ts; the "received" state can also arrive from
// hooks/useIncomingFiles.ts (an Open-with/share arrival), which is why the
// state itself is a shared store (store/dropOverlay.ts) rather than local
// to the drag hook.

import { useEffect, useRef, useState } from "react";
import type { DropState } from "../store/dropOverlay";
import { useI18n } from "../i18n/useI18n";
import { EASE, MOTION, useReducedMotion } from "../styles/motion";
import { FONT_STACKS, HIGHLIGHT_COLORS, type Theme } from "../styles/tokens";
import { Icon } from "./Icon";

interface Props {
  state: DropState;
  theme: Theme;
}

/** Warm amber, borrowed from the highlight palette. The point of naming it
 *  here is that it is the ONLY non-theme colour in this component — a
 *  drop target does not need to be blue. */
const ACCENT = HIGHLIGHT_COLORS.yellow.dot;

export function DropOverlay({ state, theme }: Props) {
  const { tr } = useI18n();
  const reduced = useReducedMotion();
  const idle = state.kind === "idle";

  // Entrance only plays on the idle → non-idle edge, not on every content
  // change while the overlay stays mounted (accept → received happens
  // without a leave in between, and re-animating there would read as a
  // pop rather than a confirmation).
  const [entered, setEntered] = useState(false);
  const wasIdle = useRef(true);

  useEffect(() => {
    if (idle) {
      wasIdle.current = true;
      setEntered(false);
      return;
    }
    if (!wasIdle.current) return;
    wasIdle.current = false;
    if (reduced) {
      // Reduced motion collapses enter/exit to an instant toggle — no
      // frame-deferred transition, just show it.
      setEntered(true);
      return;
    }
    // Two rAFs: one for layout settle, one for the transition to actually
    // run. This repo has been bitten before by WKWebView skipping a CSS
    // @keyframes animation applied to a freshly-mounted node — the enter
    // snaps instead of animating — and macOS (this overlay's only target;
    // drag-and-drop is desktop-only) *is* WKWebView. Driving the enter
    // with a plain transition plus this two-frame defer (the same idiom
    // Lightbox.tsx uses) sidesteps that engine quirk entirely, so it's
    // used here instead of a mount-time keyframe.
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(r2);
    });
    return () => cancelAnimationFrame(r1);
  }, [idle, reduced]);

  // Kept mounted through an exit transition would need a presence
  // wrapper; the overlay is transient enough that an instant unmount on
  // idle is honest and much simpler.
  if (idle) return null;

  const accepting = state.kind === "accept";
  const received = state.kind === "received";
  const skippedCount = received ? state.skipped : 0;

  const icon = received ? "check" : accepting ? "download" : "info";
  const title = received
    ? tr("drop.received")
    : accepting
      ? tr("drop.accept")
      : tr("drop.refuse");
  const subtitle = accepting
    ? tr(state.count === 1 ? "drop.acceptCountOne" : "drop.acceptCountOther", {
        count: String(state.count),
      })
    : received
      ? null
      : tr("drop.formats");

  const cardTransition = reduced
    ? "none"
    : `opacity ${MOTION.med}ms ${EASE.enter}, transform ${MOTION.med}ms ${EASE.enter}`;

  return (
    <div
      // Tauri owns the drag: a pointer-catching overlay would swallow the
      // drop it exists to advertise.
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        display: "grid",
        placeItems: "center",
        // Highest z-index in the app, deliberately: it must clear
        // Lightbox's 10500 (the tallest layer before this one existed) so
        // a drag started while an image lightbox is open still reads. If
        // you're about to raise some other layer past this, that's a
        // choice to make on purpose, not a number to bump past by habit.
        zIndex: 11000,
        // Deliberately theme-independent — the same flat black scrim
        // AnimatedDialog.tsx uses behind every dialog in the app. A
        // theme-tinted scrim (`${theme.bg}e0`) collapses to the SAME
        // colour as the card in sepia/dark/oled (paper === bg there), and
        // on oled specifically bg is #000000, so a black scrim behind a
        // black card leaves only a 10%-alpha hairline doing all the work.
        // Do not "fix" this back to a theme tint — that's the bug this
        // undoes. The blur, not the tint, is what reads as "dismissed".
        background: "rgba(0,0,0,0.42)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      // Announced rather than silent, for the same reason the refusing
      // state is visible at all.
      role="status"
      aria-live="polite"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          padding: "32px 40px",
          borderRadius: 14,
          // `chrome`, not `bg`: on oled bg is #000000 (paper === bg), so a
          // bg-filled card sitting on the near-black blurred backdrop had
          // no fill of its own — only the 18%-alpha border gave it a
          // shape. `chrome` is this app's existing "surface a few percent
          // off bg" token (oled: #0c0a08 vs bg #000000; dark: #24201c vs
          // bg #1a1614, both roughly a 4-5% white lift), already used
          // everywhere else a panel needs to read as distinct from the
          // page behind it — reusing it here instead of inventing a new
          // tint. On light/sepia the shift versus `bg` is similarly
          // subtle and harmless, so one rule now separates the card in
          // all four themes rather than special-casing the dark pair.
          background: theme.chrome,
          // `ruleStrong` rather than `rule`: with the scrim now a flat
          // black instead of a theme tint, oled's card still sits on a
          // near-black backdrop (the underlying content is blurred and
          // darkened, not replaced), so the border carries more of the
          // separation than it would in ConfirmDialog. `ruleStrong` is
          // documented for exactly this — an edge that has to register
          // against shadows or larger surfaces.
          border: `1px solid ${theme.ruleStrong}`,
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
          fontFamily: FONT_STACKS.sans,
          // Centred, icon over text — no directional flip needed for RTL.
          textAlign: "center",
          width: "min(380px, calc(100vw - 32px))",
          opacity: entered ? 1 : 0,
          transform: entered ? "scale(1)" : "scale(0.98)",
          transition: cardTransition,
        }}
      >
        <Icon
          name={icon}
          size={28}
          style={{ color: accepting || received ? ACCENT : theme.muted }}
        />
        <div
          style={{
            fontSize: 17,
            fontWeight: 600,
            color: accepting || received ? theme.ink : theme.muted,
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div style={{ fontSize: 14, color: theme.muted }}>{subtitle}</div>
        ) : null}
        {skippedCount > 0 ? (
          <div style={{ fontSize: 13, color: theme.muted }}>
            {tr(skippedCount === 1 ? "drop.skippedOne" : "drop.skippedOther", {
              count: String(skippedCount),
            })}
          </div>
        ) : null}
        {accepting ? (
          <div
            style={{
              width: 48,
              height: 2,
              borderRadius: 2,
              background: ACCENT,
              marginTop: 4,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
