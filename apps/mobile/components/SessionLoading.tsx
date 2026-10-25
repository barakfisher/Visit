import { ActivityIndicator, View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { useSessionStore } from '@/src/state/session';
import { useAppLocale } from '@/src/i18n/LocaleContext';
export function SessionLoading() {
  const { t } = useAppLocale();
  const status = useSessionStore(s => s.bootstrapStatus), retry = useSessionStore(s => s.retryBootstrap);
  return <View className="flex-1 justify-center gap-4 bg-canvas p-6">
    {status === 'error' ? <><AppText accessibilityRole="alert">{t('home.sessionFailure')}</AppText><ActionButton label={t('common.retry')} onPress={retry} /></> : <><ActivityIndicator color="#0f766e" /><AppText>{t('account.loading')}</AppText></>}
  </View>;
}
