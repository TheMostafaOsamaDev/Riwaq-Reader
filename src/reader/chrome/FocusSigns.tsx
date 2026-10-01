// The two things that tell a reader on a phone that they are in focus mode.
//
// They answer different questions at different moments, which is why there are
// two and not one. The PILL answers "what just happened, and how do I get
// back?" at the instant the chrome leaves — the only moment the exit gesture
// is worth stating, and the only moment a reader is looking for it. The LOCK
// answers "am I still in something?" ten minutes later, for a reader who
// looked away and came back to a page with no furniture on it.
//
// The lock is also the way out. A mode whose only exit is a gesture fails the
// rule that a critical action needs a visible control: a reader who missed the
// pill, or whose double-tap does not register, would be inside a mode with no
// way out they can see. Making the indicator itself tappable costs no extra
// furniture — the marker was going to be there anyway — and it is what lets
// the exit be reached by a screen reader as a named control rather than as a
// gesture nobody announced.

import { Icon } from "../../components/Icon";
import { FONT_STACKS, inkAlpha, Z, type Theme } from "../../styles/tokens";

/** How long the toast is on screen, enter and exit included.
 *
 *  One number for two mechanisms: the CSS keyframe below paces itself in
 *  percentages of it, and the host unmounts on the same clock. Two constants
 *  would eventually disagree, and the visible failure of that is a toast cut
 *  off mid-fade. */
export const FOCUS_TOAST_MS = 1800;

/** Named the mode, named the way out, then gone.
 *
 *  A small bar along the bottom rather than a plate in the middle of the page.
 *  It arrives at the instant the chrome leaves, which is also the instant the
 *  reader is looking at the text that was under it — so it reads where nothing
 *  is being read, says its piece, and goes. It is shown on ENTRY only; the
 *  lock answers the same question for the rest of the session. */
export function FocusPill({
  theme,
  title,
  hint,
  reduced,
}: {
  theme: Theme;
  title: string;
  hint: string;
  reduced: boolean;
}) {
  return (
    <div
      className="riwaq-focus-pill"
      // A status, not an alert: it is worth hearing, never worth interrupting
      // for, and it must not take focus from the page.
      role="status"
      style={{
        position: "absolute",
        // Clear of the gesture bar on a phone that has one. The system bars go
        // with the chrome, so on Android this usually resolves to 0 and the
        // 22px is the whole gap.
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 22px)",
        insetInline: 0,
        display: "flex",
        justifyContent: "center",
        // It sits over the page it is describing, so it must never eat a tap
        // meant for the text — including the double-tap that dismisses the
        // mode it is telling you about.
        pointerEvents: "none",
        zIndex: Z.hint,
        // Reduced motion gets the message, not the movement. Without a
        // duration the keyframe never runs, and the element's own styles —
        // which are the fully-arrived state — are what paints.
        animationDuration: reduced ? undefined : `${FOCUS_TOAST_MS}ms`,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 14px",
          borderRadius: 999,
          background: theme.chrome,
          color: theme.ink,
          border: `0.5px solid ${theme.rule}`,
          boxShadow: "0 6px 20px rgba(0,0,0,0.16)",
          // No `backdrop-filter` here, deliberately. The wrapper animates its
          // opacity for the toast's whole life, and an ancestor with opacity
          // < 1 is a backdrop root — the blur would have nothing left to
          // sample, cutting out for the length of the animation and popping
          // back at the end. The same trap the focus bars hit; see the note on
          // `slide` in focusChrome.tsx. `theme.chrome` and the hairline carry
          // the material on their own.
          fontFamily: FONT_STACKS.sans,
          fontSize: 12,
          fontWeight: 600,
          // One line. Wrapping is what turned this into a block of screen.
          whiteSpace: "nowrap",
          maxWidth: "92%",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <Icon name="lock" size={12} />
        <span>
          {title} · {hint}
        </span>
      </div>
    </div>
  );
}

/** Still in it — and the way out. */
export function FocusLock({
  theme,
  label,
  onExit,
}: {
  theme: Theme;
  label: string;
  onExit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExit}
      aria-label={label}
      className="riwaq-focus-lock"
      style={{
        position: "absolute",
        // The system bars go with the chrome, but a display cutout does not.
        top: "calc(env(safe-area-inset-top, 0px) + 6px)",
        // Logical, so it lands opposite the home button in both directions
        // rather than pinning to one physical side.
        insetInlineEnd: 6,
        // The ink is 15px; the target is the platform's 44. Conflating the two
        // is what makes a marginal control unhittable.
        width: 44,
        height: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: "transparent",
        // Quiet enough to be furniture, dark enough to be seen on all four
        // themes — the alpha a hairline wants measures invisible on OLED.
        color: inkAlpha(theme, 0.3),
        cursor: "pointer",
        zIndex: Z.hint,
      }}
    >
      <Icon name="lock" size={15} />
    </button>
  );
}
