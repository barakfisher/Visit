import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useSessionStore } from '@/src/state/session';
import { needsSetupGuide } from './BusinessReadiness';
import { useBusinessReadiness } from './BusinessReadiness.hook';
import { openManualBooking } from './ManualBookingEntry';
import { accountBusiness, footerHidden, isProviderPath } from './navigation';
import { workerCalendar } from './providerWorkspace';
import type { FooterTab } from '../types/FooterNavigation.types';

export function useAppFooter(): FooterTab[] | null {
  const { t } = useAppLocale(), pathname = usePathname();
  const params = useGlobalSearchParams<{ businessId?: string }>(), onAccount = accountBusiness(pathname, params.businessId, useSessionStore(state => state.profile?.businesses));
  const identity = useSessionStore(state => state.identityId), active = useSessionStore(state => state.activeBusinessId);
  const business = onAccount ?? active, providerMode = !!onAccount || isProviderPath(pathname);
  // A worker has no setup to finish and may not read it: asking would be refused and close provider mode.
  const calendar = useSessionStore(state => { const entry = state.profile?.businesses.find(item => item.id === business); return entry ? workerCalendar(entry) : null; });
  const readiness = useBusinessReadiness(business ?? '', !!identity && providerMode && !!business && !calendar);
  if (!identity || footerHidden(pathname)) return null;
  if (!providerMode) return [
    { key: 'home', label: t('nav.home'), active: pathname === '/', onPress: () => router.dismissTo('/') },
    { key: 'appointments', label: t('nav.appointments'), active: pathname === '/appointments' || pathname.startsWith('/appointments/'), onPress: () => router.navigate('/appointments') },
  ];
  if (!business) return null;
  // Back to the agenda in the stack rather than piling up another one; when none is there this opens it.
  const openAgenda = () => router.dismissTo({ pathname: '/provider/dashboard', params: { businessId: business } });
  // The sheet rises over the business home, so another screen first goes back there (decisions.md, 2026-11-11). A new form starts today.
  // The calendar has the sheet too, so Add appointment opens over it there.
  const openAdd = (id: string) => {
    openManualBooking(id);
    if (pathname !== '/provider/dashboard' && pathname !== '/provider/calendar') openAgenda();
  };
  return [
    { key: 'home', label: t('nav.home'), active: pathname === '/provider/dashboard', onPress: openAgenda },
    // The calendar opens on this week; from another week, the tab brings it back (decisions.md, "The calendar screen" — 2026-11-11).
    { key: 'calendar', label: t('nav.calendar'), active: pathname === '/provider/calendar', onPress: () => router.navigate({ pathname: '/provider/calendar', params: { businessId: business } }) },
    // Until setup is done the agenda redirects to settings, so there is nowhere to add an appointment.
    ...((calendar ? calendar.active : readiness.data && !needsSetupGuide(readiness.data)) ? [{ key: 'add' as const, label: t('manual.open'), active: false, onPress: () => openAdd(business) }] : []),
    // Team access is the owner's and managers'; a worker's footer is their day, their calendar and Add appointment.
    ...(calendar ? [] : [{ key: 'team' as const, label: t('nav.teamAccess'), active: pathname === `/provider/team/${business}`, onPress: () => router.navigate({ pathname: '/provider/team/[businessId]', params: { businessId: business } }) }]),
  ];
}
