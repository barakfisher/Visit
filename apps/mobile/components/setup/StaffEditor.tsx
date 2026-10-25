import { useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../AppText';
import { ActionButton } from '../ActionButton';
import { TextField } from '../TextField';
import { Control } from '../Control';
import { AvailabilityEditor } from './AvailabilityEditor';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest } from '@/src/lib/api';
type Service = { id: string; name: string; active: boolean };
type Staff = { id: string; displayName: string; active: boolean; parallelCapacity: number; services: { serviceId: string }[] };
export function StaffEditor({ businessId }: { businessId: string }) {
  const { t } = useAppLocale();
  const [editing, setEditing] = useState<string | null>(null), [hours, setHours] = useState<string | null>(null);
  const base = `/v1/provider/businesses/${businessId}`;
  const query = useQuery({ queryKey: ['provider', businessId, 'setup-staff'], queryFn: () => apiRequest<{ staff: Staff[] }>(`${base}/staff`) });
  const catalog = useQuery({ queryKey: ['provider', businessId, 'services'], queryFn: () => apiRequest<{ services: Service[] }>(`${base}/services`) });
  const services = catalog.data?.services.filter(s => s.active) ?? [];
  if (query.isError || catalog.isError) return <View className="gap-3"><AppText accessibilityRole="alert">{t('setup.failure')}</AppText><ActionButton secondary label={t('common.retry')} onPress={() => { void query.refetch(); void catalog.refetch(); }} /></View>;
  if (!query.data || !catalog.data) return <AppText>{t('common.loading')}</AppText>;
  return <View className="gap-4"><AppText>{t('setup.staffHint')}</AppText><AppText>{t('setup.archiveNote')}</AppText>
    {!query.data.staff.length ? <AppText>{t('setup.noStaff')}</AppText> : null}
    {query.data.staff.map(staff => <View key={staff.id} testID={`setup-staff-${staff.id}`} className="gap-3 rounded-card border border-line p-4"><AppText accessibilityRole="header" className="font-semibold">{staff.displayName}{staff.active ? '' : ` · ${t('setup.inactive')}`}</AppText><AppText>{t('setup.capacity')}: {staff.parallelCapacity}</AppText><ActionButton secondary label={t('setup.editStaff', { name: staff.displayName })} onPress={() => setEditing(editing === staff.id ? null : staff.id)} />{editing === staff.id ? <StaffForm key={staff.id} businessId={businessId} initial={staff} services={services} /> : null}<ActionButton secondary label={t(hours === staff.id ? 'setup.closeStaffHours' : 'setup.staffHours', { name: staff.displayName })} onPress={() => setHours(hours === staff.id ? null : staff.id)} />{hours === staff.id ? <AvailabilityEditor businessId={businessId} staffId={staff.id} /> : null}</View>)}
    {services.length ? <StaffForm businessId={businessId} services={services} /> : <AppText>{t('setup.noServices')}</AppText>}
  </View>;
}
function StaffForm({ businessId, services, initial }: { businessId: string; services: Service[]; initial?: Staff }) {
  const { t } = useAppLocale(), client = useQueryClient();
  const running = useRef(false), creationKey = useRef<string | null>(null);
  const [name, setName] = useState(initial?.displayName ?? ''), [capacity, setCapacity] = useState(String(initial?.parallelCapacity ?? 1));
  const [active, setActive] = useState(initial?.active ?? true), [selected, setSelected] = useState<string[]>(initial?.services.filter(s => services.some(active => active.id === s.serviceId)).map(s => s.serviceId) ?? []);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<'saved' | 'error' | 'capacity' | ''>('');
  async function save() {
    if (running.current) return;
    if (!/^\d+$/.test(capacity) || Number(capacity) < 1 || Number(capacity) > 100) { setFeedback('capacity'); return; }
    running.current = true; setBusy(true); setFeedback('');
    try {
      creationKey.current ??= randomUUID();
      await apiRequest(`/v1/provider/businesses/${businessId}/staff${initial ? `/${initial.id}` : ''}`, { method: initial ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: name.trim(), serviceIds: selected.filter(id => services.some(s => s.id === id)), parallelCapacity: Number(capacity), ...(initial ? { active } : { creationKey: creationKey.current }) }) });
      if (!initial) { setName(''); setSelected([]); setCapacity('1'); creationKey.current = null; }
      setFeedback('saved'); await client.invalidateQueries({ queryKey: ['provider', businessId] });
    } catch { setFeedback('error'); } finally { running.current = false; setBusy(false); }
  }
  return <View className="gap-3 rounded-control bg-canvas p-4">
    <TextField label={t('setup.staffName')} value={name} maxLength={120} onChangeText={setName} />
    <TextField label={t('setup.capacity')} identifier keyboardType="number-pad" value={capacity} onChangeText={setCapacity} />
    {initial ? <Control accessibilityRole="checkbox" accessibilityState={{ checked: active }} onPress={() => setActive(v => !v)} className="justify-center rounded-control border border-line p-3"><AppText>{active ? '✓ ' : ''}{t('setup.active')}</AppText></Control> : null}
    <AppText className="font-semibold">{t('setup.assignment')}</AppText>{services.map(service => <Control key={service.id} accessibilityRole="checkbox" accessibilityLabel={t('setup.selectService', { name: service.name })} accessibilityState={{ checked: selected.includes(service.id) }} onPress={() => setSelected(v => v.includes(service.id) ? v.filter(id => id !== service.id) : [...v, service.id])} className="justify-center rounded-control border border-line p-3"><AppText>{selected.includes(service.id) ? '✓ ' : ''}{service.name}</AppText></Control>)}
    <ActionButton label={t(initial ? 'setup.saveStaff' : 'setup.addStaff')} busy={busy} disabled={name.trim().length < 2 || (!initial && !selected.length)} onPress={() => void save()} />
    {feedback ? <AppText accessibilityRole={feedback === 'saved' ? 'status' : 'alert'}>{t(feedback === 'saved' ? 'setup.saved' : feedback === 'capacity' ? 'setup.staffLimit' : 'setup.saveFailure')}</AppText> : null}
  </View>;
}
