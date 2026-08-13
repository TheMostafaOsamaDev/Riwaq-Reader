import { createContext, useMemo, type ReactNode } from "react";
import { DIR_FOR, makeTr, type Dir, type Locale, type Tr } from "./index";

interface I18nValue {
  locale: Locale;
  dir: Dir;
  tr: Tr;
}

export const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, dir: DIR_FOR[locale], tr: makeTr(locale) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
