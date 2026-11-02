import { ActivityIndicator, Switch, View } from 'react-native';
import type { MessageKey } from '@/src/i18n/messages';
import type { ServiceCatalogState } from '@/src/lib/ServiceCatalog.hook';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { Control as Pressable } from './Control';
import { TextField } from './TextField';

const validationMessages: Record<string, MessageKey> = { name: 'catalog.error.name', description: 'catalog.error.description', duration: 'catalog.error.duration', price: 'catalog.error.price', currency: 'catalog.error.currency', pair: 'catalog.error.pair' };
/** The add/edit form shown inside the catalog's dialog. There is no currency field: new prices are ILS. */
export function ServiceForm({ t, draft, editing, errors, formError, busy, staff, selectedStaff, update, toggleStaff, save, cancelForm }: ServiceCatalogState) {
  const errorFor = (key: string) => errors[key] ? t(validationMessages[errors[key]!] ?? 'catalog.failed') : undefined;
  return <View testID="service-form" className="gap-4">
    <TextField label={t('catalog.name')} value={draft.name} onChangeText={value => update('name', value)} editable={!busy} maxLength={120} error={errorFor('name')} />
    <TextField label={t('catalog.description')} value={draft.description} onChangeText={value => update('description', value)} editable={!busy} multiline maxLength={2000} error={errorFor('description')} />
    <TextField label={t('catalog.duration')} identifier value={draft.duration} onChangeText={value => update('duration', value)} editable={!busy} keyboardType="number-pad" error={errorFor('durationMinutes')} />
    <TextField label={t('catalog.price')} identifier value={draft.price} onChangeText={value => update('price', value)} editable={!busy} keyboardType="decimal-pad" placeholder={t('catalog.unknownPrice')} hint={t('catalog.priceHint')} error={errorFor('priceMinor') ?? errorFor('currency')} />
    {editing ? <View className="gap-1">
      <View className="flex-row items-center justify-between gap-3"><AppText className="flex-1 font-medium text-ink">{t('catalog.available')}</AppText><Switch accessibilityLabel={t('catalog.available')} disabled={busy} value={draft.active} onValueChange={value => update('active', value)} /></View>
      <AppText className="text-sm text-body">{t('catalog.availableHint')}</AppText>
    </View> : <View className="gap-2">
      <AppText className="font-medium text-ink">{t('catalog.staff')}</AppText>
      {staff.isLoading ? <ActivityIndicator accessibilityLabel={t('common.loading')} /> : staff.isError ? <ActionButton secondary label={t('common.retry')} onPress={() => void staff.refetch()} /> : <View className="flex-row flex-wrap gap-2">{staff.data?.staff.filter(item => item.active).map(item => <Pressable key={item.id} disabled={busy} accessibilityRole="checkbox" aria-checked={selectedStaff.includes(item.id)} accessibilityLabel={item.displayName} accessibilityState={{ checked: selectedStaff.includes(item.id), disabled: busy }} onPress={() => toggleStaff(item.id)} className={`rounded-control border px-3 py-3 ${selectedStaff.includes(item.id) ? 'border-brand bg-brand-soft' : 'border-line'}`}><AppText>{item.displayName}{selectedStaff.includes(item.id) ? ' ✓' : ''}</AppText></Pressable>)}</View>}
      <AppText className="text-sm text-muted">{t('catalog.staffHint')}</AppText>
    </View>}
    {errorFor('form') ? <AppText accessibilityRole="alert" className="text-danger">{errorFor('form')}</AppText> : null}
    {formError ? <AppText accessibilityRole="alert" className="text-danger">{t(formError)}</AppText> : null}
    <View className="flex-row gap-3">
      <View className="flex-1"><ActionButton label={t(editing ? 'catalog.save' : 'catalog.add')} busy={busy} disabled={!draft.name.trim()} onPress={save} /></View>
      <View className="flex-1"><ActionButton secondary disabled={busy} label={t('catalog.back')} onPress={cancelForm} /></View>
    </View>
  </View>;
}
