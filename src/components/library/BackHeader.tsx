
import { Icon } from "../Icon";
import type {
  Theme,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";

/** Bottom nav for the mobile Library shell. Five slots arranged
 *  symmetrically around the central focal "import EPUB" button:
 *
 *    [Shelves]  [Store]   ( + )   [Downloads]  [Settings]
 *
 *  (Left-to-right in DOM order; RTL locales mirror it, so Shelves sits
 *  at the visual start edge.) Shelves and Store — the two library-browse
 *  destinations — flank the "+" on one side; the queue and settings on
 *  the other. The active destination (Shelves or Store) is filled.
 *
 *  The "+" button is filled and slightly larger (50px vs 44px) so the
 *  primary action is visually obvious; it sits flush with the bar
 *  rather than protruding above it. The other four are circular
 *  outlines matching the existing icon-button style.
 *
 *  Visibility: rendered from MobileLibrary when no source-detail
 *  view is open. The bar sits above the Android nav bar / iOS home
 *  indicator by way of the safe-area inset the outer wrapper
 *  already provides.
 */
export interface BackHeaderProps {
  theme: Theme;
  title: string;
  onBack: () => void;
}

/** Thin back-arrow header used by mobile inner pages (Store, future
 *  side-pages) when the shelf-mode Library header would be misleading.
 *  Visual matches NovelDetailView's header: 34px outlined circle with
 *  the arrowL glyph, label fills the rest of the row. The wrapping
 *  border-bottom keeps the row visually separated from the body
 *  underneath. */
export function BackHeader({ theme, title, onBack }: BackHeaderProps) {
  const { tr } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 18px 12px",
        borderBottom: `0.5px solid ${theme.rule}`,
        flexShrink: 0,
      }}
    >
      <button
        onClick={onBack}
        aria-label={tr("library.backToLibrary")}
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          border: `0.5px solid ${theme.rule}`,
          background: theme.bg,
          color: theme.ink,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontFamily: "inherit",
        }}
      >
        <Icon name="arrowL" size={16} className="rtl-flip-x" />
      </button>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "-0.005em",
          color: theme.ink,
        }}
      >
        {title}
      </div>
    </div>
  );
}
