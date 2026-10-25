import { useCallback } from 'react';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { providerSharePath } from '@visit/contracts';
import { ScreenContent } from '@/components/ScreenContent';
import { AppText } from '@/components/AppText';
import { ActionButton } from '@/components/ActionButton';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useAuthStore } from '@/src/state/auth';
import { useProviderActivation } from '@/src/lib/useProviderActivation';
import { apiRequest, ApiError } from '@/src/lib/api';
export default function SharedProvider() {
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const path = providerSharePath(slug);
  const { t } = useAppLocale();
  const identity = useAuthStore(s => s.identityId);
  const resolved = useQuery({ queryKey: ['public', 'provider-link', slug], queryFn: () => apiRequest<{ provider: { id: string; name: string; location: string | null; category: string } }>(`/api/provider-links/${encodeURIComponent(slug)}`), enabled: !!path, retry: false });
  const saved = useCallback((result: { provider: { id: string } }) => { router.replace({ pathname: '/booking/[providerId]', params: { providerId: result.provider.id } }); }, []);
  const activation = useProviderActivation(resolved.data && !resolved.isError && path ? { slug } : undefined, saved);
  const failed = !path || resolved.isError;
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="px-5 py-8"><ScreenContent form className="gap-5 rounded-card border border-line bg-surface">
    <AppText className="text-sm font-semibold text-brand">Visit</AppText>
    <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{resolved.data?.provider.name ?? t('providers.shared')}</AppText>
    {failed ? <AppText accessibilityRole="alert">{t(!path || resolved.error instanceof ApiError && resolved.error.status === 404 ? 'providers.unavailable' : 'providers.loadFailure')}</AppText> : resolved.isLoading ? <AppText>{t('common.loading')}</AppText> : <>
      <AppText>{resolved.data?.provider.location} · {resolved.data?.provider.category}</AppText>
      <AppText>{t('providers.saveHelp')}</AppText>
      {!identity ? <Link href={{ pathname: '/auth/login', params: { returnTo: path! } }} className="min-h-action rounded-control bg-brand px-5 py-4 text-center font-semibold text-white">{t('providers.signIn')}</Link> : <AppText accessibilityRole="status">{t(activation.status === 'changed' ? 'providers.changed' : activation.status === 'error' ? 'providers.failure' : 'providers.saving')}</AppText>}
    </>}
    {activation.status === 'error' ? <ActionButton secondary label={t('common.retry')} onPress={activation.retry} /> : null}
    {resolved.isError ? <ActionButton secondary label={t('common.retry')} onPress={() => void resolved.refetch()} /> : null}
    <Link href="/" className="min-h-touch py-3 font-semibold text-brand">{t('nav.home')}</Link>
  </ScreenContent></ScrollView>;
}
