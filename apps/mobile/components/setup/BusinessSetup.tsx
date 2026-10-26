import { accessEn, accessHe } from '@/src/i18n/accessMessages';
import { useState } from 'react';
import { Link } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AppText } from '../AppText';
import { ActionButton } from '../ActionButton';
import { Control } from '../Control';
import { PublicationPanel } from '../PublicationPanel';
import { ServiceCatalog } from '../ServiceCatalog';
import { SessionLoading } from '../SessionLoading';
import { BusinessProfileForm, type BusinessProfile } from './BusinessProfileForm';
import { AvailabilityEditor } from './AvailabilityEditor';
import { StaffEditor } from './StaffEditor';
import { PolicyEditor } from './PolicyEditor';
import { ProviderSharing } from './ProviderSharing';
import { useSessionStore } from '@/src/state/session';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest, ApiError } from '@/src/lib/api';
const sections = ['profile', 'services', 'staff', 'hours', 'policy', 'sharing'] as const;
export function BusinessSetup({ businessId }: { businessId: string }) {
  const identity = useSessionStore(s => s.identityId), bootstrap = useSessionStore(s => s.bootstrapStatus);
  const { t } = useAppLocale();
  const business = useQuery({ queryKey: ['provider', businessId, 'business'], queryFn: () => apiRequest<{ business: BusinessProfile; role: string }>(`/v1/provider/businesses/${encodeURIComponent(businessId)}`), enabled: !!identity });
  if (!identity && bootstrap !== 'ready') return <SessionLoading />;
  if (!identity) return <View className="flex-1 gap-4 bg-canvas p-6"><AppText>{t('setup.denied')}</AppText><Link href="/auth/login">{t('common.signIn')}</Link></View>;
  if (business.isError || business.data && !['OWNER', 'MANAGER'].includes(business.data.role)) return <View className="flex-1 gap-4 bg-canvas p-6"><AppText accessibilityRole="alert">{t(business.error instanceof ApiError && [401, 403, 404].includes(business.error.status) || !!business.data ? 'setup.denied' : 'setup.failure')}</AppText><ActionButton secondary label={t('common.retry')} onPress={() => void business.refetch()} /><Link href="/account">{t('nav.account')}</Link></View>;
  if (!business.data) return <AppText>{t('common.loading')}</AppText>;
  return <SetupContent business={business.data.business} />;
}
function SetupContent({ business }: { business: BusinessProfile }) {
  const { t, locale } = useAppLocale();
  const [section, setSection] = useState<(typeof sections)[number]>('profile');
  const readiness = useQuery({ queryKey: ['provider', business.id, 'publication'], queryFn: () => apiRequest<{ blockers: Record<string, string>; ready: boolean; publishedAt: string | null }>(`/v1/provider/businesses/${business.id}/publication`) });
  function complete(key: (typeof sections)[number]) {
    if (!readiness.data) return false;
    if (key === 'sharing') return !!readiness.data.publishedAt;
    if (key === 'staff' && readiness.data.blockers.services) return false;
    return !Object.keys(readiness.data.blockers).some(field => key === 'staff' ? field.endsWith('.staff') : key === 'hours' ? field === 'hours' || field.endsWith('.hours') : field === key);
  }
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-3xl gap-5 px-5 py-6 md:px-8">
    <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{t('setup.title')}</AppText><AppText className="text-lg font-semibold text-brand">{business.name}</AppText><AppText>{t('setup.intro')}</AppText><AppText>{t('setup.approved')}</AppText>
    <View className="gap-2">{sections.map(key => <Control key={key} testID={`setup-section-${key}`} accessibilityRole="button" accessibilityState={{ selected: key === section }} onPress={() => setSection(key)} className={`justify-center rounded-control border px-4 py-3 ${key === section ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}><AppText className="font-semibold">{t(`setup.${key}`)} · {readiness.data ? t(complete(key) ? 'setup.complete' : 'setup.incomplete') : t('common.loading')}</AppText></Control>)}</View>
    <View className="gap-4 rounded-card border border-line bg-surface p-card">
      <AppText accessibilityRole="header" className="text-xl font-semibold text-ink">{t(`setup.${section}`)}</AppText>
      {section === 'profile' ? <BusinessProfileForm key={business.id} business={business} /> : section === 'services' ? <ServiceCatalog businessId={business.id} /> : section === 'staff' ? <StaffEditor businessId={business.id} /> : section === 'hours' ? <AvailabilityEditor businessId={business.id} /> : section === 'policy' ? <PolicyEditor businessId={business.id} /> : <ProviderSharing businessId={business.id} />}
    </View>
    <Link href={{ pathname: "/provider/team/[businessId]", params: { businessId: business.id } }} className="min-h-touch py-3 font-semibold text-brand">{(locale === 'he' ? accessHe : accessEn).title}</Link>
    <PublicationPanel businessId={business.id} />
    <Link href={{ pathname: '/provider/dashboard', params: { businessId: business.id } }} className="min-h-touch py-3 font-semibold text-brand">{t('setup.backAgenda')}</Link>
  </ScrollView>;
}
