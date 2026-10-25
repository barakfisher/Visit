import { PublicationPanel } from '@/components/PublicationPanel';
import { PILOT_TIMEZONE } from '@visit/contracts';
import { appointmentTime, timePolicyNote } from '@/src/lib/appointmentTime';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { ServiceCatalog } from '@/components/ServiceCatalog';
import { useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { apiRequest } from '@/src/lib/api';
import { useAuthStore } from '@/src/state/auth';
import { todayInTimezone } from '@/src/lib/calendar';
import { formatMoney } from '@/src/types/flows';

type Agenda = {
  business: { id: string; name: string; timezone: string };
  summary: { appointments: number; revenue: Record<string, number> };
  staff: { id: string; displayName: string }[];
  bookings: { id: string; startsAt: string; endsAt: string; customer: { phone: string | null; email: string | null }; service: { name: string }; staff: { displayName: string } }[];
  blocks: { id: string; startsAt: string; endsAt: string; reason: string | null; staff: { displayName: string } }[];
};
const field = 'rounded-control border border-line bg-surface px-4 py-3 text-ink';
export default function ProviderDashboard() {
  const profile = useAuthStore((state) => state.profile);
  const activeBusinessId = useAuthStore((state) => state.activeBusinessId);
  const { businessId } = useLocalSearchParams<{ businessId?: string }>();
  return <ProviderWorkspace key={`${profile?.id}:${activeBusinessId || businessId || profile?.businesses[0]?.id}`} />;
}

function ProviderWorkspace() {
  const { locale } = useAppLocale();
  const { businessId: requestedBusinessId } = useLocalSearchParams<{ businessId?: string }>();
  const profile = useAuthStore((state) => state.profile);
  const activeBusinessId = useAuthStore((state) => state.activeBusinessId);
  const selectBusiness = useAuthStore((state) => state.selectBusiness);
  const business = profile?.businesses.find((item) => item.id === (activeBusinessId || requestedBusinessId)) ?? profile?.businesses[0];
  const [tab, setTab] = useState('Agenda View');
  const [date, setDate] = useState('');
  const [blockOpen, setBlockOpen] = useState(false);
  const [staffId, setStaffId] = useState('');
  const [from, setFrom] = useState('12:00');
  const [to, setTo] = useState('13:00');
  const [reason, setReason] = useState('Break');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const day = date || todayInTimezone(business?.timezone ?? PILOT_TIMEZONE);
  const agenda = useQuery({ queryKey: ['provider', business?.id, 'agenda', day], queryFn: () => apiRequest<Agenda>(`/api/provider/agenda?${new URLSearchParams({ businessId: business!.id, date: day })}`), enabled: Boolean(business), refetchInterval: 10000 });
  async function block() {
    if (!business) return;
    setBusy(true); setFeedback('');
    try { await apiRequest('/api/provider/block-time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: business.id, staffId: staffId || agenda.data?.staff[0]?.id, date: day, startLocal: from, endLocal: to, reason }) }); setBlockOpen(false); await client.invalidateQueries({ queryKey: ['provider', business.id, 'agenda'] }); }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not block this time.'); }
    finally { setBusy(false); }
  }
  async function removeBlock(id: string) {
    try { await apiRequest(`/api/provider/block-time/${id}?businessId=${business!.id}`, { method: 'DELETE' }); await agenda.refetch(); }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not remove break.'); }
  }
  const time = (instant: string) => appointmentTime(instant, business?.timezone ?? PILOT_TIMEZONE, locale);
  if (!business) return <View className="flex-1 gap-4 bg-canvas p-6"><Text accessibilityRole="header" className="text-2xl font-bold text-ink">Provider dashboard</Text><Text className="text-body">An approved provider account is required to manage a business.</Text><Link href={profile ? '/account' : '/auth/login'} className="font-semibold text-brand">{profile ? 'View account and approval status' : 'Sign in'}</Link></View>;
  return <ScrollView contentContainerClassName="mx-auto w-full max-w-3xl gap-5 px-5 py-6 pb-10" className="flex-1 bg-canvas">
    <View className="gap-2"><Text className="text-xs font-semibold uppercase tracking-widest text-brand">Provider workspace</Text><Text accessibilityRole="header" className="text-3xl font-bold text-ink">{business.name}</Text></View>
    {profile!.businesses.length > 1 ? <View className="flex-row flex-wrap gap-2">{profile!.businesses.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.id === business.id }} onPress={() => { selectBusiness(item.id); setStaffId(''); setFeedback(''); }} className={`rounded-control border px-4 py-3 ${item.id === business.id ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}><Text className="font-semibold text-brand">{item.name}</Text></Pressable>)}</View> : null}
    <PublicationPanel key={business.id} businessId={business.id} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">{['Agenda View', 'Service Catalog', 'Working Hours'].map((name) => <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: tab === name }} onPress={() => setTab(name)} className={`rounded-control px-4 py-3 ${tab === name ? 'bg-brand' : 'bg-surface'}`}><Text className={`font-semibold ${tab === name ? 'text-white' : 'text-body'}`}>{name}</Text></Pressable>)}</ScrollView>
    {tab === 'Agenda View' ? <>
      <TextInput accessibilityLabel="Agenda date" placeholder="YYYY-MM-DD" value={day} onChangeText={setDate} className={field}/><Text className="text-sm text-muted">{timePolicyNote(business.timezone, locale)}</Text>
      <View className="flex-row flex-wrap gap-3"><View className="min-w-40 flex-1 gap-2 rounded-card bg-brand p-5"><Text className="text-sm text-teal-50">Appointments</Text><Text className="text-3xl font-bold text-white">{agenda.data?.summary.appointments ?? '—'}</Text></View><View className="min-w-40 flex-1 gap-2 rounded-card border border-line bg-surface p-5"><Text className="text-sm text-muted">Expected revenue</Text><Text className="text-xl font-bold text-ink">{agenda.data ? Object.entries(agenda.data.summary.revenue).map(([currency, amount]) => formatMoney(amount, currency)).join(' · ') || '—' : '—'}</Text></View></View>
      <ActionButton secondary label={blockOpen ? 'Close break form' : 'Block time / add a break'} onPress={() => setBlockOpen(!blockOpen)}/>
      {blockOpen ? <View className="gap-3 rounded-card border border-line bg-surface p-5"><Text className="font-semibold text-ink">Block time on {day}</Text><View className="flex-row flex-wrap gap-2">{agenda.data?.staff.map((staff) => <Pressable key={staff.id} accessibilityRole="button" accessibilityState={{ selected: staff.id === (staffId || agenda.data?.staff[0]?.id) }} onPress={() => setStaffId(staff.id)} className="rounded-control border border-line px-3 py-2"><Text className="text-brand">{staff.displayName}{staff.id === (staffId || agenda.data?.staff[0]?.id) ? ' ✓' : ''}</Text></Pressable>)}</View><TextInput accessibilityLabel="Break start time" value={from} onChangeText={setFrom} placeholder="HH:mm" className={field}/><TextInput accessibilityLabel="Break end time" value={to} onChangeText={setTo} placeholder="HH:mm" className={field}/><TextInput accessibilityLabel="Break reason" value={reason} onChangeText={setReason} className={field}/><ActionButton label="Save blocked time" busy={busy} disabled={!agenda.data?.staff.length} onPress={() => void block()}/></View> : null}
      {feedback ? <Text accessibilityRole="alert" className="text-danger">{feedback}</Text> : null}
      {agenda.isError ? <Text accessibilityRole="alert" className="text-danger">{agenda.error.message}</Text> : agenda.isLoading ? <Text className="text-body">Loading agenda…</Text> : <>
        <Text className="text-xl font-semibold text-ink">Daily agenda</Text>{!agenda.data?.bookings.length ? <Text className="text-body">No appointments for this day.</Text> : agenda.data.bookings.map((booking) => <View key={booking.id} className="gap-3 rounded-card border border-line bg-surface p-5"><Text className="font-bold text-brand">{time(booking.startsAt)} – {time(booking.endsAt)}</Text><Text className="text-lg font-semibold text-ink">{booking.service.name}</Text><Text className="text-sm text-body">{booking.staff.displayName} · {booking.customer.phone ?? booking.customer.email ?? 'Customer'}</Text><View className="flex-row gap-2"><View className="flex-1"><ActionButton secondary label={booking.customer.phone ? 'Call' : 'Call (no phone number)'} disabled={!booking.customer.phone} onPress={() => void Linking.openURL(`tel:${booking.customer.phone}`).catch(() => setFeedback('Could not open the phone app.'))}/></View><View className="flex-1"><ActionButton secondary label={booking.customer.phone ? 'WhatsApp' : 'WhatsApp (no phone number)'} disabled={!booking.customer.phone} onPress={() => void Linking.openURL(`https://wa.me/${booking.customer.phone!.replace(/\D/g, '')}`).catch(() => setFeedback('Could not open WhatsApp.'))}/></View></View></View>)}
        {agenda.data?.blocks.map((item) => <View key={item.id} className="gap-2 rounded-control border border-line bg-slate-100 p-4"><Text className="font-semibold text-body">{time(item.startsAt)} – {time(item.endsAt)} · {item.reason || 'Blocked time'}</Text><Text className="text-sm text-muted">{item.staff.displayName}</Text><ActionButton secondary label="Remove blocked time" onPress={() => void removeBlock(item.id)}/></View>)}
      </>}
    </> : tab === 'Service Catalog' ? <ServiceCatalog key={business.id} businessId={business.id}/> : <WorkingHours key={business.id} businessId={business.id}/>}
    <Link href={{ pathname: '/provider/[businessId]', params: { businessId: business.id } }} className="text-center font-semibold text-brand">Advanced business settings</Link>
  </ScrollView>;
}
type Rules = { weekly: { weekday: number; startLocal: string; endLocal: string }[]; overrides: { date: string; isOpen: boolean; startLocal: string | null; endLocal: string | null }[] };
function WorkingHours({ businessId }: { businessId: string }) {
  const rules = useQuery({ queryKey: ['provider', businessId, 'working-hours'], queryFn: () => apiRequest<Rules>(`/api/provider/working-hours?businessId=${businessId}`) });
  return rules.data ? <HoursEditor key={`${businessId}:${rules.dataUpdatedAt}`} initial={rules.data} businessId={businessId} onSave={() => void rules.refetch()}/> : <Text className="text-body">{rules.isError ? rules.error.message : 'Loading working hours…'}</Text>;
}
function HoursEditor({ initial, businessId, onSave }: { initial: Rules; businessId: string; onSave: () => void }) {
  const [hours, setHours] = useState(() => Array.from({ length: 7 }, (_, weekday) => initial.weekly.filter((item) => item.weekday === weekday)));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function save() {
    setBusy(true); setMessage('');
    try { await apiRequest(`/api/provider/working-hours?businessId=${businessId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekly: hours.map((intervals, weekday) => ({ weekday, intervals: intervals.map(({ startLocal, endLocal }) => ({ startLocal, endLocal })) })), overrides: initial.overrides.map((item) => ({ date: item.date.slice(0, 10), isOpen: item.isOpen, ...(item.isOpen ? { startLocal: item.startLocal, endLocal: item.endLocal } : {}) })) }) }); setMessage('Working hours saved.'); onSave(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save hours.'); } finally { setBusy(false); }
  }
  function update(day: number, intervals: Rules['weekly']) { setHours((current) => current.map((value, index) => index === day ? intervals : value)); }
  return <View className="gap-4"><Text className="text-xl font-semibold text-ink">Working Hours</Text><Text className="text-sm text-body">Closed days are greyed out in the booking calendar. Times use your business timezone.</Text>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((name, day) => <View key={name} className="gap-3 rounded-control border border-line bg-surface p-4"><Text className="font-semibold text-ink">{name}{hours[day]!.length ? '' : ' (closed)'}</Text>{hours[day]!.map((interval, index) => <View key={index} className="flex-row items-center gap-2"><TextInput accessibilityLabel={`${name} opening time ${index + 1}`} value={interval.startLocal} onChangeText={(value) => update(day, hours[day]!.map((row, i) => i === index ? { ...row, startLocal: value } : row))} className={`flex-1 ${field}`}/><Text className="text-body">to</Text><TextInput accessibilityLabel={`${name} closing time ${index + 1}`} value={interval.endLocal} onChangeText={(value) => update(day, hours[day]!.map((row, i) => i === index ? { ...row, endLocal: value } : row))} className={`flex-1 ${field}`}/><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name} interval ${index + 1}`} onPress={() => update(day, hours[day]!.filter((_, i) => i !== index))}><Text className="text-danger">Remove</Text></Pressable></View>)}<ActionButton secondary label={`Add ${name} hours`} onPress={() => update(day, [...hours[day]!, { weekday: day, startLocal: '09:00', endLocal: '17:00' }])}/></View>)}<ActionButton label="Save working hours" onPress={() => void save()} busy={busy}/>{message ? <Text accessibilityRole="alert" className="text-body">{message}</Text> : null}</View>;
}
