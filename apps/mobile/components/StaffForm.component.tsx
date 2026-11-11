import { Switch, View } from 'react-native';
import type { MessageKey } from '@/src/i18n/messages';
import { MAX_STAFF_NAME, STAFF_CAPACITY_SHOWN, capacityText, type StaffDraftError } from '@/src/lib/StaffRoster';
import type { StaffRosterState } from '@/src/lib/StaffRoster.hook';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import { TextField } from './TextField';

const errorMessages: Record<StaffDraftError, MessageKey> = { name: 'roster.error.name', services: 'roster.error.services', capacity: 'roster.error.capacity', capacityInUse: 'roster.error.capacityInUse' };

/** Name, services and (when shown) capacity, in the add dialog and in a card's "General" tab. The availability switch exists only when editing. */
export function StaffForm({ t, staff, draft, errors, formError, saved, busy, assignable, expanded, update, toggleService, save, cancelAdd, cancelEdit, testID }: StaffRosterState & { testID?: string }) {
  const editing = expanded !== null;
  const errorFor = (key: keyof typeof errors) => errors[key] ? t(errorMessages[errors[key]!]) : undefined;
  return <View testID={testID} className="gap-4">
    <TextField label={t('roster.name')} value={draft.name} maxLength={MAX_STAFF_NAME} editable={!busy} onChangeText={name => update({ name })} error={errorFor('name')} />
    {STAFF_CAPACITY_SHOWN ? <TextField label={t('roster.capacity')} identifier keyboardType="number-pad" inputMode="numeric" value={draft.capacity} editable={!busy} onChangeText={value => update({ capacity: capacityText(value) })} hint={t('roster.capacityHint')} error={errorFor('capacity')} /> : null}
    <View className="gap-2">
      <AppText className="font-medium text-ink">{t('roster.services')}</AppText>
      <View className="flex-row flex-wrap gap-2">
        {assignable.map(service => {
          const selected = draft.serviceIds.includes(service.id);
          return <Control key={service.id} disabled={busy} accessibilityRole="checkbox" aria-checked={selected} accessibilityLabel={service.name} accessibilityState={{ checked: selected, disabled: busy }} onPress={() => toggleService(service.id)}
            className={`min-h-touch justify-center rounded-control border px-4 py-2 ${selected ? 'border-brand bg-brand-soft' : 'border-line'}`}>
            <AppText className={selected ? 'font-semibold text-brand' : 'text-ink'}>{selected ? '✓ ' : ''}{service.name}</AppText>
          </Control>;
        })}
      </View>
      {errorFor('services') ? <AppText accessibilityRole="alert" className="text-sm text-danger">{errorFor('services')}</AppText> : null}
    </View>
    {editing ? <View className="gap-1">
      <View className="flex-row items-center justify-between gap-3"><AppText className="flex-1 font-medium text-ink">{t('roster.available')}</AppText><Switch accessibilityLabel={t('roster.available')} disabled={busy} value={draft.active} onValueChange={active => update({ active })} /></View>
      <AppText className="text-sm text-body">{t('roster.availableHint', { name: staff.data?.staff.find(row => row.id === expanded)?.displayName ?? draft.name.trim() })}</AppText>
    </View> : null}
    {formError ? <AppText accessibilityRole="alert" className="text-danger">{t(formError)}</AppText> : null}
    {saved ? <AppText role="status" className="text-success">{t('roster.saved')}</AppText> : null}
    <View className="flex-row gap-3">
      <View className="flex-1"><ActionButton label={t(editing ? 'roster.save' : 'roster.addSubmit')} busy={busy} onPress={save} /></View>
      <View className="flex-1"><ActionButton secondary disabled={busy} label={t('roster.cancel')} onPress={editing ? cancelEdit : cancelAdd} /></View>
    </View>
  </View>;
}
