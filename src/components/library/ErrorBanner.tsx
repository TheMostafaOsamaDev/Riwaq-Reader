
import type {
  Theme,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";

export function ErrorBanner({
  theme,
  message,
}: {
  theme: Theme;
  message: string;
}) {
  const { tr } = useI18n();
  return (
    <div
      style={{
        padding: "10px 14px",
        background: "rgba(180,60,60,0.08)",
        border: "0.5px solid rgba(180,60,60,0.3)",
        borderRadius: 8,
        color: theme.ink,
        fontSize: 12,
        marginBottom: 20,
      }}
    >
      <strong style={{ fontWeight: 600 }}>{tr("library.importFailedPrefix")}</strong> {message}
    </div>
  );
}
