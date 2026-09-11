import { Icon } from "../Icon";
import { Button } from "../Button";
import { useImportIndicator } from "../../store/importIndicator";
import { FONT_SERIF_DISPLAY, type Theme } from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import type { LibraryTab } from "./tabs";

export function EmptyState({
  theme,
  onImport,
  importing,
}: {
  theme: Theme;
  onImport: () => void;
  importing: boolean;
}) {
  const { tr } = useI18n();
  const ind = useImportIndicator(importing);
  return (
    <div
      style={{
        maxWidth: 440,
        margin: "64px auto",
        padding: 32,
        borderRadius: 14,
        background: theme.chrome,
        border: `0.5px solid ${theme.rule}`,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: FONT_SERIF_DISPLAY,
          fontSize: 28,
          color: theme.ink,
          letterSpacing: "-0.02em",
          marginBottom: 8,
        }}
      >
        {tr("library.emptyTitle")}
      </div>
      <div
        style={{
          fontSize: 13,
          color: theme.muted,
          lineHeight: 1.55,
          marginBottom: 22,
        }}
      >
        {tr("library.emptyBody")}
      </div>
      <Button
        theme={theme}
        variant="primary"
        size="md"
        onClick={onImport}
        disabled={ind.busy}
        loading={ind.busy}
        {...(ind.ratio === null ? {} : { loadingProgress: ind.ratio })}
        leadingIcon={<Icon name="plus" size={14} />}
      >
        {ind.busy
          ? // An add's busy state is a background cover fetch, not an
            // import — reuse the Downloads copy instead of claiming
            // otherwise.
            ind.reason === "add"
            ? tr("downloads.statusFetchingCover")
            : tr("sidebar.importing")
          : tr("library.emptyCta")}
      </Button>
    </div>
  );
}

export function FilteredEmptyState({
  theme,
  tab,
}: {
  theme: Theme;
  tab: LibraryTab;
}) {
  const { tr } = useI18n();
  const message =
    tab === "reading"
      ? tr("library.emptyReading")
      : tab === "finished"
        ? tr("library.emptyFinished")
        : tab === "wishlist"
          ? tr("library.emptyWishlist")
          : tr("library.emptyGeneric");
  return (
    <div
      style={{
        margin: "64px auto",
        maxWidth: 380,
        padding: 24,
        textAlign: "center",
        color: theme.muted,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      {message}
      <div style={{ marginTop: 8, fontSize: 12 }}>
        {tr("library.setStatusHint")}
      </div>
    </div>
  );
}
