import { Link, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { ApiError, apiRequest } from '@/src/lib/api';

type ServiceList = { services: { id: string; name: string; description: string | null; durationMinutes: number; priceMinor: number | null; currency: string | null }[] };

export default function BusinessScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const services = useQuery({ queryKey: ['public', 'services', businessId], queryFn: () => apiRequest<ServiceList>(`/v1/businesses/${encodeURIComponent(businessId)}/services`), enabled: Boolean(businessId) });
  return <ScrollView className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 px-5 py-8 md:px-8">
    <View className="gap-2"><Text className="text-sm font-semibold uppercase tracking-widest text-brand">Available services</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">Choose your appointment</Text></View>
    {services.isLoading ? <View className="flex-row items-center gap-2"><ActivityIndicator color="#0f766e"/><Text className="text-body">Loading services…</Text></View> : services.isError ? <Text accessibilityRole="alert" className="text-warning">{services.error instanceof ApiError ? services.error.message : 'Could not load services.'}</Text> : services.data?.services.length ? services.data.services.map((service) => <View key={service.id} className="gap-2 rounded-card border border-line bg-surface p-card"><Text className="text-lg font-semibold text-ink">{service.name}</Text>{service.description ? <Text className="leading-5 text-body">{service.description}</Text> : null}<Text className="text-sm text-body">{service.durationMinutes} minutes{service.priceMinor != null && service.currency ? ` · ${(service.priceMinor / 100).toFixed(2)} ${service.currency}` : ''}</Text><Link href={{ pathname: '/booking/[providerId]', params: { providerId: businessId, serviceId: service.id } }} className="mt-2 rounded-control bg-brand px-5 py-4 text-center font-semibold text-white">Choose a time</Link></View>) : <Text className="text-body">This business has no bookable services yet.</Text>}
  </ScrollView>;
}
