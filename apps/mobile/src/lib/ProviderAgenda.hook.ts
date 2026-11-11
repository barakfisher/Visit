import { useLiveAgenda } from './LiveSignals.hook';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import { useProviderWorkspace } from '../../components/ProviderAccess';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { agendaDraftScope, emptyAgendaDraft, useAgendaDraft } from '../state/ProviderAgenda.store';
import { readProviderAgenda, openAgendaContact } from './ProviderAgenda.service';
import { useBlockRemoval, useTimeBlockDialog } from './TimeBlocks.hook';
import { canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { todayInTimezone } from './calendar';
import { agendaTimeline, nextAgendaRecheck, splitAgendaToday, type FreeGap } from './AgendaToday.utils';
import { openManualBooking } from './ManualBookingEntry';
import { useManualBooking } from './ManualBooking.hook';
import { appointmentSpan, dateRange } from './appointmentTime';
import type { ProviderAgendaView } from '../types/ProviderAgenda.types';
/** The business home: today only (decisions.md, "The business home shows today" — 2026-11-10). */
export function useProviderAgenda(): ProviderAgendaView {
  const business = useProviderWorkspace(), { t, locale } = useAppLocale(), router = useRouter();
  const profile = useSessionStore(state => state.profile), identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const scope = agendaDraftScope(identity, version, business.id);
  const stored = useAgendaDraft(state => state.scope === scope ? state.draft : emptyAgendaDraft);
  const [feedback, setFeedback] = useState('');
  const mounted = useRef(true), focused = useIsFocused(), focusRef = useRef(focused);
  useEffect(() => { focusRef.current = focused; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; useAgendaDraft.getState().clear(); }; }, []);
  // The clock moves an appointment to the ended row when it ends, and today to the next day after midnight.
  const [now, setNow] = useState(() => Date.now());
  const day = todayInTimezone(business.timezone, new Date(now));
  const blockDialog = useTimeBlockDialog(business.id, business.timezone), blockRemoval = useBlockRemoval(business.id);
  const manual = useManualBooking(business, day);
  // A pending block save or removal holds the business, so its result lands where it was made.
  const busy = blockDialog.busy || Boolean(blockRemoval.pending);
  const agenda = useQuery({ queryKey: ['provider', business.id, 'agenda', identity, version, day], queryFn: ({ signal }) => readProviderAgenda(business.id, day, signal), enabled: focused, staleTime: 0 });
  useLiveAgenda(business.id, focused);
  const bookings = agenda.data?.bookings, refetch = agenda.refetch;
  useEffect(() => {
    if (!focused) return;
    // A fresh read or a return to the screen is a moment to look at the clock; the timer covers the time in between.
    // A clock gone stale while the screen was away (more than a second) is read again at once.
    const current = Date.now(), delay = current - now > 1000 ? 0 : nextAgendaRecheck(bookings ?? [], current);
    // Free time is computed by the server against its clock, so each recheck also reads the day again.
    const timer = setTimeout(() => { setNow(Date.now()); void refetch(); }, delay);
    return () => clearTimeout(timer);
  }, [bookings, focused, now, refetch]);
  const { upcoming, ended } = splitAgendaToday(bookings ?? [], now);
  const timeline = agendaTimeline(upcoming, agenda.data?.day?.free ?? [], agenda.data?.blocks ?? [], now);
  function addAt(gap: FreeGap) {
    openManualBooking(business.id, { localDate: day, localTime: gap.bookLocal, staffId: gap.staffId });
  }
  function capture() {
    const initial = { identityId: identity, contextVersion: version, activeBusinessId: business.id };
    return () => focusRef.current && canContinueAppointmentAction(initial, useSessionStore.getState(), mounted.current, business.id);
  }
  async function contact(phone: string | null, mode: 'call' | 'whatsapp') {
    if (!phone) return;
    const isCurrent = capture();
    setFeedback('');
    try { if (isCurrent()) await openAgendaContact(phone, mode); } catch { if (isCurrent()) setFeedback(t(mode === 'call' ? 'dashboard.callFailure' : 'dashboard.whatsappFailure')); }
  }
  const saved = stored.savedDate;
  return { business, profile, t, day, upcoming, ended, timeline, closed: agenda.data?.day?.closed ?? false, addAt,
    openHours: () => router.push({ pathname: '/provider/[businessId]/[section]', params: { businessId: business.id, section: 'hours' } }), retry: () => { if (focused) void agenda.refetch(); }, agenda: { data: agenda.data, isError: agenda.isError, isLoading: agenda.isLoading }, busy,
    feedback: blockRemoval.removeFailure ? t(blockRemoval.removeFailure) : feedback,
    notice: !saved ? '' : saved === day ? t('dashboard.savedToday') : t('dashboard.savedFor', { date: dateRange(saved, saved, locale) }),
    selectBusiness: (id: string) => { if (id !== business.id && !busy) { useSessionStore.getState().selectBusiness(id); router.replace({ pathname: '/provider/dashboard', params: { businessId: id } }); } },
    span: (startsAt: string, endsAt: string) => appointmentSpan(startsAt, endsAt, business.timezone, locale, false),
    blockDialog, blockRemoval, manual, contact: (phone: string | null, mode: 'call' | 'whatsapp') => void contact(phone, mode),
  };
}
