import { useLocalSearchParams, Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError, apiRequest } from '@/src/lib/api';
import { exportBookingCalendar } from '@/src/lib/calendar';

type Booking = { id: string; status: string; startsAt: string; endsAt: string; business: { name: string; timezone: string }; service: { name: string; durationMinutes: number; priceMinor: number | null; currency: string | null }; staff: { displayName: string } };

export default function ConfirmationScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const [calendarError, setCalendarError] = useState('');
  const [exporting, setExporting] = useState(false);
  const bookings = useQuery({ queryKey: ['me', 'bookings'], queryFn: () => apiRequest<{ bookings: Booking[] }>('/v1/me/bookings') });
  const booking = bookings.data?.bookings.find((item) => item.id === bookingId && item.status === 'CONFIRMED');
  const when = booking ? new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: booking.business.timezone, timeZoneName: 'short' }).format(new Date(booking.startsAt)) : '';

  async function addToCalendar() {
    if (!booking) return;
    setExporting(true); setCalendarError('');
    try { await exportBookingCalendar(booking); }
    catch { setCalendarError('Could not open the calendar export. You can retry from this page.'); }
    finally { setExporting(false); }
  }

  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 px-5 py-8 md:px-8">
    <View className="gap-2"><Text className="text-sm font-semibold uppercase tracking-widest text-brand">Booking complete</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">You’re all set</Text><Text className="leading-6 text-body">Your appointment is confirmed and saved.</Text></View>
    {bookings.isLoading ? <View className="flex-row items-center gap-2"><ActivityIndicator color="#0f766e"/><Text className="text-body">Loading confirmed booking…</Text></View> : bookings.isError ? <Text accessibilityRole="alert" className="text-warning">{bookings.error instanceof ApiError ? bookings.error.message : 'Could not load your confirmation.'}</Text> : booking ? <View className="gap-3 rounded-card border border-line bg-surface p-card"><Text className="text-xl font-semibold text-ink">{booking.service.name}</Text><Text className="font-semibold text-brand">{when}</Text><Text className="text-body">{booking.service.durationMinutes} minutes · {booking.staff.displayName}</Text><Text className="text-body">{booking.business.name} · {booking.business.timezone}</Text>{booking.service.priceMinor != null && booking.service.currency ? <Text className="text-body">{(booking.service.priceMinor / 100).toFixed(2)} {booking.service.currency}</Text> : null}</View> : <Text className="text-body">This booking isn’t confirmed for your account. Return to availability and try again.</Text>}
    {booking ? <Pressable disabled={exporting} onPress={addToCalendar} accessibilityRole="button" className="items-center rounded-control border border-line bg-surface px-5 py-4 disabled:opacity-50">{exporting ? <ActivityIndicator color="#0f766e"/> : <Text className="font-semibold text-ink">Add to calendar (.ics)</Text>}</Pressable> : null}
    {calendarError ? <Text accessibilityRole="alert" className="text-warning">{calendarError}</Text> : null}
    <Link href="/" className="font-semibold text-brand">Back to Visit</Link>
  </ScrollView>;
}
