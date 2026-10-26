import { AppointmentAudit } from '@/components/AppointmentAudit.component';
import type { AppointmentStatus } from '@/src/types/AppointmentLifecycle.types';
import { AvailabilityEditor } from '@/components/setup/AvailabilityEditor';
import { AppText as Text } from '@/components/AppText';
import { PublicationPanel } from '@/components/PublicationPanel';
import { PILOT_TIMEZONE } from '@visit/contracts';
import { appointmentTime, timePolicyNote } from '@/src/lib/appointmentTime';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { ServiceCatalog } from '@/components/ServiceCatalog';
import { useProviderWorkspace } from '@/components/ProviderAccess';
import { useState } from 'react';
import { Link, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { apiRequest } from '@/src/lib/api';
import { useAuthStore } from '@/src/state/auth';
import { todayInTimezone } from '@/src/lib/calendar';
import { formatMoney } from '@/src/types/flows';

type Agenda = {
  business: { id: string; name: string; timezone: string };
  summary: { appointments: number; revenue: Record<string, number> };
  staff: { id: string; displayName: string }[];
  bookings: { id: string; status: AppointmentStatus; revision: number; startsAt: string; endsAt: string; customer: { phone: string | null; email: string | null }; service: { name: string }; staff: { displayName: string } }[];
  blocks: { id: string; startsAt: string; endsAt: string; reason: string | null; staff: { displayName: string } }[];
};
const field = 'rounded-control border border-line bg-surface px-4 py-3 text-ink';
export default function ProviderDashboard() { return <ProviderWorkspace />; }

function ProviderWorkspace() {
  const { locale, t } = useAppLocale();
  const profile = useAuthStore((state) => state.profile);
  const selectBusiness = useAuthStore((state) => state.selectBusiness);
  const business = useProviderWorkspace();
  const [tab, setTab] = useState('Agenda View');
  const [date, setDate] = useState('');
  const [blockOpen, setBlockOpen] = useState(false);
  const [staffId, setStaffId] = useState('');
  const [from, setFrom] = useState('12:00');
  const [to, setTo] = useState('13:00');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const day = date || todayInTimezone(business?.timezone ?? PILOT_TIMEZONE);
  const agenda = useQuery({ queryKey: ['provider', business?.id, 'agenda', day], queryFn: () => apiRequest<Agenda>(`/api/provider/agenda?${new URLSearchParams({ businessId: business!.id, date: day })}`), enabled: Boolean(business), refetchInterval: 10000 });
  async function block() {
    if (!business) return;
    setBusy(true); setFeedback('');
    try { await apiRequest('/api/provider/block-time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: business.id, staffId: staffId || agenda.data?.staff[0]?.id, date: day, startLocal: from, endLocal: to, reason }) }); setBlockOpen(false); await client.invalidateQueries({ queryKey: ['provider', business.id, 'agenda'] }); }
    catch { setFeedback(t('dashboard.blockFailure')); }
    finally { setBusy(false); }
  }
  async function removeBlock(id: string) {
    try { await apiRequest(`/api/provider/block-time/${id}?businessId=${business!.id}`, { method: 'DELETE' }); await agenda.refetch(); }
    catch { setFeedback(t('dashboard.removeFailure')); }
  }
  const time = (instant: string) => appointmentTime(instant, business?.timezone ?? PILOT_TIMEZONE, locale);
  if (!business) return <View className="flex-1 gap-4 bg-canvas p-6"><Text accessibilityRole="header" className="text-2xl font-bold text-ink">{t('dashboard.title')}</Text><Text className="text-body">{t('dashboard.denied')}</Text><Link href={profile ? '/account' : '/auth/login'} className="font-semibold text-brand">{profile ? t('dashboard.account') : t('common.signIn')}</Link></View>;
  return <ScrollView contentContainerClassName="mx-auto w-full max-w-3xl gap-5 px-5 py-6 pb-10" className="flex-1 bg-canvas">
    <View className="gap-2"><Text className="text-xs font-semibold uppercase tracking-widest text-brand">{t('dashboard.workspace')}</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">{business.name}</Text></View>
    {profile!.businesses.length > 1 ? <View className="flex-row flex-wrap gap-2">{profile!.businesses.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.id === business.id }} onPress={() => { if (item.id === business.id) return; selectBusiness(item.id); router.replace({ pathname: '/provider/dashboard', params: { businessId: item.id } }); }} className={`rounded-control border px-4 py-3 ${item.id === business.id ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}><Text className="font-semibold text-brand">{item.name}</Text></Pressable>)}</View> : null}
    <PublicationPanel key={business.id} businessId={business.id} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">{['Agenda View', 'Service Catalog', 'Working Hours'].map((name) => <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: tab === name }} onPress={() => setTab(name)} className={`rounded-control px-4 py-3 ${tab === name ? 'bg-brand' : 'bg-surface'}`}><Text className={`font-semibold ${tab === name ? 'text-white' : 'text-body'}`}>{t(name === 'Agenda View' ? 'dashboard.agenda' : name === 'Service Catalog' ? 'dashboard.services' : 'dashboard.hours')}</Text></Pressable>)}</ScrollView>
    {tab === 'Agenda View' ? <>
      <TextInput accessibilityLabel={t('dashboard.date')} placeholder="YYYY-MM-DD" value={day} onChangeText={setDate} className={field}/><Text className="text-sm text-muted">{timePolicyNote(business.timezone, locale)}</Text>
      <View className="flex-row flex-wrap gap-3"><View className="min-w-40 flex-1 gap-2 rounded-card bg-brand p-5"><Text className="text-sm text-teal-50">{t('dashboard.appointments')}</Text><Text className="text-3xl font-bold text-white">{agenda.data?.summary.appointments ?? '—'}</Text></View><View className="min-w-40 flex-1 gap-2 rounded-card border border-line bg-surface p-5"><Text className="text-sm text-muted">{t('dashboard.revenue')}</Text><Text className="text-xl font-bold text-ink">{agenda.data ? Object.entries(agenda.data.summary.revenue).map(([currency, amount]) => formatMoney(amount, currency)).join(' · ') || '—' : '—'}</Text></View></View>
      <ActionButton secondary label={t(blockOpen ? 'dashboard.closeBlock' : 'dashboard.block')} onPress={() => setBlockOpen(!blockOpen)}/>
      {blockOpen ? <View className="gap-3 rounded-card border border-line bg-surface p-5"><Text className="font-semibold text-ink">{t('dashboard.blockOn', { date: day })}</Text><View className="flex-row flex-wrap gap-2">{agenda.data?.staff.map((staff) => <Pressable key={staff.id} accessibilityRole="button" accessibilityState={{ selected: staff.id === (staffId || agenda.data?.staff[0]?.id) }} onPress={() => setStaffId(staff.id)} className="rounded-control border border-line px-3 py-2"><Text className="text-brand">{staff.displayName}{staff.id === (staffId || agenda.data?.staff[0]?.id) ? ' ✓' : ''}</Text></Pressable>)}</View><TextInput accessibilityLabel={t('dashboard.from')} value={from} onChangeText={setFrom} placeholder="HH:mm" className={field}/><TextInput accessibilityLabel={t('dashboard.to')} value={to} onChangeText={setTo} placeholder="HH:mm" className={field}/><TextInput accessibilityLabel={t('dashboard.reason')} value={reason} onChangeText={setReason} className={field}/><ActionButton label={t('dashboard.saveBlock')} busy={busy} disabled={!agenda.data?.staff.length} onPress={() => void block()}/></View> : null}
      {feedback ? <Text accessibilityRole="alert" className="text-danger">{feedback}</Text> : null}
      {agenda.isError ? <Text accessibilityRole="alert" className="text-danger">{agenda.error.message}</Text> : agenda.isLoading ? <Text className="text-body">{t('dashboard.loading')}</Text> : <>
        <Text className="text-xl font-semibold text-ink">{t('dashboard.daily')}</Text>{!agenda.data?.bookings.length ? <Text className="text-body">{t('dashboard.empty')}</Text> : agenda.data.bookings.map((booking) => <View key={booking.id} testID={`agenda-booking-${booking.id}`} className="gap-3 rounded-card border border-line bg-surface p-5"><Text className="font-bold text-brand">{time(booking.startsAt)} – {time(booking.endsAt)}</Text><Text className="text-lg font-semibold text-ink">{booking.service.name}</Text><AppointmentAudit key={`${business.id}:${booking.id}`} booking={booking} timezone={business.timezone} businessId={business.id} /><Text className="text-sm text-body">{booking.staff.displayName} · {booking.customer.phone ?? booking.customer.email ?? t('dashboard.customer')}</Text><View className="flex-row gap-2"><View className="flex-1"><ActionButton secondary label={t(booking.customer.phone ? 'dashboard.call' : 'dashboard.noPhoneCall')} disabled={!booking.customer.phone} onPress={() => void Linking.openURL(`tel:${booking.customer.phone}`).catch(() => setFeedback(t('dashboard.callFailure')))}/></View><View className="flex-1"><ActionButton secondary label={t(booking.customer.phone ? 'dashboard.whatsapp' : 'dashboard.noPhoneWhatsapp')} disabled={!booking.customer.phone} onPress={() => void Linking.openURL(`https://wa.me/${booking.customer.phone!.replace(/\D/g, '')}`).catch(() => setFeedback(t('dashboard.whatsappFailure')))}/></View></View></View>)}
        {agenda.data?.blocks.map((item) => <View key={item.id} className="gap-2 rounded-control border border-line bg-slate-100 p-4"><Text className="font-semibold text-body">{time(item.startsAt)} – {time(item.endsAt)} · {item.reason || t('dashboard.blocked')}</Text><Text className="text-sm text-muted">{item.staff.displayName}</Text><ActionButton secondary label={t('dashboard.removeBlock')} onPress={() => void removeBlock(item.id)}/></View>)}
      </>}
    </> : tab === 'Service Catalog' ? <ServiceCatalog key={business.id} businessId={business.id}/> : <AvailabilityEditor key={business.id} businessId={business.id}/>}
    <Link href={{ pathname: '/provider/[businessId]', params: { businessId: business.id } }} className="text-center font-semibold text-brand">{t('setup.manage')}</Link>
  </ScrollView>;
}
