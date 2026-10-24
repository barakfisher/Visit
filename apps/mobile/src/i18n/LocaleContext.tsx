import { createContext, useContext, type ReactNode } from 'react';
import { defaultLocale, directionFor, translate, type Locale, type MessageKey } from './messages';

type LocaleContextValue = {
  locale: Locale; direction: 'rtl' | 'ltr'; ready: boolean; saving: boolean; error: boolean;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => Promise<void>;
};
export const LocaleContext = createContext<LocaleContextValue>({ locale: defaultLocale, direction: 'rtl', ready: true, saving: false, error: false, t: (key, values) => translate(defaultLocale, key, values), setLocale: async () => {} });
export const useAppLocale = () => useContext(LocaleContext);
export function LocalePreview({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={{ locale, direction: directionFor(locale), ready: true, saving: false, error: false, setLocale: async () => {}, t: (key, values) => translate(locale, key, values) }}>{children}</LocaleContext.Provider>;
}
