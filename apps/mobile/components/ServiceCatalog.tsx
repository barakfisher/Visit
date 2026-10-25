import { Control as Pressable } from './Control';
import { useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseServicePrice, SERVICE_CURRENCIES, validateService, type ServiceInput } from '@visit/contracts';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { apiRequest, ApiError } from '@/src/lib/api';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { formatPrice, type MessageKey } from '@/src/i18n/messages';

type Service = { id: string; name: string; description: string | null; durationMinutes: number; priceMinor: number | null; currency: string | null; active: boolean };
const validationMessages: Record<string, MessageKey> = { name: 'catalog.error.name', description: 'catalog.error.description', duration: 'catalog.error.duration', price: 'catalog.error.price', currency: 'catalog.error.currency', pair: 'catalog.error.pair' };
const empty = () => ({ name: '', description: '', duration: '30', price: '', currency: 'ILS' });
const field = 'rounded-control border border-line bg-surface px-4 py-3 text-ink';
export function ServiceCatalog({ businessId }: { businessId: string }) {
  const { t, locale, direction } = useAppLocale();
  const client = useQueryClient();
  const base = `/v1/provider/businesses/${encodeURIComponent(businessId)}`;
  const services = useQuery({ queryKey: ['provider', businessId, 'services'], queryFn: () => apiRequest<{ services: Service[] }>(`${base}/services`) });
  const staff = useQuery({ queryKey: ['provider', businessId, 'staff'], queryFn: () => apiRequest<{ staff: { id: string; displayName: string; active: boolean }[] }>(`${base}/staff`) });
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const priceMinor = parseServicePrice(draft.price);
  const input: ServiceInput = { name: draft.name, description: draft.description.trim() || null, durationMinutes: /^\d+$/.test(draft.duration.trim()) ? Number(draft.duration) : NaN, priceMinor: priceMinor === undefined ? NaN : priceMinor, currency: draft.price.trim() ? draft.currency : null };
  const mutation = useMutation({
    mutationFn: async (action: { kind: 'save' } | { kind: 'active'; service: Service } | { kind: 'delete'; id: string }) => {
      if (action.kind === 'delete') return apiRequest<{ deleted: boolean; archived: boolean }>(`${base}/services/${encodeURIComponent(action.id)}`, { method: 'DELETE' });
      if (action.kind === 'active') return apiRequest(`${base}/services/${encodeURIComponent(action.service.id)}`, { method: 'PATCH', body: JSON.stringify({ active: !action.service.active }), headers: { 'Content-Type': 'application/json' } });
      const validation = validateService(input);
      if (Object.keys(validation).length) { setErrors(validation); throw new Error('validation'); }
      const url = editing ? `${base}/services/${encodeURIComponent(editing)}` : selectedStaff.length ? `/api/provider/services?businessId=${encodeURIComponent(businessId)}` : `${base}/services`;
      return apiRequest(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, ...(!editing && selectedStaff.length ? { staffIds: selectedStaff } : {}) }) });
    },
    onSuccess: async (result, action) => {
      if (action.kind === 'save' || (action.kind === 'delete' && editing === action.id)) { setDraft(empty()); setEditing(null); setSelectedStaff([]); }
      setDeleting(null); setErrors({});
      setMessage(t(action.kind === 'delete' ? (result as { archived?: boolean }).archived ? 'catalog.keptHistory' : 'catalog.removed' : 'catalog.saved'));
      // Catalog, discovery, provider detail, slots and agendas all depend on services.
      await client.invalidateQueries({ predicate: query => ['provider', 'providers', 'public', 'availability', 'slots', 'provider-detail'].includes(String(query.queryKey[0])) });
    },
    onError: error => {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      if (!(error instanceof Error && error.message === 'validation')) setMessage(t('catalog.failed'));
    },
  });
  function update(key: keyof typeof draft, value: string) { setDraft(current => ({ ...current, [key]: value })); setErrors({}); setMessage(''); }
  function edit(service: Service) {
    setEditing(service.id); setDraft({ name: service.name, description: service.description ?? '', duration: String(service.durationMinutes), price: service.priceMinor === null ? '' : (service.priceMinor / 100).toFixed(2), currency: service.currency ?? 'ILS' }); setErrors({}); setMessage(''); setDeleting(null);
  }
  const busy = mutation.isPending;
  const errorText = (key: string) => errors[key] ? <AppText accessibilityRole="alert" className="text-danger">{t(validationMessages[errors[key]!] ?? 'catalog.failed')}</AppText> : null;
  return <View className="gap-4" style={{ direction }}>
    <AppText accessibilityRole="header" className="text-xl font-semibold text-ink">{t('catalog.title')}</AppText>
    {services.isLoading ? <ActivityIndicator accessibilityLabel={t('common.loading')}/> : services.isError ? <><AppText accessibilityRole="alert">{t('catalog.failed')}</AppText><ActionButton secondary label={t('common.retry')} onPress={() => void services.refetch()}/></> : !services.data?.services.length ? <AppText>{t('catalog.empty')}</AppText> : services.data.services.map(service => <View key={service.id} testID={`service-card-${service.id}`} className="gap-3 rounded-control border border-line bg-surface p-4">
      <AppText className="text-lg font-semibold text-ink">{service.name}</AppText>
      {service.description ? <AppText>{service.description}</AppText> : null}
      <AppText>{t('catalog.minutes', { minutes: service.durationMinutes })} · {service.priceMinor !== null && service.currency ? formatPrice(locale, service.priceMinor, service.currency) : t('catalog.unknownPrice')} · {t(service.active ? 'catalog.active' : 'catalog.archived')}</AppText>
      <View className="flex-row flex-wrap gap-2"><ActionButton secondary disabled={busy} label={t('catalog.edit')} onPress={() => edit(service)}/><ActionButton secondary disabled={busy} label={t(service.active ? 'catalog.archive' : 'catalog.restore')} onPress={() => mutation.mutate({ kind: 'active', service })}/><ActionButton secondary disabled={busy} label={t('catalog.delete')} onPress={() => { setDeleting(service.id); setMessage(''); }}/></View>
      {deleting === service.id ? <View className="gap-3"><AppText>{t('catalog.deleteHelp')}</AppText><ActionButton busy={busy} label={t('catalog.confirmDelete')} onPress={() => mutation.mutate({ kind: 'delete', id: service.id })}/><ActionButton secondary disabled={busy} label={t('catalog.back')} onPress={() => setDeleting(null)}/></View> : null}
    </View>)}
    <View testID="service-form" className="gap-3 rounded-card border border-line bg-surface p-5">
      <AppText className="font-semibold text-ink">{t(editing ? 'catalog.edit' : 'catalog.add')}</AppText>
      <AppText>{t('catalog.name')}</AppText><TextInput accessibilityLabel={t('catalog.name')} value={draft.name} onChangeText={value => update('name', value)} editable={!busy} maxLength={120} className={field} style={{ textAlign: direction === 'rtl' ? 'right' : 'left' }}/>{errorText('name')}
      <AppText>{t('catalog.description')}</AppText><TextInput accessibilityLabel={t('catalog.description')} value={draft.description} onChangeText={value => update('description', value)} editable={!busy} multiline maxLength={2000} className={field} style={{ textAlign: direction === 'rtl' ? 'right' : 'left' }}/>{errorText('description')}
      <AppText>{t('catalog.duration')}</AppText><TextInput accessibilityLabel={t('catalog.duration')} value={draft.duration} onChangeText={value => update('duration', value)} editable={!busy} keyboardType="number-pad" className={field} style={{ writingDirection: 'ltr', textAlign: 'left' }}/>{errorText('durationMinutes')}
      <AppText>{t('catalog.price')}</AppText><TextInput accessibilityLabel={t('catalog.price')} value={draft.price} onChangeText={value => update('price', value)} editable={!busy} keyboardType="decimal-pad" placeholder={t('catalog.unknownPrice')} className={field} style={{ writingDirection: 'ltr', textAlign: 'left' }}/>{errorText('priceMinor')}
      <AppText>{t('catalog.currency')}</AppText><View className="flex-row flex-wrap gap-2">{SERVICE_CURRENCIES.map(currency => <Pressable key={currency} accessibilityRole="button" aria-pressed={currency === draft.currency} accessibilityState={{ selected: currency === draft.currency, disabled: busy }} disabled={busy} onPress={() => update('currency', currency)} className={`rounded-control border px-4 py-3 ${currency === draft.currency ? 'border-brand bg-brand-soft' : 'border-line'}`}><AppText>{currency}</AppText></Pressable>)}</View>{errorText('currency')}
      {!editing ? <><AppText>{t('catalog.staff')}</AppText>{staff.isLoading ? <ActivityIndicator/> : staff.isError ? <ActionButton secondary label={t('common.retry')} onPress={() => void staff.refetch()}/> : <View className="flex-row flex-wrap gap-2">{staff.data?.staff.filter(item => item.active).map(item => <Pressable key={item.id} disabled={busy} accessibilityRole="checkbox" aria-checked={selectedStaff.includes(item.id)} accessibilityLabel={item.displayName} accessibilityState={{ checked: selectedStaff.includes(item.id), disabled: busy }} onPress={() => setSelectedStaff(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])} className="rounded-control border border-line px-3 py-3"><AppText>{item.displayName}{selectedStaff.includes(item.id) ? ' ✓' : ''}</AppText></Pressable>)}</View>}<AppText className="text-sm text-muted">{t('catalog.staffHint')}</AppText></> : null}
      {errorText('form')}<ActionButton label={t(editing ? 'catalog.save' : 'catalog.add')} busy={busy} disabled={!draft.name.trim()} onPress={() => { setMessage(''); mutation.mutate({ kind: 'save' }); }}/>
      {editing ? <ActionButton secondary disabled={busy} label={t('catalog.cancel')} onPress={() => { setEditing(null); setDraft(empty()); setErrors({}); setMessage(''); }}/>: null}
    </View>
    {message ? <AppText accessibilityRole="alert">{message}</AppText> : null}
  </View>;
}
