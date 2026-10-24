import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { apiRequest } from '@/src/lib/api';
import { useAuthStore } from '@/src/state/auth';
import { ActiveBookings } from '@/components/ActiveBookings';
import { confirmAppointmentCancellation } from '@/src/lib/bookingActions';
import type { ActiveBooking, Provider } from '@/src/types/flows';

export default function DiscoverScreen() {
  const identityId = useAuthStore((state) => state.identityId);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [error, setError] = useState('');
  const client = useQueryClient();
  useEffect(() => { const timer = setTimeout(() => setQuery(search), 250); return () => clearTimeout(timer); }, [search]);
  const providers = useQuery({ queryKey: ['providers', query, category], queryFn: () => apiRequest<{ providers: Provider[]; total: number; categories: string[] }>(`/api/providers?${new URLSearchParams({ search: query, category })}`) });
  const active = useQuery({ queryKey: ['consumer', 'active', identityId], queryFn: () => apiRequest<{ bookings: ActiveBooking[] }>('/api/consumer/bookings/active'), enabled: Boolean(identityId) });
  const singleId = providers.data?.total === 1 && !search && category === 'All' ? providers.data.providers[0]?.id : undefined;
  useEffect(() => { if (singleId) router.replace({ pathname: '/booking/[providerId]', params: { providerId: singleId } }); }, [singleId]);
  async function cancel(booking: ActiveBooking) {
    if (!await confirmAppointmentCancellation()) return;
    try { await apiRequest(`/v1/bookings/${booking.id}/cancel`, { method: 'POST' }); await client.invalidateQueries({ queryKey: ['consumer', 'active'] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not cancel.'); }
  }
  return <View className="flex-1 bg-canvas"><View className="mx-auto w-full max-w-3xl gap-4 px-5 pb-4 pt-6 md:px-8">
    <View className="flex-row items-center justify-between"><View><Text className="text-xs font-semibold uppercase tracking-widest text-brand">Visit</Text><Text accessibilityRole="header" className="mt-1 text-3xl font-bold text-ink">Find a service</Text></View><Link href={identityId ? '/(tabs)/two' : '/auth/login'} className="font-semibold text-brand">{identityId ? 'Account' : 'Sign in'}</Link></View>
    {identityId && active.data ? <ActiveBookings bookings={active.data.bookings} onReschedule={(booking) => router.push({ pathname: '/booking/[providerId]', params: { providerId: booking.business.id, serviceId: booking.service.id, fromBookingId: booking.id } })} onCancel={(booking) => void cancel(booking)} /> : null}
    {error ? <Text accessibilityRole="alert" className="text-danger">{error}</Text> : null}
    <TextInput accessibilityLabel="Search businesses" placeholder="Search name, location or category" autoCapitalize="none" value={search} onChangeText={setSearch} className="rounded-control border border-line bg-surface px-4 py-4 text-ink"/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">{['All', ...(providers.data?.categories ?? [])].map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: category === item }} onPress={() => setCategory(item)} className={`rounded-full border px-4 py-2 ${category === item ? 'border-brand bg-brand' : 'border-line bg-surface'}`}><Text className={category === item ? 'font-semibold text-white' : 'text-body'}>{item}</Text></Pressable>)}</ScrollView>
  </View>
    {providers.isLoading ? <ActivityIndicator color="#0f766e"/> : providers.isError ? <View className="mx-5 gap-3"><Text accessibilityRole="alert" className="text-danger">{providers.error.message}</Text><Pressable accessibilityRole="button" onPress={() => void providers.refetch()}><Text className="font-semibold text-brand">Try again</Text></Pressable></View> : <FlatList data={providers.data?.providers ?? []} keyExtractor={(provider) => provider.id} initialNumToRender={8} windowSize={5} contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16, width: '100%', maxWidth: 768, alignSelf: 'center' }} ListEmptyComponent={<Text className="rounded-card border border-line bg-surface p-5 text-body">{query || category !== 'All' ? 'No providers match your filters.' : 'No businesses yet. Approved businesses will appear here.'}</Text>} renderItem={({ item }) => <View className="gap-3 rounded-card border border-line bg-surface p-5 shadow-card"><View className="flex-row justify-between gap-3"><Text className="flex-1 text-xl font-semibold text-ink">{item.name}</Text><Text className="text-sm text-muted">{item.rating === null ? '(Reviews coming soon)' : `★ ${item.rating}`}</Text></View><Text className="text-sm text-body">{item.category} · {item.location ?? '(Location not added)'}</Text><Link href={{ pathname: '/booking/[providerId]', params: { providerId: item.id } }} className="self-start rounded-control bg-brand px-5 py-3 font-semibold text-white">Book Appointment</Link></View>}/>}<Link href="/" className="pb-3 text-center text-sm text-brand">Back to Visit</Link>
  </View>;
}
