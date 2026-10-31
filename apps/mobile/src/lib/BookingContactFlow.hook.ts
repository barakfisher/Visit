import { useUpcomingAppointment } from './UpcomingAppointment.hook';
import { isBookingQuery } from './BookingQueries.utils';
import { useRescheduleAttempt } from '../state/BookingReschedule.store';
import { commitReschedule } from './BookingReschedule.service';
import type { RescheduleAttempt } from '../types/BookingReschedule.types';
import { canDiscardBookingAttempt, isCommittedBookingOutcome } from './BookingAttempt.utils';
import { randomUUID } from 'expo-crypto';
import { useBookingAttempt } from '@/src/state/BookingAttempt.store';
import { commitBooking, recoverBooking } from './BookingAttempt.service';
import type { BookingAttempt, BookingOutcome } from '@/src/types/BookingAttempt.types';
import { useBookingContactDraft } from '@/src/state/BookingContactDraft.store';
import { useProviderActivation } from '@/src/lib/useProviderActivation';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '@/src/lib/api';
import { appointmentRefusalKey, bookingLoadRefusalKey } from './AppointmentLifecycle.utils';
import { localDate } from './appointmentTime';
import { useCompactBooking } from './CompactBooking.hook';
import { bookingSlotId, validBookingDate } from './CompactBooking.utils';
import type { AdvisorySelection } from '../types/CompactBooking.types';
import { useAuthStore } from '@/src/state/auth';
import type { BookingContactReadiness } from '@/src/types/BookingContact.types';
import { formatMoney, type ProviderDetail, type Slot } from '@/src/types/flows';
const slotId = bookingSlotId;
export function useBookingContactFlow() {
  const { locale, t } = useAppLocale();
  const params = useLocalSearchParams<{ providerId: string; serviceId?: string; date?: string; fromBookingId?: string }>();
  const { providerId, fromBookingId } = params;
  const upcoming = useUpcomingAppointment(providerId, !fromBookingId);
  const [serviceId, setServiceId] = useState(params.serviceId ?? '');
  const [date, setDate] = useState(params.date ?? '');
  const [selection, setSelection] = useState<AdvisorySelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [conflictSlot, setConflictSlot] = useState<string | null>(null);
  const operation = useRef(false);
  const mounted = useRef(true);
  const focused = useIsFocused();
  const focusRef = useRef(focused);
  const sequence = useRef(0);
  const identityId = useAuthStore((state) => state.identityId);
  const contextVersion = useAuthStore(state => state.contextVersion);
  const previousIdentity = useRef(identityId);
  const [name, setName] = useState('');
  const client = useQueryClient();
  const bookingAttempt = useBookingAttempt(state => state.attempt);
  const rescheduleAttempt = useRescheduleAttempt(state => state.attempt);
  const ownReschedule = rescheduleAttempt?.identityId === identityId && rescheduleAttempt.bookingId === fromBookingId ? rescheduleAttempt : null;
  const attempt = fromBookingId ? ownReschedule : bookingAttempt;
  const pendingElsewhere = Boolean(attempt && attempt.identityId === identityId && attempt.providerId !== providerId);
  const pendingAttempt = attempt?.identityId === identityId && attempt.providerId === providerId ? attempt : null;
  const contacts = useQuery({ queryKey: ['booking-contact', providerId, identityId, contextVersion], queryFn: () => apiRequest<BookingContactReadiness>(`/api/providers/${providerId}/contact-readiness`), enabled: Boolean(identityId && !fromBookingId), refetchInterval: 10000 });
  useEffect(() => {
    sequence.current += 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(false);
    if (previousIdentity.current !== identityId) { setSelection(null); setName(''); if (previousIdentity.current) { setServiceId(''); setDate(''); } }
    const saved = useBookingContactDraft.getState().draft;
    if (saved && identityId) {
      if (saved.identityId === identityId && saved.providerId === providerId) { setServiceId(saved.serviceId); setDate(saved.date); setSelection(saved.selected ? { providerId: saved.providerId, serviceId: saved.serviceId, date: saved.date, slot: saved.selected } : null); }
      useBookingContactDraft.getState().clear();
    }
    previousIdentity.current = identityId;
  }, [identityId, contextVersion, providerId]);
  async function saveName() {
    setBusy(true); setError('');
    try { await apiRequest('/api/account/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name }) }); await contacts.refetch(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('compact.nameFailed')); }
    finally { setBusy(false); }
  }
  const details = useQuery({ queryKey: ['provider', identityId, contextVersion, providerId, fromBookingId ?? 'public'], queryFn: () => apiRequest<{ provider: ProviderDetail; revision?: number }>(`/api/${fromBookingId ? `bookings/${fromBookingId}/provider` : `providers/${providerId}`}`) });
  const provider = details.data?.provider;
  useProviderActivation(provider && !fromBookingId ? { businessId: provider.id } : undefined);
  const chosenService = provider?.services.some(service => service.id === serviceId) ? serviceId : !serviceId && provider?.services.length === 1 ? provider.services[0]?.id ?? '' : '';
  const chosenDate = validBookingDate(date) ? date : provider ? localDate(provider.timezone) : '';
  const selected = selection?.providerId === providerId && selection.serviceId === chosenService && selection.date === chosenDate ? selection.slot : null;
  function changeService(id: string) { if (operation.current || pendingAttempt) return; sequence.current += 1; setSelection(null); setConflictSlot(null); setError(''); setServiceId(id); }
  function changeDate(value: string) { if (operation.current || pendingAttempt || !validBookingDate(value)) return; sequence.current += 1; setSelection(null); setConflictSlot(null); setError(''); setDate(value); }
  const slots = useQuery({ queryKey: ['availability', identityId, contextVersion, providerId, fromBookingId ?? 'public', chosenService, chosenDate], queryFn: () => apiRequest<{ slots: Slot[] }>(`/api/${fromBookingId ? `bookings/${fromBookingId}` : `providers/${providerId}`}/availability?${new URLSearchParams({ serviceId: chosenService, date: chosenDate })}`), enabled: Boolean(chosenService && /^\d{4}-\d{2}-\d{2}$/.test(chosenDate)), refetchInterval: 2000 });
  useEffect(() => {
    // A fresh availability response may make a previously contested slot bookable again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConflictSlot((current) => current && slots.data?.slots.some((slot) => slotId(slot) === current && slot.available) ? null : current);
  }, [slots.data]);

  useEffect(() => { focusRef.current = focused; if (!focused) sequence.current += 1; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1; }; }, []);
  async function reset() { if (operation.current || pendingAttempt) return; sequence.current += 1; setConflictSlot(null); setSelection(null); setNotice(''); setError(''); }
  async function choose(slot: Slot) {
    if (operation.current || pendingAttempt) return;
    if (!slot.available || slot.locked || slotId(slot) === conflictSlot) return;
    sequence.current += 1; setSelection({ providerId, serviceId: chosenService, date: chosenDate, slot }); setError(''); setNotice('');
  }
  async function confirm() {
    if (operation.current) return;
    if (attempt && attempt.identityId === identityId && attempt.providerId !== providerId) { router.replace({ pathname: '/booking/[providerId]', params: { providerId: attempt.providerId } }); return; }
    if (!identityId) { router.push({ pathname: '/auth/login', params: { returnTo: `/booking/${providerId}?serviceId=${chosenService}&date=${chosenDate}` } }); return; }
    if ((!selected && !pendingAttempt) || (!fromBookingId && !contacts.data?.ready && !pendingAttempt)) return;
    const reviewed = provider?.services.find(service => service.id === chosenService);
    if (!pendingAttempt && !fromBookingId && !reviewed) return;
    operation.current = true;
    const requestId = sequence.current;
    const isCurrent = () => mounted.current && focusRef.current && sequence.current === requestId && useAuthStore.getState().identityId === identityId && useAuthStore.getState().contextVersion === contextVersion;
    setBusy(true); setError('');
    let result: BookingOutcome | null = null;
    let logical: BookingAttempt | null = fromBookingId ? null : pendingAttempt;
    let move: RescheduleAttempt | null = ownReschedule;
    try {
      logical ??= selected && !fromBookingId && reviewed ? { reviewedService: { name: reviewed.name, durationMinutes: reviewed.durationMinutes, priceMinor: reviewed.priceMinor, currency: reviewed.currency }, identityId, providerId, serviceId: chosenService, staffId: selected.staffId, startsAt: selected.startsAt, idempotencyKey: randomUUID() } : null;
      if (fromBookingId) {
        if (!move && selected && reviewed && details.data?.revision !== undefined) {
          move = { identityId, providerId, bookingId: fromBookingId, expectedRevision: details.data.revision, serviceId: chosenService, staffId: selected.staffId, startsAt: selected.startsAt, idempotencyKey: randomUUID(), reviewedService: { name: reviewed.name, durationMinutes: reviewed.durationMinutes, priceMinor: reviewed.priceMinor, currency: reviewed.currency } };
          useRescheduleAttempt.getState().set(move);
        }
        if (move) result = await commitReschedule(move);
      } else if (logical) {
        useBookingAttempt.getState().set(logical);
        const recovered = pendingAttempt ? await recoverBooking(logical) : null;
        if (recovered?.status === 'CANCELLED' || recovered?.status === 'EXPIRED') throw new ApiError(t('bookingCommit.conflict'), 'HOLD_EXPIRED', 409);
        result = isCommittedBookingOutcome(recovered) ? recovered : await commitBooking(logical);
      }
    } catch (reason) {
      let terminal = false;
      if (logical) {
        try { const recovered = await recoverBooking(logical); if (isCommittedBookingOutcome(recovered)) result = recovered; terminal = canDiscardBookingAttempt(recovered); }
        catch { /* Preserve the attempt key while the committed outcome is uncertain. */ }
      }
      if (!result && isCurrent()) {
        if (terminal || fromBookingId && reason instanceof ApiError && [400, 401, 404, 409].includes(reason.status)) {
          if (fromBookingId) useRescheduleAttempt.getState().set(null); else useBookingAttempt.getState().set(null); setSelection(null);
          if (selected) setConflictSlot(slotId(selected));
          // Refusals are shown in the app's language, never as the server's diagnostic. A reschedule cutoff says why,
          // so a customer past it is not told to choose another time.
          const code = reason instanceof ApiError ? reason.code : undefined;
          setError(t(appointmentRefusalKey(code) ?? (code === 'CUSTOMER_CONTACT_REQUIRED' ? 'bookingContact.help' : 'bookingCommit.conflict'))); await contacts.refetch(); await details.refetch(); await slots.refetch();
        } else setError(t('bookingCommit.uncertain'));
      }
    } finally {
      if (result && (isCommittedBookingOutcome(result) || Boolean(fromBookingId && result.status === 'CANCELLED')) && isCurrent()) {
        if (fromBookingId) useRescheduleAttempt.getState().set(null); else useBookingAttempt.getState().set(null);
        await Promise.allSettled([client.invalidateQueries({ predicate: query => isBookingQuery(query.queryKey) })]);
        if (isCurrent()) { if (result.status === 'CONFIRMED') router.replace({ pathname: '/confirmation/[bookingId]', params: { bookingId: result.id } }); else router.replace('/appointments'); }
      }
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const controls = useCompactBooking({ provider, providerId, serviceId: chosenService, date: chosenDate, fromBookingId, slots: slots.data?.slots ?? [], excluded: conflictSlot, disabled: busy || Boolean(pendingAttempt), onDate: changeDate, onService: changeService, onReset: () => { void reset(); } });
  useEffect(() => {
    if (!selected || operation.current || pendingAttempt || !slots.data || slots.data.slots.some(slot => slotId(slot) === slotId(selected) && slot.available && !slot.locked)) return;
    setSelection(null); setError(t('compact.changed'));
  }, [selected, pendingAttempt, slots.data, t]);
  const routeScope = JSON.stringify([providerId, fromBookingId, params.serviceId, params.date]);
  const previousRoute = useRef(routeScope);
  useEffect(() => {
    if (previousRoute.current === routeScope) return;
    previousRoute.current = routeScope; sequence.current += 1;
    setSelection(null); setServiceId(params.serviceId ?? ''); setDate(params.date ?? '');
  }, [routeScope, params.serviceId, params.date]);
  const reviewedService = provider?.services.find(service => service.id === chosenService);
  const review = selected && provider && reviewedService ? {
    businessAndService: `${provider.name} · ${reviewedService.name}`,
    timeAndStaff: `${new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: provider.timezone }).format(new Date(selected.startsAt))} · ${selected.staffName}`,
    durationAndPrice: `${reviewedService.durationMinutes} ${t('bookingCommit.minutes')} · ${formatMoney(reviewedService.priceMinor, reviewedService.currency)}`,
    cancellation: t('bookingCommit.cancel', { minutes: provider.bookingPolicy?.cancellationCutoffMinutes ?? 0 }),
  } : null;
  const detailsFailure = details.error instanceof ApiError ? details.error : null;
  const detailsError = details.isError ? t(bookingLoadRefusalKey(detailsFailure?.code, detailsFailure?.status)) : '';
  const reauthReturnTo = `/booking/${providerId}?${new URLSearchParams({ serviceId: chosenService, date: chosenDate })}`;
  function saveReauthDraft() { if (identityId) useBookingContactDraft.getState().save({ identityId, providerId, serviceId: chosenService, date: chosenDate, selected }); }
  return { upcoming, controls, review, reauthReturnTo, saveReauthDraft, locale, t, providerId, fromBookingId, serviceId, date, selected, busy, editingDisabled: busy || Boolean(pendingAttempt), pendingAttempt, pendingElsewhere, notice, error, detailsError, conflictSlot, identityId, details, provider, chosenService, chosenDate, slots, contacts, name, setName, setServiceId, setDate, setNotice, reset, choose, confirm, saveName };
}
