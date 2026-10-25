import { useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../AppText';
import { TextField } from '../TextField';
import { ActionButton } from '../ActionButton';
import { Control } from '../Control';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest } from '@/src/lib/api';
type Interval = { startLocal: string; endLocal: string };
type Exception = { date: string; isOpen: boolean; startLocal: string | null; endLocal: string | null };
type Rules = { weekly: (Interval & { weekday: number })[]; overrides: Exception[] };
export function AvailabilityEditor({ businessId, staffId }: { businessId: string; staffId?: string }) {
  const { t } = useAppLocale();
  const [revision, setRevision] = useState(0);
  const base = `/v1/provider/businesses/${businessId}${staffId ? `/staff/${staffId}` : ''}/availability-rules`;
  const query = useQuery({ queryKey: ['provider', businessId, staffId ?? 'business', 'setup-hours'], queryFn: () => apiRequest<Rules>(base) });
  return query.data ? <View className="gap-4"><ScheduleForm key={`${businessId}:${staffId}:${revision}`} initial={query.data} base={base} businessId={businessId} staff={!!staffId} /><ActionButton secondary label={t('setup.reload')} onPress={() => void query.refetch().then(result => { if (result.isSuccess) setRevision(n => n + 1); })} /></View> : <View className="gap-3"><AppText accessibilityRole={query.isError ? 'alert' : undefined}>{t(query.isError ? 'setup.failure' : 'common.loading')}</AppText>{query.isError ? <ActionButton secondary label={t('common.retry')} onPress={() => void query.refetch()} /> : null}</View>;
}
function ScheduleForm({ initial, base, businessId, staff }: { initial: Rules; base: string; businessId: string; staff: boolean }) {
  const { t, locale } = useAppLocale(), client = useQueryClient();
  const [weekly, setWeekly] = useState<Interval[][]>(() => Array.from({ length: 7 }, (_, day) => initial.weekly.filter(h => h.weekday === day).map(({ startLocal, endLocal }) => ({ startLocal, endLocal }))));
  const [overrides, setOverrides] = useState<Exception[]>(() => initial.overrides.map(e => ({ ...e, date: e.date.slice(0, 10) })));
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<'saved' | 'error' | ''>('');
  function interval(day: number, index: number, patch?: Partial<Interval>) { setWeekly(w => w.map((h, d) => d !== day ? h : patch ? h.map((v, i) => i === index ? { ...v, ...patch } : v) : h.filter((_, i) => i !== index))); }
  function exception(index: number, patch: Partial<Exception>) { setOverrides(rows => rows.map((v, i) => i === index ? { ...v, ...patch } : v)); }
  async function save() {
    if (busy) return; setBusy(true); setFeedback('');
    try {
      await apiRequest(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekly: weekly.map((intervals, weekday) => ({ weekday, intervals })), overrides: overrides.map(v => ({ date: v.date, isOpen: v.isOpen, ...(v.isOpen ? { startLocal: v.startLocal, endLocal: v.endLocal } : {}) })) }) });
      setFeedback('saved'); await client.invalidateQueries({ queryKey: ['provider', businessId] });
    } catch { setFeedback('error'); } finally { setBusy(false); }
  }
  return <View className="gap-4">
    <AppText accessibilityRole="header" className="text-lg font-semibold">{t('setup.weekly')}</AppText><AppText>{t(staff ? 'setup.inheritHint' : 'setup.hoursHint')}</AppText>
    {staff ? <ActionButton secondary label={t('setup.inherit')} onPress={() => setWeekly(Array.from({ length: 7 }, () => []))} /> : null}
    {weekly.map((hours, day) => {
      const label = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + day)));
      return <View key={day} className="gap-3 rounded-control border border-line p-4"><AppText className="font-semibold">{label}</AppText>
        {hours.map((h, index) => <View key={index} className="gap-3"><TextField label={t('setup.opening', { day: label, index: index + 1 })} identifier value={h.startLocal} onChangeText={startLocal => interval(day, index, { startLocal })} /><TextField label={t('setup.closing', { day: label, index: index + 1 })} identifier value={h.endLocal} onChangeText={endLocal => interval(day, index, { endLocal })} /><ActionButton secondary label={t('setup.removeHours', { day: label, index: index + 1 })} onPress={() => interval(day, index)} /></View>)}
        <ActionButton secondary label={t('setup.addHours', { day: label })} onPress={() => setWeekly(w => w.map((v, d) => d === day ? [...v, { startLocal: '09:00', endLocal: '17:00' }] : v))} />
      </View>;
    })}
    <AppText accessibilityRole="header" className="text-lg font-semibold">{t('setup.exceptions')}</AppText>
    {overrides.map((e, index) => <View key={index} className="gap-3 rounded-control border border-line p-4">
      <TextField label={t('setup.exceptionDate', { index: index + 1 })} identifier value={e.date} onChangeText={date => exception(index, { date })} />
      <Control accessibilityRole="checkbox" accessibilityState={{ checked: e.isOpen }} onPress={() => exception(index, { isOpen: !e.isOpen })} className="justify-center rounded-control border border-line p-3"><AppText>{e.isOpen ? '✓ ' : ''}{t('setup.exceptionOpen', { index: index + 1 })}</AppText></Control>
      {e.isOpen ? <><TextField identifier label={t('setup.exceptionStart', { index: index + 1 })} value={e.startLocal ?? ''} onChangeText={startLocal => exception(index, { startLocal })} /><TextField identifier label={t('setup.exceptionEnd', { index: index + 1 })} value={e.endLocal ?? ''} onChangeText={endLocal => exception(index, { endLocal })} /></> : null}
      <ActionButton secondary label={t('setup.removeException', { index: index + 1 })} onPress={() => setOverrides(rows => rows.filter((_, i) => i !== index))} />
    </View>)}
    <ActionButton secondary label={t('setup.addException')} onPress={() => setOverrides(v => [...v, { date: '', isOpen: false, startLocal: '09:00', endLocal: '17:00' }])} />
    <ActionButton label={t('setup.saveHours')} busy={busy} onPress={() => void save()} />
    {feedback ? <AppText accessibilityRole={feedback === 'error' ? 'alert' : 'status'}>{t(feedback === 'error' ? 'setup.saveFailure' : 'setup.saved')}</AppText> : null}
  </View>;
}
