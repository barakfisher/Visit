import { accessEn, accessHe } from '@/src/i18n/accessMessages';
import { ProviderApplication } from '@/components/ProviderApplication';
import { Link } from 'expo-router';
import { ScrollView } from 'react-native';
import { useSessionStore } from '@/src/state/session';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { ScreenContent } from '@/components/ScreenContent';
import { AppText } from '@/components/AppText';
export default function ProviderRegistrationEntry() {
  const { t, locale } = useAppLocale();
  const identityId = useSessionStore(state => state.identityId);
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="px-5 py-10"><ScreenContent form className="rounded-card border border-line bg-surface">
    <AppText className="text-sm font-semibold text-brand">Visit</AppText>
    <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{t('providerEntry.title')}</AppText>
    <AppText className="leading-6 text-body">{t('providerEntry.identity')}</AppText>
    <AppText className="leading-6 text-body">{t('providerEntry.approval')}</AppText>
    <AppText className="leading-6 text-body">{(locale === 'he' ? accessHe : accessEn).joinHint}</AppText>
    {identityId ? <ProviderApplication /> : null}
    <Link href={identityId ? '/account' : { pathname: '/auth/login', params: { returnTo: '/register/provider' } }} className="min-h-action rounded-control bg-brand px-5 py-4 text-center font-semibold text-white">{t(identityId ? 'providerEntry.continue' : 'providerEntry.signIn')}</Link>
    <Link href={identityId ? '/' : '/auth/login'} className="min-h-touch py-3 text-center font-semibold text-brand">{t(identityId ? 'providerEntry.home' : 'email.back')}</Link>
  </ScreenContent></ScrollView>;
}
