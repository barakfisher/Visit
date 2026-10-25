import { PublicationPanel } from '@/components/PublicationPanel';
import { PILOT_TIMEZONE } from '@visit/contracts';
import { appointmentDate, appointmentTime } from '@/src/lib/appointmentTime';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { ServiceCatalog } from '@/components/ServiceCatalog';
import { useLocalSearchParams } from 'expo-router';
import { useSessionStore } from '@/src/state/session';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ApiError, apiRequest } from '@/src/lib/api';
import { ActiveBookingCard } from '@/components/ActiveBookingCard';
import { confirmAppointmentCancellation } from '@/src/lib/bookingActions';

type Service = { id: string; name: string; durationMinutes: number; priceMinor: number | null; currency: string | null; active: boolean };
type Hours = { startLocal: string; endLocal: string }[];
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ProviderDashboard() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const identityId = useSessionStore((state) => state.identityId);
  return <BusinessSettings key={`${identityId}:${businessId}`} />;
}

function BusinessSettings() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const client = useQueryClient();
  const key = ['provider', businessId];
  const [staffName, setStaffName] = useState('');
  const [minimumNotice, setMinimumNotice] = useState('60');
  const [maximumAdvance, setMaximumAdvance] = useState('60');
  const [beforeBuffer, setBeforeBuffer] = useState('0');
  const [afterBuffer, setAfterBuffer] = useState('0');
  const [cancelCutoff, setCancelCutoff] = useState('1440');
  const [rescheduleCutoff, setRescheduleCutoff] = useState('1440');
  const [hours, setHours] = useState<Hours[]>(Array.from({ length: 7 }, () => []));
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [bookingError, setBookingError] = useState('');
  const services = useQuery({ queryKey: [...key, 'services'], queryFn: () => apiRequest<{ services: Service[] }>(`/v1/provider/businesses/${encodeURIComponent(businessId)}/services`) });
  const policy = useQuery({ queryKey: [...key, 'policy'], queryFn: () => apiRequest<{ policy: { minimumNoticeMinutes: number; maximumAdvanceDays: number; bufferBeforeMinutes: number; bufferAfterMinutes: number; cancellationCutoffMinutes: number; rescheduleCutoffMinutes: number } | null }>(`/v1/provider/businesses/${encodeURIComponent(businessId)}/booking-policy`) });
  const rules = useQuery({ queryKey: [...key, 'hours'], queryFn: () => apiRequest<{ weekly: { weekday: number; startLocal: string; endLocal: string }[]; overrides: { date: string; isOpen: boolean; startLocal: string | null; endLocal: string | null }[] }>(`/v1/provider/businesses/${encodeURIComponent(businessId)}/availability-rules`) });
  const business = useQuery({ queryKey: [...key, 'business'], queryFn: () => apiRequest<{ business: { id: string; name: string; timezone: string; approvalStatus: string }; role: string }>(`/v1/provider/businesses/${encodeURIComponent(businessId)}`) });
  const agenda = useQuery({ queryKey: [...key, 'bookings'], queryFn: () => apiRequest<{ bookings: { id: string; status: string; startsAt: string; service: { name: string }; staff: { displayName: string } }[] }>(`/v1/provider/businesses/${encodeURIComponent(businessId)}/bookings`) });
  const { locale } = useAppLocale();
  const businessTimezone = business.data?.business.timezone ?? PILOT_TIMEZONE;
  const upcomingBookings = agenda.data?.bookings.filter((booking) => booking.status === 'CONFIRMED' && new Date(booking.startsAt).getTime() >= agenda.dataUpdatedAt).sort((a, b) => a.startsAt.localeCompare(b.startsAt)) ?? [];

  async function cancelProviderBooking(bookingId: string) {
    if (!await confirmAppointmentCancellation()) return;
    setBookingError('');
    try { await apiRequest(`/v1/provider/businesses/${encodeURIComponent(businessId)}/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: 'POST' }); await client.invalidateQueries({ queryKey: [...key, 'bookings'] }); }
    catch (reason) { setBookingError(reason instanceof ApiError ? reason.message : 'Could not cancel this appointment.'); }
  }

  useEffect(() => {
    if (!rules.data) return;
    const grouped: Hours[] = Array.from({ length: 7 }, () => []);
    for (const interval of rules.data.weekly) grouped[interval.weekday]?.push({ startLocal: interval.startLocal, endLocal: interval.endLocal });
    // Hydrate the editable form once its server-backed settings arrive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHours(grouped);
  }, [rules.data]);
  useEffect(() => {
    if (policy.data?.policy) {
      const value = policy.data.policy;
      // Hydrate the editable form once its server-backed policy arrives.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMinimumNotice(String(value.minimumNoticeMinutes)); setMaximumAdvance(String(value.maximumAdvanceDays));
      setBeforeBuffer(String(value.bufferBeforeMinutes)); setAfterBuffer(String(value.bufferAfterMinutes));
      setCancelCutoff(String(value.cancellationCutoffMinutes)); setRescheduleCutoff(String(value.rescheduleCutoffMinutes));
    }
  }, [policy.data]);


  const savePolicy = useMutation({ mutationFn: () => apiRequest(`/v1/provider/businesses/${encodeURIComponent(businessId)}/booking-policy`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minimumNoticeMinutes: Number(minimumNotice), maximumAdvanceDays: Number(maximumAdvance), bufferBeforeMinutes: Number(beforeBuffer), bufferAfterMinutes: Number(afterBuffer), cancellationCutoffMinutes: Number(cancelCutoff), rescheduleCutoffMinutes: Number(rescheduleCutoff) }) }), onSuccess: () => { setFeedback('Booking policy saved.'); setError(''); void client.invalidateQueries({ queryKey: [...key, 'policy'] }); }, onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'Could not save booking policy.') });
  const saveHours = useMutation({ mutationFn: () => apiRequest(`/v1/provider/businesses/${encodeURIComponent(businessId)}/availability-rules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekly: hours.map((intervals, weekday) => ({ weekday, intervals })), overrides: rules.data?.overrides.map((item) => ({ date: new Date(item.date).toISOString().slice(0, 10), isOpen: item.isOpen, ...(item.isOpen ? { startLocal: item.startLocal, endLocal: item.endLocal } : {}) })) ?? [] }) }), onSuccess: () => { setFeedback('Working hours saved.'); setError(''); void client.invalidateQueries({ queryKey: [...key, 'hours'] }); }, onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'Could not save working hours.') });
  const createStaff = useMutation({ mutationFn: () => { const serviceId = services.data?.services.find((item) => item.active)?.id; if (!serviceId) throw new Error('Add an active service first.'); return apiRequest(`/v1/provider/businesses/${encodeURIComponent(businessId)}/staff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: staffName, serviceIds: [serviceId] }) }); }, onSuccess: () => { setStaffName(''); setFeedback('Provider added with capacity set to one.'); setError(''); }, onError: (reason) => setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'Could not add provider.') });

  function updateHours(index: number, next: Hours) { setHours((current) => current.map((value, item) => item === index ? next : value)); }
  const loading = services.isLoading || policy.isLoading || rules.isLoading;

  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-3xl gap-6 px-5 py-8 md:px-8">
    <View className="gap-2"><Text className="text-sm font-semibold uppercase tracking-widest text-brand">Provider workspace</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">{business.data?.business.name ?? 'Business setup'}</Text><Text className="leading-6 text-body">Services, weekly hours, and booking rules are scoped to this approved business. Timezone: {businessTimezone}.</Text></View>
    {loading ? <View className="flex-row items-center gap-2"><ActivityIndicator color="#0f766e"/><Text className="text-body">Loading your business…</Text></View> : null}
    <View className="gap-4 rounded-card border border-line bg-surface p-card"><Text className="text-xl font-semibold text-ink">Upcoming appointments</Text>{agenda.isLoading ? <ActivityIndicator color="#0f766e"/> : agenda.isError ? <Text accessibilityRole="alert" className="text-warning">Could not load the agenda. Refresh to retry.</Text> : upcomingBookings.length ? upcomingBookings.map((booking) => <ActiveBookingCard key={booking.id} service={booking.service.name} provider={booking.staff.displayName} dateLabel={appointmentDate(booking.startsAt, businessTimezone, locale)} timeLabel={appointmentTime(booking.startsAt, businessTimezone, locale)} timezone={businessTimezone} onCancel={() => void cancelProviderBooking(booking.id)}/>) : <Text className="text-sm leading-5 text-body">No upcoming appointments yet.</Text>}{bookingError ? <Text accessibilityRole="alert" className="text-warning">{bookingError}</Text> : null}</View>
    <PublicationPanel key={businessId} businessId={businessId} />
    <ServiceCatalog businessId={businessId}/>
    <View className="gap-4 rounded-card border border-line bg-surface p-card"><Text className="text-xl font-semibold text-ink">Working hours</Text><Text className="text-sm leading-5 text-body">Days without an interval are closed. Times use the business timezone. Save explicit hours to make times bookable.</Text>{weekdays.map((day, index) => <View key={day} className="gap-2 border-b border-line pb-3"><Text className="font-medium text-ink">{day}</Text>{hours[index]?.map((interval, intervalIndex) => <View key={intervalIndex} className="flex-row items-center gap-2"><TextInput accessibilityLabel={`${day} opening time`} value={interval.startLocal} onChangeText={(value) => updateHours(index, hours[index]!.map((row, i) => i === intervalIndex ? { ...row, startLocal: value } : row))} className="flex-1 rounded-control border border-line px-3 py-3 text-ink"/><Text className="text-body">to</Text><TextInput accessibilityLabel={`${day} closing time`} value={interval.endLocal} onChangeText={(value) => updateHours(index, hours[index]!.map((row, i) => i === intervalIndex ? { ...row, endLocal: value } : row))} className="flex-1 rounded-control border border-line px-3 py-3 text-ink"/><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${day} hours`} onPress={() => updateHours(index, hours[index]!.filter((_, i) => i !== intervalIndex))} className="px-2 py-3"><Text className="font-semibold text-warning">Remove</Text></Pressable></View>)}<Pressable accessibilityRole="button" onPress={() => updateHours(index, [...(hours[index] ?? []), { startLocal: '09:00', endLocal: '17:00' }])} className="self-start rounded-control border border-line px-4 py-3"><Text className="font-semibold text-brand">Add hours</Text></Pressable></View>)}<Pressable disabled={saveHours.isPending} onPress={() => saveHours.mutate()} accessibilityRole="button" className="items-center rounded-control bg-brand px-4 py-4 disabled:opacity-50"><Text className="font-semibold text-white">Save working hours</Text></Pressable></View>
    <View className="gap-4 rounded-card border border-line bg-surface p-card"><Text className="text-xl font-semibold text-ink">Booking policy</Text><Text className="text-sm leading-5 text-body">Set the rules customers see for booking, cancellation, and rescheduling.</Text>{[['Minimum notice (minutes)', minimumNotice, setMinimumNotice], ['Maximum advance (days)', maximumAdvance, setMaximumAdvance], ['Buffer before (minutes)', beforeBuffer, setBeforeBuffer], ['Buffer after (minutes)', afterBuffer, setAfterBuffer], ['Cancellation cutoff (minutes)', cancelCutoff, setCancelCutoff], ['Reschedule cutoff (minutes)', rescheduleCutoff, setRescheduleCutoff]].map(([label, value, setter]) => <TextInput key={String(label)} accessibilityLabel={String(label)} keyboardType="number-pad" placeholder={String(label)} value={String(value)} onChangeText={setter as (value: string) => void} className="rounded-control border border-line px-4 py-3 text-ink"/>)}<Pressable disabled={savePolicy.isPending} onPress={() => savePolicy.mutate()} accessibilityRole="button" className="items-center rounded-control bg-brand px-4 py-4 disabled:opacity-50"><Text className="font-semibold text-white">Save booking policy</Text></Pressable></View>
    <View className="gap-4 rounded-card border border-line bg-surface p-card"><Text className="text-xl font-semibold text-ink">Providers</Text><Text className="text-sm leading-5 text-body">A provider is assigned to the first active service. Capacity starts at one.</Text><TextInput accessibilityLabel="Provider name" placeholder="Provider name" value={staffName} onChangeText={setStaffName} className="rounded-control border border-line px-4 py-3 text-ink"/><Pressable disabled={createStaff.isPending || !staffName.trim() || !services.data?.services.some((item) => item.active)} onPress={() => createStaff.mutate()} accessibilityRole="button" className="items-center rounded-control bg-brand px-4 py-4 disabled:opacity-50"><Text className="font-semibold text-white">Add provider</Text></Pressable></View>
    {feedback ? <Text className="rounded-control bg-brand-soft p-4 text-ink">{feedback}</Text> : null}{error ? <Text accessibilityRole="alert" className="text-warning">{error}</Text> : null}
  </ScrollView>;
}
