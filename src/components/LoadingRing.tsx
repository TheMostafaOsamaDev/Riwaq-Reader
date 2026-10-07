// The one loading state the app shows while a book or chapter is on its way:
// a small ring, the title of what is loading, and a word under it ("Opening…",
// "Loading chapter…"). Chosen from the loading mockups (option B).
//
// The timing is the point:
//   - Nothing shows for the first DELAY_MS. Most opens finish inside that,
//     and a ring that flashes for a frame reads as a glitch, not as progress.
//   - Then it fades in over FADE_IN_MS.
//   - When loading ends, the caller keeps it mounted for EXIT_MS with
//     `leaving` set (see usePresence): the ring and its surface fade out
//     together, so the page underneath dissolves in rather than cutting.
//
// The ring's content is invisible before the delay by design; it is an
// indicator, not content, so a webview that never runs the fade leaves a
// plain page surface — what was there before — not hidden text. Transitions
// are flipped by a timer after mount, never by a mount keyframe (see the
// WebKit mount-animation note).

import { type CSSProperties, useEffect, useState } from "react";
import { Spinner } from "./Spinner";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { useReducedMotion } from "../styles/motion";

export const DELAY_MS = 150;
const FADE_IN_MS = 120;
export const EXIT_MS = 140;

export function LoadingRing({
  theme,
  title,
  label,
  leaving = false,
  surface,
  delayMs = DELAY_MS,
}: {
  theme: Theme;
  /** What is loading — the book's or chapter's title — when known. */
  title?: string;
  /** The short line under it: "Opening…", "Loading chapter…". */
  label: string;
  /** Loading has finished: fade out (with the surface) and let the caller
   *  unmount after EXIT_MS. */
  leaving?: boolean;
  /** The surface the ring sits on — position, inset, background, layer.
   *  It is there from the first frame (it may be covering a swap of views
   *  underneath); only the ring itself waits for the delay. */
  surface: CSSProperties;
  delayMs?: number;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) return;
    const t = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);

  const ringVisible = shown && !leaving;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={!leaving}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...surface,
        opacity: leaving ? 0 : 1,
        transition: reduced ? "none" : `opacity ${EXIT_MS}ms ease-in`,
        pointerEvents: leaving ? "none" : surface.pointerEvents,
      }}
    >
      <div
        style={{
          display: "grid",
          justifyItems: "center",
          gap: 12,
          padding: "0 32px 64px",
          maxWidth: "100%",
          opacity: ringVisible ? 1 : 0,
          transition: reduced ? "none" : `opacity ${FADE_IN_MS}ms ease-out`,
          color: theme.ink,
          textAlign: "center",
        }}
      >
        <span style={{ color: theme.ink, display: "inline-flex" }}>
          <Spinner size={30} strokeWidth={2.5} />
        </span>
        {title && (
          <span
            dir="auto"
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.35,
              maxWidth: 280,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {title}
          </span>
        )}
        <span
          style={{
            fontFamily: FONT_STACKS.sans,
            fontSize: 12.5,
            color: theme.muted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

/** Keep something mounted for `exitMs` after `active` goes false, with
 *  `leaving` set for that time, so it can fade out instead of vanishing. */
export function usePresence(
  active: boolean,
  exitMs: number = EXIT_MS,
): { render: boolean; leaving: boolean } {
  const reduced = useReducedMotion();
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (active) {
      setLingering(true);
      return;
    }
    if (reduced) {
      setLingering(false);
      return;
    }
    const t = window.setTimeout(() => setLingering(false), exitMs);
    return () => window.clearTimeout(t);
  }, [active, exitMs, reduced]);
  return {
    render: active || lingering,
    leaving: !active && lingering,
  };
}
