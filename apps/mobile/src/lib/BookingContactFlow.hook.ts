import { canDiscardBookingAttempt } from './BookingAttempt.utils';
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
import { slotLabels } from '@/src/lib/slotLabels';
import { makeCalendarDays } from '@/src/lib/calendar';
import { useAuthStore } from '@/src/state/auth';
import type { BookingContactReadiness } from '@/src/types/BookingContact.types';
import { formatMoney, type ProviderDetail, type Slot } from '@/src/types/flows';
const slotId = (slot: Slot) => `${slot.staffId}:${slot.startsAt}`;
export function useBookingContactFlow() {
  const { locale, t } = useAppLocale();
  const params = useLocalSearchParams<{ providerId: string; serviceId?: string; date?: string; fromBookingId?: string }>();
  const { providerId, fromBookingId } = params;
  const [serviceId, setServiceId] = useState(params.serviceId ?? '');
  const [date, setDate] = useState(params.date ?? '');
  const [selected, setSelected] = useState<Slot | null>(null);
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
  const attempt = useBookingAttempt(state => state.attempt);
  const pendingElsewhere = Boolean(attempt && attempt.identityId === identityId && attempt.providerId !== providerId);
  const pendingAttempt = attempt?.identityId === identityId && attempt.providerId === providerId ? attempt : null;
  const contacts = useQuery({ queryKey: ['booking-contact', providerId, identityId, contextVersion], queryFn: () => apiRequest<BookingContactReadiness>(`/api/providers/${providerId}/contact-readiness`), enabled: Boolean(identityId && !fromBookingId), refetchInterval: 10000 });
  useEffect(() => {
    sequence.current += 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(false);
    if (previousIdentity.current !== identityId) { setSelected(null); setName(''); if (previousIdentity.current) { setServiceId(''); setDate(''); } }
    const saved = useBookingContactDraft.getState().draft;
    if (saved && identityId) {
      if (saved.identityId === identityId && saved.providerId === providerId) { setServiceId(saved.serviceId); setDate(saved.date); setSelected(saved.selected); }
      useBookingContactDraft.getState().clear();
    }
    previousIdentity.current = identityId;
  }, [identityId, contextVersion, providerId]);
  async function saveName() {
    setBusy(true); setError('');
    try { await apiRequest('/api/account/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name }) }); await contacts.refetch(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save name.'); }
    finally { setBusy(false); }
  }
  const details = useQuery({ queryKey: ['provider', providerId, fromBookingId ?? 'public'], queryFn: () => apiRequest<{ provider: ProviderDetail }>(`/api/${fromBookingId ? `bookings/${fromBookingId}/provider` : `providers/${providerId}`}`) });
  const provider = details.data?.provider;
  useProviderActivation(provider && !fromBookingId ? { businessId: provider.id } : undefined);
  const days = provider ? makeCalendarDays(provider) : [];
  const chosenService = serviceId || provider?.services[0]?.id || '';
  const chosenDate = date || days.find((day) => !day.disabled)?.id || days[0]?.id || '';
  const slots = useQuery({ queryKey: ['availability', providerId, fromBookingId ?? 'public', chosenService, chosenDate], queryFn: () => apiRequest<{ slots: Slot[] }>(`/api/${fromBookingId ? `bookings/${fromBookingId}` : `providers/${providerId}`}/availability?${new URLSearchParams({ serviceId: chosenService, date: chosenDate })}`), enabled: Boolean(chosenService && /^\d{4}-\d{2}-\d{2}$/.test(chosenDate)), refetchInterval: 2000 });
  useEffect(() => {
    // A fresh availability response may make a previously contested slot bookable again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConflictSlot((current) => current && slots.data?.slots.some((slot) => slotId(slot) === current && slot.available) ? null : current);
  }, [slots.data]);
  const labels = slotLabels(slots.data?.slots ?? [], locale);
  useEffect(() => { focusRef.current = focused; if (!focused) sequence.current += 1; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1; }; }, []);
  async function reset() { if (operation.current || pendingAttempt) return; sequence.current += 1; setConflictSlot(null); setSelected(null); setNotice(''); setError(''); }
  async function choose(slot: Slot) {
    if (operation.current || pendingAttempt) return;
    sequence.current += 1; setSelected(slot); setError(''); setNotice('');
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
    const isCurrent = () => mounted.current && focusRef.current && sequence.current === requestId && useAuthStore.getState().identityId === identityId;
    setBusy(true); setError('');
    let result: BookingOutcome | null = null;
    let logical: BookingAttempt | null = pendingAttempt;
    try {
      logical ??= selected && !fromBookingId && reviewed ? { reviewedService: { name: reviewed.name, durationMinutes: reviewed.durationMinutes, priceMinor: reviewed.priceMinor, currency: reviewed.currency }, identityId, providerId, serviceId: chosenService, staffId: selected.staffId, startsAt: selected.startsAt, idempotencyKey: randomUUID() } : null;
      if (fromBookingId && selected) {
        const moved = await apiRequest<{ id: string }>(`/v1/bookings/${fromBookingId}/reschedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: selected.staffId, startsAt: selected.startsAt }) });
        result = { id: moved.id, status: 'CONFIRMED' };
      } else if (logical) {
        useBookingAttempt.getState().set(logical);
        const recovered = pendingAttempt ? await recoverBooking(logical) : null;
        if (recovered?.status === 'CANCELLED' || recovered?.status === 'EXPIRED') throw new ApiError(t('bookingCommit.conflict'), 'HOLD_EXPIRED', 409);
        result = recovered?.status === 'CONFIRMED' ? recovered : await commitBooking(logical);
      }
    } catch (reason) {
      let terminal = false;
      if (logical) {
        try { const recovered = await recoverBooking(logical); if (recovered?.status === 'CONFIRMED') result = recovered; terminal = canDiscardBookingAttempt(recovered); }
        catch { /* Preserve the attempt key while the committed outcome is uncertain. */ }
      }
      if (!result && isCurrent()) {
        if (terminal || fromBookingId && reason instanceof ApiError && reason.status === 409) {
          useBookingAttempt.getState().set(null); setSelected(null);
          if (selected) setConflictSlot(slotId(selected));
          setError(reason instanceof Error ? reason.message : t('bookingCommit.conflict')); await contacts.refetch(); await details.refetch(); await slots.refetch();
        } else setError(t('bookingCommit.uncertain'));
      }
    } finally {
      if (result?.status === 'CONFIRMED' && isCurrent()) {
        useBookingAttempt.getState().set(null);
        await Promise.allSettled([client.invalidateQueries({ queryKey: ['consumer', 'active'] }), client.invalidateQueries({ queryKey: ['me', 'bookings'] })]);
        if (isCurrent()) router.replace({ pathname: '/confirmation/[bookingId]', params: { bookingId: result.id } });
      }
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const reviewedService = provider?.services.find(service => service.id === chosenService);
  const review = selected && provider && reviewedService ? {
    businessAndService: `${provider.name} · ${reviewedService.name}`,
    timeAndStaff: `${new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: provider.timezone }).format(new Date(selected.startsAt))} · ${selected.staffName}`,
    durationAndPrice: `${reviewedService.durationMinutes} ${t('bookingCommit.minutes')} · ${formatMoney(reviewedService.priceMinor, reviewedService.currency)}`,
    cancellation: t('bookingCommit.cancel', { minutes: provider.bookingPolicy?.cancellationCutoffMinutes ?? 0 }),
  } : null;
  const reauthReturnTo = `/booking/${providerId}?${new URLSearchParams({ serviceId: chosenService, date: chosenDate })}`;
  function saveReauthDraft() { if (identityId) useBookingContactDraft.getState().save({ identityId, providerId, serviceId: chosenService, date: chosenDate, selected }); }
  return { review, reauthReturnTo, saveReauthDraft, locale, t, providerId, fromBookingId, serviceId, date, selected, busy, editingDisabled: busy || Boolean(pendingAttempt), pendingAttempt, pendingElsewhere, notice, error, conflictSlot, identityId, details, provider, days, chosenService, chosenDate, slots, labels, contacts, name, setName, setServiceId, setDate, setNotice, reset, choose, confirm, saveName };
}
