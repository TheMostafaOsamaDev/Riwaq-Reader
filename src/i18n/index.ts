import { en } from "./en";
import { ar } from "./ar";

export type Locale = "en" | "ar";
export type Dir = "ltr" | "rtl";

/** Stored UI-language preference. "system" resolves from the OS/browser
 *  locale at render time — mirrors ThemePref's "system". */
export type UiLangPref = "system" | Locale;

export type MsgKey = keyof typeof en;
export type Messages = Record<MsgKey, string>;

export const CATALOGS: Record<Locale, Messages> = { en, ar };
export const DIR_FOR: Record<Locale, Dir> = { en: "ltr", ar: "rtl" };

/** Resolve a stored preference to a concrete locale. "system" inspects the
 *  provided navigator language (primary subtag): Arabic → "ar", else "en". */
export function detectLocale(
  pref: UiLangPref,
  navLang: string | undefined,
): Locale {
  if (pref === "en" || pref === "ar") return pref;
  const primary = (navLang ?? "en").toLowerCase().split(/[-_]/)[0];
  return primary === "ar" ? "ar" : "en";
}

/** Replace {name} placeholders. Missing params are left verbatim. */
export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) =>
    k in params ? String(params[k]) : m,
  );
}

export type Tr = (
  key: MsgKey,
  params?: Record<string, string | number>,
) => string;

/** Build a translator bound to a locale. Fallback: locale → en → key. */
export function makeTr(locale: Locale): Tr {
  const dict = CATALOGS[locale];
  return (key, params) => interpolate(dict[key] ?? en[key] ?? key, params);
}
