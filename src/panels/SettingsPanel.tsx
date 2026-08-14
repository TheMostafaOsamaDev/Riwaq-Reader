// Reader quick-adjust panel — the in-reader surface for on-the-fly typography
// changes. Shares its controls with the full Settings page via
// components/SettingsSection.tsx (same components, same `Tweaks` state), so
// the two never drift. A footer link opens the full page.

import { Icon } from "../components/Icon";
import {
  ActionRow,
  LanguageField,
  ReadingControls,
  ThemeField,
} from "../components/SettingsSection";
import type { Theme, ThemeKey } from "../styles/tokens";
import type { Tweaks } from "../types/reader";
import { PanelShell } from "./PanelShell";
import { useI18n } from "../i18n/useI18n";
import type { UiLangPref } from "../i18n";

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  t: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  onClose?: () => void;
  width?: number | string;
  side?: "left" | "right";
  /** Surface mobile-only fields (e.g. tap-to-turn-pages). The desktop
      reader doesn't show these because they have no effect there. */
  mobile?: boolean;
  /** Navigate to the full Settings page. When provided, a footer link is shown. */
  onOpenFullSettings?: () => void;
}

export function SettingsPanel({
  theme,
  t,
  setTweak,
  onClose,
  width,
  side = "right",
  mobile,
  onOpenFullSettings,
}: Props) {
  const { tr } = useI18n();
  return (
    <PanelShell
      theme={theme}
      title={tr("settings.title")}
      subtitle={tr("settings.subtitle")}
      onClose={onClose}
      icon={<Icon name="type" size={14} />}
      width={width}
      side={side}
    >
      <LanguageField
        theme={theme}
        value={t.uiLang}
        onChange={(v: UiLangPref) => setTweak("uiLang", v)}
      />
      <ThemeField theme={theme} pref={t.theme} onChange={(p) => setTweak("theme", p)} />
      <ReadingControls
        theme={theme}
        t={t}
        setTweak={setTweak}
        mobile={mobile}
        showPageTurn={!mobile}
      />
      {onOpenFullSettings && (
        <ActionRow
          theme={theme}
          icon={<Icon name="settings" size={16} />}
          label={tr("settings.openFull")}
          hint={tr("settings.openFull.hint")}
          onClick={onOpenFullSettings}
          trailing={
            <Icon name="chevronR" size={16} className="rtl-flip-x" style={{ opacity: 0.5 }} />
          }
        />
      )}
    </PanelShell>
  );
}
