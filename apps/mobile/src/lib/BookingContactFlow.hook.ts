import { useBookingContactDraft } from '@/src/state/BookingContactDraft.store';
import { useProviderActivation } from '@/src/lib/useProviderActivation';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '@/src/lib/api';
import { slotLabels } from '@/src/lib/slotLabels';
import { makeCalendarDays } from '@/src/lib/calendar';
import { useAuthStore } from '@/src/state/auth';
import type { BookingContactReadiness } from '@/src/types/BookingContact.types';
import type { ProviderDetail, Slot, Hold } from '@/src/types/flows';
const slotId = (slot: Slot) => `${slot.staffId}:${slot.startsAt}`;
export function useBookingContactFlow() {
  const { locale, t } = useAppLocale();
  const params = useLocalSearchParams<{ providerId: string; serviceId?: string; date?: string; fromBookingId?: string }>();
  const { providerId, fromBookingId } = params;
  const [serviceId, setServiceId] = useState(params.serviceId ?? '');
  const [date, setDate] = useState(params.date ?? '');
  const [selected, setSelected] = useState<Slot | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [conflictSlot, setConflictSlot] = useState<string | null>(null);
  const holdRef = useRef<Hold | null>(null);
  const sequence = useRef(0);
  const identityId = useAuthStore((state) => state.identityId);
  const contextVersion = useAuthStore(state => state.contextVersion);
  const previousIdentity = useRef(identityId);
  const [name, setName] = useState('');
  const client = useQueryClient();
  const contacts = useQuery({ queryKey: ['booking-contact', providerId, identityId, contextVersion], queryFn: () => apiRequest<BookingContactReadiness>(`/api/providers/${providerId}/contact-readiness`), enabled: Boolean(identityId && !fromBookingId), refetchInterval: 10000 });
  useEffect(() => {
    sequence.current += 1;
    const current = holdRef.current; holdRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHold(null); setBusy(false);
    if (current) void apiRequest(`/api/bookings/${current.holdId}/release`, { method: 'POST' }).catch(() => {});
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
  async function release() {
    const current = holdRef.current; holdRef.current = null; setHold(null);
    if (current) await apiRequest(`/api/bookings/${current.holdId}/release`, { method: 'POST' }).catch(() => {});
  }
  useEffect(() => () => { sequence.current += 1; const current = holdRef.current; if (current) void apiRequest(`/api/bookings/${current.holdId}/release`, { method: 'POST' }).catch(() => {}); }, []);
  async function reset() { sequence.current += 1; setBusy(false); setConflictSlot(null); setSelected(null); setNotice(''); setError(''); await release(); }
  async function choose(slot: Slot) {
    const requestId = ++sequence.current;
    setBusy(true); setError(''); setNotice('');
    await release();
    if (requestId !== sequence.current) return;
    setSelected(slot);
    if (!identityId || fromBookingId || !contacts.data?.ready) { setBusy(false); if (!identityId) setNotice('Sign in to reserve this time.'); return; }
    try {
      const next = await apiRequest<Hold>('/api/bookings/lock-slot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, serviceId: chosenService, staffId: slot.staffId, startsAt: slot.startsAt, idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}-${identityId}` }) });
      if (requestId !== sequence.current) { await apiRequest(`/api/bookings/${next.holdId}/release`, { method: 'POST' }); return; }
      holdRef.current = next; setHold(next);
    } catch (reason) { if (requestId === sequence.current) { setSelected(null); if (reason instanceof ApiError && reason.status === 409) setConflictSlot(slotId(slot)); setError(reason instanceof Error ? reason.message : 'This time was just taken. Choose another slot.'); } }
    finally { if (requestId === sequence.current) { setBusy(false); await slots.refetch(); } }
  }
  async function confirm() {
    if (!identityId) { router.push({ pathname: '/auth/login', params: { returnTo: `/booking/${providerId}?serviceId=${chosenService}&date=${chosenDate}` } }); return; }
    if (!selected || (!fromBookingId && (!hold || !contacts.data?.ready))) return;
    setBusy(true); setError('');
    try {
      const result = fromBookingId ? await apiRequest<{ id: string }>(`/v1/bookings/${fromBookingId}/reschedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: selected.staffId, startsAt: selected.startsAt }) }) : await apiRequest<{ id: string }>('/api/bookings/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ holdId: hold!.holdId }) });
      holdRef.current = null; setHold(null);
      await client.invalidateQueries({ queryKey: ['consumer', 'active'] });
      await client.invalidateQueries({ queryKey: ['me', 'bookings'] });
      router.replace({ pathname: '/confirmation/[bookingId]', params: { bookingId: result.id } });
    } catch (reason) { if (reason instanceof ApiError && reason.status === 409) { await release(); await contacts.refetch(); } setError(reason instanceof Error ? reason.message : 'Could not confirm your appointment.'); await slots.refetch(); }
    finally { setBusy(false); }
  }
  const reauthReturnTo = `/booking/${providerId}?${new URLSearchParams({ serviceId: chosenService, date: chosenDate })}`;
  function saveReauthDraft() { if (identityId) useBookingContactDraft.getState().save({ identityId, providerId, serviceId: chosenService, date: chosenDate, selected }); }
  return { reauthReturnTo, saveReauthDraft, locale, t, providerId, fromBookingId, serviceId, date, selected, hold, busy, notice, error, conflictSlot, identityId, details, provider, days, chosenService, chosenDate, slots, labels, contacts, name, setName, setServiceId, setDate, setNotice, reset, choose, confirm, saveName };
}
