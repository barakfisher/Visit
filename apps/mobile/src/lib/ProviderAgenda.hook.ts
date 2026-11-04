import { useManualBooking } from './ManualBooking.hook';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import { useProviderWorkspace } from '../../components/ProviderAccess';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { emptyAgendaDraft, useAgendaDraft } from '../state/ProviderAgenda.store';
import { readProviderAgenda, openAgendaContact } from './ProviderAgenda.service';
import { useBlockRemoval, useTimeBlockDialog } from './TimeBlocks.hook';
import { canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { todayInTimezone } from './calendar';
import { addBookingDays, validBookingDate } from './CompactBooking.utils';
import { appointmentSpan, dateRange, timePolicyNote } from './appointmentTime';
import type { AgendaDraft, ProviderAgendaView } from '../types/ProviderAgenda.types';
export function useProviderAgenda(): ProviderAgendaView {
  const business = useProviderWorkspace(), { t, locale } = useAppLocale(), router = useRouter();
  const profile = useSessionStore(state => state.profile), identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const scope = JSON.stringify([identity, version, business.id]);
  const stored = useAgendaDraft(state => state.scope === scope ? state.draft : emptyAgendaDraft);
  const [feedback, setFeedback] = useState('');
  const mounted = useRef(true), focused = useIsFocused(), focusRef = useRef(focused);
  useEffect(() => { focusRef.current = focused; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; useAgendaDraft.getState().clear(); }; }, []);
  const day = stored.date || todayInTimezone(business.timezone), validDate = validBookingDate(day);
  const manual = useManualBooking(business, day);
  const blockDialog = useTimeBlockDialog(business.id, business.timezone), blockRemoval = useBlockRemoval(business.id);
  // A pending block save or removal holds the date and business, so its result lands on the day it was made for.
  const busy = blockDialog.busy || Boolean(blockRemoval.pending);
  const agenda = useQuery({ queryKey: ['provider', business.id, 'agenda', identity, version, day, stored.mode], queryFn: ({ signal }) => readProviderAgenda(business.id, day, stored.mode, signal), enabled: validDate && focused, refetchInterval: 10000, staleTime: 0 });
  function update(patch: Partial<AgendaDraft>) { if (!busy) { setFeedback(''); useAgendaDraft.getState().update(scope, patch); } }
  function capture() {
    const initial = { identityId: identity, contextVersion: version, activeBusinessId: business.id };
    return () => focusRef.current && canContinueAppointmentAction(initial, useSessionStore.getState(), mounted.current, business.id);
  }
  async function contact(phone: string | null, mode: 'call' | 'whatsapp') {
    if (!phone) return;
    const isCurrent = capture();
    try { if (isCurrent()) await openAgendaContact(phone, mode); } catch { if (isCurrent()) setFeedback(t(mode === 'call' ? 'dashboard.callFailure' : 'dashboard.whatsappFailure')); }
  }
  return { manual, business, profile, t, day, validDate, retry: () => { if (validDate && focused) void agenda.refetch(); }, draft: stored, agenda: { data: agenda.data, isError: agenda.isError, isLoading: agenda.isLoading }, busy, feedback: !validDate ? t('agendaEdit.invalidDate') : blockRemoval.removeFailure ? t(blockRemoval.removeFailure) : feedback, update,
    selectBusiness: (id: string) => { if (id !== business.id && !busy) { useSessionStore.getState().selectBusiness(id); router.replace({ pathname: '/provider/dashboard', params: { businessId: id } }); } },
    previous: () => { if (validDate) update({ date: addBookingDays(day, stored.mode === 'week' ? -7 : -1) }); }, next: () => { if (validDate) update({ date: addBookingDays(day, stored.mode === 'week' ? 7 : 1) }); },
    span: (startsAt: string, endsAt: string) => appointmentSpan(startsAt, endsAt, business.timezone, locale, stored.mode === 'week'),
    range: (fromDate: string, toDate: string) => dateRange(fromDate, toDate, locale),
    timeNote: timePolicyNote(business.timezone, locale), blockDialog, blockRemoval, contact: (phone: string | null, mode: 'call' | 'whatsapp') => void contact(phone, mode),
  };
}
