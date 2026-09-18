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
 *  case keeps exactly the markup it had.
 *
 *  DESKTOP ONLY, in effect. `title` is a hover tooltip and Android has no
 *  hover, so on the primary mobile target this mechanism never fires —
 *  the same reasoning RepoList.tsx applies to a repo URL it refuses to
 *  truncate. It is kept because nothing here is only explained by it: the
 *  ExtensionNotice banner at the top of the page states the cause once,
 *  for every control the page switched off, and each disabled control
 *  stays visible in place rather than disappearing. This adds a per-control
 *  reminder where the platform can show one; it is not the explanation. */
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
