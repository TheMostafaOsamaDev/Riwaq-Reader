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

/** Named the mode, named the way out, then gone. */
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
      style={{
        position: "absolute",
        top: "50%",
        insetInline: 0,
        display: "flex",
        justifyContent: "center",
        // It sits over the page it is describing, so it must never eat a tap
        // meant for the text — including the double-tap that dismisses the
        // mode it is telling you about.
        pointerEvents: "none",
        zIndex: Z.hint,
        transition: reduced ? "none" : "opacity 420ms ease-out",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 9,
          padding: "11px 18px",
          borderRadius: 999,
          background: theme.chrome,
          color: theme.ink,
          border: `0.5px solid ${theme.rule}`,
          boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
          fontFamily: FONT_STACKS.sans,
          fontSize: 12.5,
          fontWeight: 600,
          maxWidth: "86%",
          textAlign: "center",
        }}
      >
        <Icon name="lock" size={13} />
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
