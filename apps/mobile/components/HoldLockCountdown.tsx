import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText as Text } from './AppText';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
export function HoldLockCountdown({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
  const { t } = useAppLocale();
  const [now, setNow] = useState(() => Date.now());
  const callback = useRef(onExpire);
  useEffect(() => { callback.current = onExpire; }, [onExpire]);
  useEffect(() => {
    let expired = false;
    const update = () => { const next = Date.now(); setNow(next); if (!expired && next >= Date.parse(expiresAt)) { expired = true; callback.current(); } };
    update(); const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [expiresAt]);
  const remaining = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  return <View className="rounded-control bg-brand-soft px-4 py-3"><Text accessibilityRole="timer" className="text-center font-semibold text-brand">{t('ui.hold', { time: `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}` })}</Text></View>;
}
