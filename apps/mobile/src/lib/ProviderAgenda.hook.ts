import { useManualBooking } from './ManualBooking.hook';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import { useProviderWorkspace } from '../../components/ProviderAccess';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { emptyAgendaDraft, useAgendaDraft } from '../state/ProviderAgenda.store';
import { readProviderAgenda, saveAgendaBlock, removeAgendaBlock, openAgendaContact } from './ProviderAgenda.service';
import { canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { isBookingQuery } from './BookingQueries.utils';
import { todayInTimezone } from './calendar';
import { addBookingDays, validBookingDate } from './CompactBooking.utils';
import { appointmentDate, appointmentTime, timePolicyNote } from './appointmentTime';
import { ApiError } from './api';
import type { AgendaDraft, ProviderAgendaView } from '../types/ProviderAgenda.types';
export function useProviderAgenda(): ProviderAgendaView {
  const business = useProviderWorkspace(), { t, locale } = useAppLocale(), client = useQueryClient(), router = useRouter();
  const profile = useSessionStore(state => state.profile), identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const scope = JSON.stringify([identity, version, business.id]);
  const stored = useAgendaDraft(state => state.scope === scope ? state.draft : emptyAgendaDraft);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const mounted = useRef(true), operation = useRef(false), focused = useIsFocused(), focusRef = useRef(focused);
  useEffect(() => { focusRef.current = focused; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; useAgendaDraft.getState().clear(); }; }, []);
  const day = stored.date || todayInTimezone(business.timezone), validDate = validBookingDate(day);
  const manual = useManualBooking(business, day);
  const agenda = useQuery({ queryKey: ['provider', business.id, 'agenda', identity, version, day, stored.mode], queryFn: ({ signal }) => readProviderAgenda(business.id, day, stored.mode, signal), enabled: validDate && focused, refetchInterval: 10000, staleTime: 0 });
  function update(patch: Partial<AgendaDraft>) { if (!operation.current) { setFeedback(''); useAgendaDraft.getState().update(scope, patch); } }
  function capture() {
    const initial = { identityId: identity, contextVersion: version, activeBusinessId: business.id };
    return () => focusRef.current && canContinueAppointmentAction(initial, useSessionStore.getState(), mounted.current, business.id);
  }
  async function changeBlock(id?: string) {
    if (operation.current || !validDate) return;
    const staffId = stored.staffId || agenda.data?.staff[0]?.id;
    if (!id && !staffId) return;
    operation.current = true; setBusy(true); setFeedback(''); const isCurrent = capture();
    try {
      if (!isCurrent()) return;
      if (id) await removeAgendaBlock(business.id, id);
      else if (staffId) await saveAgendaBlock({ businessId: business.id, staffId, date: day, startLocal: stored.from, endLocal: stored.to, reason: stored.reason });
      if (!isCurrent()) return;
      useAgendaDraft.getState().update(scope, { blockOpen: false });
      await Promise.allSettled([client.invalidateQueries({ predicate: query => isBookingQuery(query.queryKey) })]);
    } catch (reason) { if (isCurrent()) { setFeedback(t(!id && reason instanceof ApiError && reason.status === 409 ? 'agendaEdit.blockConflict' : id ? 'dashboard.removeFailure' : 'dashboard.blockFailure')); await agenda.refetch(); } }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  async function contact(phone: string | null, mode: 'call' | 'whatsapp') {
    if (!phone) return;
    const isCurrent = capture();
    try { if (isCurrent()) await openAgendaContact(phone, mode); } catch { if (isCurrent()) setFeedback(t(mode === 'call' ? 'dashboard.callFailure' : 'dashboard.whatsappFailure')); }
  }
  return { manual, business, profile, t, day, validDate, retry: () => { if (validDate && focused) void agenda.refetch(); }, draft: stored, agenda: { data: agenda.data, isError: agenda.isError, isLoading: agenda.isLoading }, busy, feedback: !validDate ? t('agendaEdit.invalidDate') : feedback, update,
    selectBusiness: (id: string) => { if (id !== business.id && !operation.current) { useSessionStore.getState().selectBusiness(id); router.replace({ pathname: '/provider/dashboard', params: { businessId: id } }); } },
    previous: () => { if (validDate) update({ date: addBookingDays(day, stored.mode === 'week' ? -7 : -1) }); }, next: () => { if (validDate) update({ date: addBookingDays(day, stored.mode === 'week' ? 7 : 1) }); },
    when: (instant: string) => `${stored.mode === 'week' ? `${appointmentDate(instant, business.timezone, locale)} · ` : ''}${appointmentTime(instant, business.timezone, locale)}`,
    timeNote: timePolicyNote(business.timezone, locale), block: () => void changeBlock(), removeBlock: (id: string) => void changeBlock(id), contact: (phone: string | null, mode: 'call' | 'whatsapp') => void contact(phone, mode),
  };
}
