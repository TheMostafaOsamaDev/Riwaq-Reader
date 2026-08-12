import { useContext } from "react";
import { I18nContext } from "./I18nProvider";

/** Access the resolved UI locale, direction, and translator.
 *  Named `tr` (not `t`) to avoid colliding with the Tweaks prop `t`. */
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within <I18nProvider>");
  return ctx;
}
