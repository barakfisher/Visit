import type { ReactNode } from 'react';
import { Link, router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { AppText } from '../AppText';
import { ActionButton } from '../ActionButton';
import { BusinessSettings } from '../BusinessSettings.component';
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
import { RETURNS_ON_SAVE, type SetupSection } from '@/src/lib/BusinessReadiness';
import { useBusinessReadiness } from '@/src/lib/BusinessReadiness.hook';
/** Settings are for an approved owner or manager; the server decides, this only renders its answer. */
function SettingsAccess({ businessId, children }: { businessId: string; children: (business: BusinessProfile) => ReactNode }) {
  const identity = useSessionStore(s => s.identityId), bootstrap = useSessionStore(s => s.bootstrapStatus);
  const { t } = useAppLocale();
  const business = useQuery({ queryKey: ['provider', businessId, 'business'], queryFn: () => apiRequest<{ business: BusinessProfile; role: string }>(`/v1/provider/businesses/${encodeURIComponent(businessId)}`), enabled: !!identity });
  if (!identity && bootstrap !== 'ready') return <SessionLoading />;
  if (!identity) return <View className="flex-1 gap-4 bg-canvas p-6"><AppText>{t('setup.denied')}</AppText><Link href="/auth/login">{t('common.signIn')}</Link></View>;
  if (business.isError || business.data && !['OWNER', 'MANAGER'].includes(business.data.role)) return <View className="flex-1 gap-4 bg-canvas p-6"><AppText accessibilityRole="alert">{t(business.error instanceof ApiError && [401, 403, 404].includes(business.error.status) || !!business.data ? 'setup.denied' : 'setup.failure')}</AppText><ActionButton secondary label={t('common.retry')} onPress={() => void business.refetch()} /><Link href="/account">{t('nav.account')}</Link></View>;
  if (!business.data) return <SessionLoading />;
  return children(business.data.business);
}
export function SettingsHub({ businessId }: { businessId: string }) {
  return <SettingsAccess businessId={businessId}>{business => <Hub business={business} />}</SettingsAccess>;
}
function Hub({ business }: { business: BusinessProfile }) {
  const { t } = useAppLocale(), readiness = useBusinessReadiness(business.id);
  if (readiness.isError) return <View className="flex-1 gap-4 bg-canvas p-6"><AppText accessibilityRole="alert">{t('setup.failure')}</AppText><ActionButton label={t('common.retry')} onPress={() => void readiness.refetch()} /></View>;
  return readiness.data ? <BusinessSettings business={business} readiness={readiness.data} /> : <SessionLoading />;
}
export function SettingsSection({ businessId, section }: { businessId: string; section: SetupSection }) {
  return <SettingsAccess businessId={businessId}>{business => <Section business={business} section={section} />}</SettingsAccess>;
}
function Section({ business, section }: { business: BusinessProfile; section: SetupSection }) {
  const { t } = useAppLocale();
  const hub = { pathname: '/provider/[businessId]', params: { businessId: business.id } } as const;
  // dismissTo pops back to the hub, or replaces this screen when the section was opened directly.
  const onSaved = (RETURNS_ON_SAVE as readonly SetupSection[]).includes(section) ? () => router.dismissTo(hub) : undefined;
  const editor = section === 'profile' ? <BusinessProfileForm key={business.id} business={business} onSaved={onSaved} />
    : section === 'services' ? <ServiceCatalog key={`services:${business.id}`} businessId={business.id} />
    : section === 'hours' ? <AvailabilityEditor businessId={business.id} onSaved={onSaved} />
    : section === 'staff' ? <StaffEditor businessId={business.id} />
    : section === 'policy' ? <PolicyEditor businessId={business.id} onSaved={onSaved} />
    : null;
  return <SettingsPage back={<Link testID="setup-back" href={hub} dismissTo className="min-h-touch py-3 font-semibold text-brand">{t('setup.back')}</Link>} title={t(`setup.${section}`)}>
    {editor ? <View className="gap-4 rounded-card border border-line bg-surface p-card">{editor}</View> : <PublicationPanel businessId={business.id} />}
  </SettingsPage>;
}
export function SharingScreen({ businessId }: { businessId: string }) {
  const { t } = useAppLocale();
  return <SettingsAccess businessId={businessId}>{business => <SettingsPage back={<Link href={{ pathname: '/provider/dashboard', params: { businessId: business.id } }} dismissTo className="min-h-touch py-3 font-semibold text-brand">{t('setup.backAgenda')}</Link>} title={t('setup.sharing')}>
    <View className="gap-4 rounded-card border border-line bg-surface p-card"><ProviderSharing businessId={business.id} /></View>
  </SettingsPage>}</SettingsAccess>;
}
function SettingsPage({ back, title, children }: { back: ReactNode; title: string; children: ReactNode }) {
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-3xl gap-4 px-5 py-6 pb-10 md:px-8">
    <View className="items-start">{back}</View>
    <AppText accessibilityRole="header" className="text-2xl font-bold text-ink">{title}</AppText>
    {children}
  </ScrollView>;
}
