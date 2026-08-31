import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { FONT_STACKS, type Theme } from "../styles/tokens";
import { Spinner } from "./Spinner";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "destructiveGhost";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "ref"> {
  theme: Theme;
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
  /** Corner treatment. "rounded" (default) keeps the 8px app radius;
   *  "pill" is the fully-rounded shape used by the hero action cluster. */
  shape?: "rounded" | "pill";
  /** Rendering surface. "default" uses the theme palette. "onImage" swaps to
   *  a theme-independent light-on-dark treatment (solid near-white primary,
   *  translucent "glass" for the rest) for buttons that sit over the hero's
   *  darkened backdrop — readable in every app theme. */
  surface?: "default" | "onImage";
  /** Show a spinner in place of `leadingIcon` while an action is running.
   *  The button keeps whatever `disabled` value it was given — callers
   *  normally pass both, so the control reads as busy rather than merely
   *  unavailable. */
  loading?: boolean;
  /** 0..1 to make the spinner a determinate ring. Omit while the duration is
   *  still unknown. */
  loadingProgress?: number;
}

// Press animation feels right for action buttons but not for chrome icon
// buttons in the reader's header — those have their own toolbar feel. Keep
// this component focused on labelled actions; icon-only chrome buttons
// stay where they are.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    theme,
    variant = "primary",
    size = "md",
    leadingIcon,
    trailingIcon,
    fullWidth,
    type = "button",
    shape = "rounded",
    surface = "default",
    loading = false,
    loadingProgress,
    disabled,
    style,
    children,
    onMouseEnter,
    onMouseLeave,
    onMouseDown,
    onMouseUp,
    onBlur,
    ...rest
  },
  ref,
) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const busy = loading && !!disabled;

  const padding =
    size === "lg" ? "12px 24px" : size === "sm" ? "7px 12px" : "9px 18px";
  const fontSize = size === "lg" ? 14 : size === "sm" ? 12 : 13;
  const gap = size === "sm" ? 6 : 8;

  const interactive = !disabled;
  // The spinner replaces the leading icon rather than sitting next to it, so
  // the button's width doesn't jump when a run starts.
  const lead = loading ? (
    <Spinner
      size={size === "lg" ? 15 : size === "sm" ? 12 : 13}
      {...(typeof loadingProgress === "number"
        ? { value: loadingProgress }
        : {})}
    />
  ) : (
    leadingIcon
  );
  const v =
    surface === "onImage"
      ? onImageVariantStyle(variant, interactive && hover)
      : variantStyle(variant, theme, interactive && hover);

  const composed: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap,
    padding,
    fontSize,
    fontWeight: variant === "primary" || variant === "destructive" ? 600 : 500,
    fontFamily: FONT_STACKS.sans,
    letterSpacing: "-0.005em",
    borderRadius: shape === "pill" ? 999 : 8,
    // "progress" rather than "not-allowed" while busy: the action isn't
    // forbidden, it's already under way.
    cursor: disabled ? (loading ? "progress" : "not-allowed") : "pointer",
    opacity: disabled ? 0.55 : 1,
    transition:
      "transform 90ms ease, background 120ms ease, color 120ms ease, box-shadow 120ms ease",
    transform: interactive && pressed ? "scale(0.97)" : "scale(1)",
    width: fullWidth ? "100%" : undefined,
    userSelect: "none",
    // Buttons should never wrap their label across lines — they're sized
    // by content. If you need a multi-line button you're using the wrong
    // primitive.
    whiteSpace: "nowrap",
    ...v,
    ...style,
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={busy || undefined}
      style={composed}
      onMouseEnter={(e) => {
        setHover(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHover(false);
        setPressed(false);
        onMouseLeave?.(e);
      }}
      onMouseDown={(e) => {
        setPressed(true);
        onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        setPressed(false);
        onMouseUp?.(e);
      }}
      onBlur={(e) => {
        setPressed(false);
        onBlur?.(e);
      }}
      {...rest}
    >
      {lead}
      {children}
      {trailingIcon}
    </button>
  );
});

function variantStyle(
  variant: ButtonVariant,
  theme: Theme,
  hover: boolean,
): CSSProperties {
  switch (variant) {
    case "primary":
      return {
        background: theme.ink,
        color: theme.bg,
        border: "none",
        // Inset overlay lifts the dark surface a touch on hover without
        // needing a per-theme palette of shades.
        boxShadow: hover
          ? "inset 0 0 0 9999px rgba(255,255,255,0.10)"
          : "none",
      };
    case "secondary":
      return {
        background: theme.chrome,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        boxShadow: hover ? "inset 0 0 0 9999px rgba(0,0,0,0.04)" : "none",
      };
    case "outline":
      return {
        background: hover ? theme.hover : "transparent",
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
      };
    case "ghost":
      return {
        background: hover ? theme.hover : "transparent",
        color: hover ? theme.ink : theme.muted,
        border: "none",
      };
    case "destructive":
      return {
        background: hover ? "rgba(192,74,58,0.10)" : "transparent",
        color: "#c04a3a",
        border: "0.5px solid #c04a3a",
      };
    case "destructiveGhost":
      // Same red as `destructive` but no border — for inline secondary
      // actions like 'Remove from library' on the hero card, where a
      // bordered button would feel too heavy next to a ghost 'Edit
      // details' sibling.
      return {
        background: hover ? "rgba(192,74,58,0.10)" : "transparent",
        color: "#c04a3a",
        border: "none",
      };
  }
}

// Theme-independent palette for buttons that sit on the hero's darkened
// backdrop. Values are fixed (not from the Theme) because the scrim behind
// them is always dark regardless of the app theme — so white-on-dark reads
// consistently in light, sepia, dark, and oled. Reds are lightened from the
// `#c04a3a` used on light surfaces so they stay legible over the scrim.
function onImageVariantStyle(
  variant: ButtonVariant,
  hover: boolean,
): CSSProperties {
  switch (variant) {
    case "primary":
      // The single, unmistakable CTA — a solid near-white pill, like the
      // reference's "Play" button.
      return {
        background: hover ? "#ffffff" : "rgba(255,255,255,0.94)",
        color: "#161310",
        border: "none",
        boxShadow: "0 2px 12px rgba(0,0,0,0.28)",
      };
    case "secondary":
    case "outline":
      // Frosted glass — subordinate to the white primary but clearly a
      // control against the imagery.
      return {
        background: hover ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.14)",
        color: "#ffffff",
        border: "0.5px solid rgba(255,255,255,0.34)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      };
    case "ghost":
      return {
        background: hover ? "rgba(255,255,255,0.14)" : "transparent",
        color: hover ? "#ffffff" : "rgba(255,255,255,0.86)",
        border: "none",
      };
    case "destructive":
      return {
        background: hover ? "rgba(255,138,117,0.18)" : "rgba(255,255,255,0.10)",
        color: "#ff9c86",
        border: "0.5px solid rgba(255,156,134,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      };
    case "destructiveGhost":
      return {
        background: hover ? "rgba(255,138,117,0.16)" : "transparent",
        color: "#ff9c86",
        border: "none",
      };
  }
}
