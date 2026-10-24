import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { apiRequest } from '../lib/api';
import { useSessionStore } from '../state/session';
import { defaultLocale, directionFor, isLocale, translate, type Locale } from './messages';

import { LocaleContext } from './LocaleContext';
export { useAppLocale, LocalePreview } from './LocaleContext';

const preferenceKey = (identity: string | null) => `visit.locale.v1.${identity ?? 'guest'}`;
export function AppLocaleProvider({ children }: { children: ReactNode }) {
  const identityId = useSessionStore(state => state.identityId);
  const preferredLocale = useSessionStore(state => state.profile?.preferredLocale);
  const [locale, updateLocale] = useState<Locale>(defaultLocale);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    const version = ++epoch.current;
    let cancelled = false;
    const hydrate = async () => {
      let saved: string | null = null;
      try {
        saved = await AsyncStorage.getItem(preferenceKey(identityId));
        if (identityId && !isLocale(saved)) saved = await AsyncStorage.getItem(preferenceKey(null));
      }
      catch { /* Preference storage failure must not block login. */ }
      if (cancelled || version !== epoch.current) return;
      updateLocale(isLocale(preferredLocale) ? preferredLocale : isLocale(saved) ? saved : defaultLocale);
      setReady(true); setError(false); setSaving(false);
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [identityId, preferredLocale]);
  const direction = directionFor(locale);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.documentElement.dir = direction;
    }
  }, [locale, direction]);
  async function setLocale(next: Locale) {
    if (saving) return;
    const version = epoch.current;
    updateLocale(next); setSaving(true); setError(false);
    try {
      await AsyncStorage.setItem(preferenceKey(identityId), next);
      if (identityId) {
        await apiRequest('/api/account/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: next }) });
        const store = useSessionStore.getState();
        if (version === epoch.current && store.profile?.id === identityId) store.setAuth(store.token, { ...store.profile, preferredLocale: next });
      }
    } catch { if (version === epoch.current) setError(true); }
    finally { if (version === epoch.current) setSaving(false); }
  }
  return <LocaleContext.Provider value={{ locale, direction, ready, saving, error, setLocale, t: (key, values) => translate(locale, key, values) }}>{children}</LocaleContext.Provider>;
}
