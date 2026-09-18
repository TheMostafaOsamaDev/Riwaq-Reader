import type { CSSProperties, ReactNode } from "react";

/** Keeps a disabled control's reason discoverable.
 *
 *  A disabled `<button>` receives no pointer events, so its own `title`
 *  never opens on hover — the tooltip has to belong to something the
 *  pointer can actually hit, which is this wrapper. Used by the novel page
 *  wherever a control had to be switched off because the source extension
 *  is gone: the control stays where it was, dimmed, and says why.
 *
 *  Renders nothing of its own when there is no reason, so every enabled
 *  case keeps exactly the markup it had. */
export function DisabledHint({
  reason,
  style,
  children,
}: {
  reason?: string | null;
  style?: CSSProperties;
  children: ReactNode;
}) {
  if (!reason) return <>{children}</>;
  return (
    <span title={reason} style={{ display: "inline-flex", ...style }}>
      {children}
    </span>
  );
}
