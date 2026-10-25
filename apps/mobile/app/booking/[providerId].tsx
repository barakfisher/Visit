import { useProviderActivation } from '@/src/lib/useProviderActivation';
import { timePolicyNote } from '@/src/lib/appointmentTime';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { HorizontalCalendarBar } from '@/components/HorizontalCalendarBar';
import { TimeChips } from '@/components/TimeChips';
import { ServiceCard } from '@/components/ServiceCard';
import { HoldLockCountdown } from '@/components/HoldLockCountdown';
import { apiRequest, ApiError } from '@/src/lib/api';
import { slotLabels } from '@/src/lib/slotLabels';
import { makeCalendarDays } from '@/src/lib/calendar';
import { useAuthStore } from '@/src/state/auth';
import { formatMoney, type ProviderDetail, type Slot, type Hold } from '@/src/types/flows';

const slotId = (slot: Slot) => `${slot.staffId}:${slot.startsAt}`;
export default function BookingScreen() {
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
  const client = useQueryClient();
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
    if (!identityId || fromBookingId) { setBusy(false); if (!identityId) setNotice('Sign in to reserve this time.'); return; }
    try {
      const next = await apiRequest<Hold>('/api/bookings/lock-slot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, serviceId: chosenService, staffId: slot.staffId, startsAt: slot.startsAt, idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2)}-${identityId}` }) });
      if (requestId !== sequence.current) { await apiRequest(`/api/bookings/${next.holdId}/release`, { method: 'POST' }); return; }
      holdRef.current = next; setHold(next);
    } catch (reason) { if (requestId === sequence.current) { setSelected(null); if (reason instanceof ApiError && reason.status === 409) setConflictSlot(slotId(slot)); setError(reason instanceof Error ? reason.message : 'This time was just taken. Choose another slot.'); } }
    finally { if (requestId === sequence.current) { setBusy(false); await slots.refetch(); } }
  }
  async function confirm() {
    if (!identityId) { router.push({ pathname: '/auth/login', params: { returnTo: `/booking/${providerId}?serviceId=${chosenService}&date=${chosenDate}` } }); return; }
    if (!selected || (!fromBookingId && !hold)) return;
    setBusy(true); setError('');
    try {
      const result = fromBookingId ? await apiRequest<{ id: string }>(`/v1/bookings/${fromBookingId}/reschedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: selected.staffId, startsAt: selected.startsAt }) }) : await apiRequest<{ id: string }>('/api/bookings/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ holdId: hold!.holdId }) });
      holdRef.current = null; setHold(null);
      await client.invalidateQueries({ queryKey: ['consumer', 'active'] });
      await client.invalidateQueries({ queryKey: ['me', 'bookings'] });
      router.replace({ pathname: '/confirmation/[bookingId]', params: { bookingId: result.id } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not confirm your appointment.'); await slots.refetch(); }
    finally { setBusy(false); }
  }
  return <View className="flex-1 bg-canvas"><ScrollView contentContainerClassName="mx-auto w-full max-w-3xl gap-6 px-5 py-6 pb-10 md:px-8">
    <Link href="/" className="font-semibold text-brand">{t('providerEntry.home')}</Link><View className="gap-2"><Text className="text-xs font-semibold uppercase tracking-widest text-brand">{provider?.name ?? 'Book a visit'}</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">Available appointments</Text><Text className="text-body">{provider ? timePolicyNote(provider.timezone, locale) : 'Loading provider…'}</Text></View>
    {details.isLoading ? <ActivityIndicator color="#0f766e"/> : details.isError ? <Text accessibilityRole="alert" className="text-danger">{details.error.message}</Text> : <>
    <View className="gap-3"><Text className="text-lg font-semibold text-ink">1. Choose a service</Text>{provider?.services.map((service) => <ServiceCard key={service.id} name={service.name} description={service.description ?? undefined} durationMinutes={service.durationMinutes} priceLabel={formatMoney(service.priceMinor, service.currency)} selected={service.id === chosenService} disabled={busy} onPress={() => { void reset(); setServiceId(service.id); }}/>)}</View>
    <View className="gap-2"><Text className="text-lg font-semibold text-ink">2. Pick a date</Text><HorizontalCalendarBar days={days.map((day) => ({ ...day, disabled: busy || day.disabled }))} selectedId={chosenDate} onSelect={(value) => { void reset(); setDate(value); }}/><TextInput accessibilityLabel="Appointment date" placeholder="YYYY-MM-DD" editable={!busy} value={chosenDate} onChangeText={(value) => { void reset(); setDate(value); }} className="rounded-control border border-line bg-surface px-4 py-3 text-ink"/></View>
    <View className="gap-3"><Text className="text-lg font-semibold text-ink">3. Choose a time</Text><Text className="text-sm text-muted">Grey times are booked, blocked or held. Availability updates while you browse.</Text>{slots.isError ? <Text accessibilityRole="alert" className="text-danger">{slots.error.message}</Text> : !slots.isLoading && !slots.data?.slots.length ? <Text className="text-body">No times are available for this date. Try another date.</Text> : <TimeChips timezone={provider?.timezone ?? ''} loading={slots.isLoading} busy={busy} selectedId={selected ? slotId(selected) : null} slots={(slots.data?.slots ?? []).map((slot, index) => ({ id: slotId(slot), label: labels[index]!, disabled: slotId(slot) === conflictSlot || !slot.available && !(hold && selected && slotId(selected) === slotId(slot)), locked: slot.locked && !(hold && selected && slotId(selected) === slotId(slot)) }))} onSelect={(id) => { const slot = slots.data?.slots.find((item) => slotId(item) === id); if (slot) void choose(slot); }}/>}</View>
    </>}

  </ScrollView><View className="border-t border-line bg-surface px-5 py-4"><View className="mx-auto w-full max-w-3xl gap-3">{notice ? <Text accessibilityLiveRegion="polite" className="rounded-control bg-brand-soft p-4 text-brand">{notice}</Text> : null}{error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" className="rounded-control bg-red-50 p-4 text-danger">{error}</Text> : null}{hold ? <HoldLockCountdown expiresAt={hold.expiresAt} onExpire={() => { void reset(); setNotice('Your reservation expired. Select an available time again.'); void slots.refetch(); }}/>: null}<ActionButton label={!identityId ? 'Sign in to reserve this time' : fromBookingId ? 'Confirm reschedule' : 'Confirm & Book Appointment'} onPress={() => void confirm()} busy={busy} disabled={!selected || Boolean(identityId && !fromBookingId && !hold)}/></View></View></View>;
}
