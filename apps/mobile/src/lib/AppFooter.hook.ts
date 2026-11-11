import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useSessionStore } from '@/src/state/session';
import { needsSetupGuide } from './BusinessReadiness';
import { useBusinessReadiness } from './BusinessReadiness.hook';
import { openManualBooking } from './ManualBookingEntry';
import { accountBusiness, footerHidden, isProviderPath, manualBookingPath } from './navigation';
import type { FooterTab } from '../types/FooterNavigation.types';

export function useAppFooter(): FooterTab[] | null {
  const { t } = useAppLocale(), pathname = usePathname();
  const params = useGlobalSearchParams<{ businessId?: string }>(), onAccount = accountBusiness(pathname, params.businessId, useSessionStore(state => state.profile?.businesses));
  const identity = useSessionStore(state => state.identityId), active = useSessionStore(state => state.activeBusinessId);
  const business = onAccount ?? active, providerMode = !!onAccount || isProviderPath(pathname);
  const readiness = useBusinessReadiness(business ?? '', !!identity && providerMode && !!business);
  if (!identity || footerHidden(pathname)) return null;
  if (!providerMode) return [
    { key: 'home', label: t('nav.home'), active: pathname === '/', onPress: () => router.dismissTo('/') },
    { key: 'appointments', label: t('nav.appointments'), active: pathname === '/appointments' || pathname.startsWith('/appointments/'), onPress: () => router.navigate('/appointments') },
  ];
  if (!business) return null;
  // Back to the agenda in the stack rather than piling up another one; when none is there this opens it.
  const openAgenda = () => router.dismissTo({ pathname: '/provider/dashboard', params: { businessId: business } });
  // A new form starts today, the only day the business home shows.
  const openAdd = (id: string) => {
    openManualBooking(id);
    router.navigate({ pathname: '/provider/[businessId]/add', params: { businessId: id } });
  };
  return [
    { key: 'home', label: t('nav.home'), active: pathname === '/provider/dashboard', onPress: openAgenda },
    // Until setup is done the agenda redirects to settings, so there is nowhere to add an appointment.
    ...(readiness.data && !needsSetupGuide(readiness.data) ? [{ key: 'add' as const, label: t('manual.open'), active: pathname === manualBookingPath(business), onPress: () => openAdd(business) }] : []),
    { key: 'team', label: t('nav.teamAccess'), active: pathname === `/provider/team/${business}`, onPress: () => router.navigate({ pathname: '/provider/team/[businessId]', params: { businessId: business } }) },
  ];
}
