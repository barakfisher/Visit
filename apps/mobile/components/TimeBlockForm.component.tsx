import { View } from 'react-native';
import type { MessageKey } from '@/src/i18n/messages';
import { BLOCK_REASONS, MAX_BLOCK_DAYS, toggleBlockReason, type BlockFormError, type BlockKind } from '@/src/lib/TimeBlocks';
import type { TimeBlockDialogState } from '@/src/lib/TimeBlocks.hook';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { AppointmentConflicts } from './AppointmentConflicts.component';
import { Control } from './Control';
import { FormDialog } from './FormDialog';
import { DatePickerField, TimePickerField } from './DateTimePicker.component';

const errorMessages: Record<BlockFormError, MessageKey> = { date: 'blocks.error.date', past: 'blocks.error.past', format: 'blocks.error.format', order: 'blocks.error.order', range: 'blocks.error.range', tooLong: 'blocks.error.tooLong' };

function Choice({ label, selected, disabled, onPress, testID }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; testID?: string }) {
  return <Control testID={testID} accessibilityRole="radio" aria-checked={selected} accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    className={`min-h-touch justify-center rounded-control border px-4 py-2 ${selected ? 'border-brand bg-brand-soft' : 'border-line'}`}>
    <AppText className={selected ? 'font-semibold text-brand' : 'text-ink'}>{label}</AppText>
  </Control>;
}

/** A reason that can be chosen along with others, drawn like a staff member's services. */
function ReasonChoice({ label, selected, disabled, onPress, testID }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; testID: string }) {
  return <Control testID={testID} accessibilityRole="checkbox" aria-checked={selected} accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    className={`min-h-touch justify-center rounded-control border px-4 py-2 ${selected ? 'border-brand bg-brand-soft' : 'border-line'}`}>
    <AppText className={selected ? 'font-semibold text-brand' : 'text-ink'}>{selected ? '✓ ' : ''}{label}</AppText>
  </Control>;
}

/** Who, what and when to block, with optional reasons. Saving here is the only save. */
export function TimeBlockForm({ staff, ...state }: TimeBlockDialogState & { staff: readonly { id: string; displayName: string }[] }) {
  const { t, form, errors, conflicts, failure, busy, update, save, close, when, today } = state;
  const errorFor = (key: keyof typeof errors) => errors[key] ? t(errorMessages[errors[key]!], { max: MAX_BLOCK_DAYS }) : undefined;
  const kinds: BlockKind[] = ['hours', 'days'];
  // With one staff member, "the whole business" and that person are the same block, so there is nothing to ask.
  return <View testID="block-form" className="gap-4">
    {staff.length > 1 ? <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('blocks.who')}>
      <AppText className="font-medium text-ink">{t('blocks.who')}</AppText>
      <View className="flex-row flex-wrap gap-2">
        <Choice testID="block-who-business" label={t('blocks.wholeBusiness')} selected={!form.staffId} disabled={busy} onPress={() => update({ staffId: '' })} />
        {staff.map(row => <Choice key={row.id} testID={`block-who-${row.id}`} label={row.displayName} selected={form.staffId === row.id} disabled={busy} onPress={() => update({ staffId: row.id })} />)}
      </View>
    </View> : null}
    <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('blocks.kind')}>
      <AppText className="font-medium text-ink">{t('blocks.kind')}</AppText>
      <View className="flex-row flex-wrap gap-2">
        {kinds.map(kind => <Choice key={kind} testID={`block-kind-${kind}`} label={t(`blocks.kind.${kind}`)} selected={form.kind === kind} disabled={busy} onPress={() => update({ kind })} />)}
      </View>
    </View>
    {/* Chosen in pickers, never typed (decisions.md, 2026-11-11). */}
    {form.kind === 'hours' ? <View className="gap-3">
      <DatePickerField testID="block-date" disabled={busy} label={t('blocks.date')} value={form.date} min={today} onChange={date => update({ date })} error={errorFor('date')} />
      <View className="flex-row gap-3">
        <View className="flex-1"><TimePickerField testID="block-from" disabled={busy} label={t('blocks.from')} value={form.startLocal} onChange={startLocal => update({ startLocal })} error={errorFor('startLocal')} /></View>
        <View className="flex-1"><TimePickerField testID="block-to" disabled={busy} label={t('blocks.to')} value={form.endLocal} onChange={endLocal => update({ endLocal })} error={errorFor('endLocal')} /></View>
      </View>
      <AppText className="text-sm text-body">{t('blocks.timeHint')}</AppText>
    </View> : <View className="gap-3">
      <View className="flex-row gap-3">
        <View className="flex-1"><DatePickerField testID="block-from-date" disabled={busy} label={t('blocks.fromDate')} value={form.fromDate} min={today} onChange={fromDate => update({ fromDate, ...(form.toDate < fromDate ? { toDate: fromDate } : {}) })} error={errorFor('fromDate')} /></View>
        <View className="flex-1"><DatePickerField testID="block-to-date" disabled={busy} label={t('blocks.toDate')} value={form.toDate} min={form.fromDate || today} onChange={toDate => update({ toDate })} error={errorFor('toDate')} /></View>
      </View>
      <AppText className="text-sm text-body">{t('blocks.daysHint')}</AppText>
    </View>}
    <View className="gap-2" accessibilityRole="group" accessibilityLabel={t('blocks.reason')}>
      <AppText className="font-medium text-ink">{t('blocks.reason')}</AppText>
      <View className="flex-row flex-wrap gap-2">
        {BLOCK_REASONS.map(reason => <ReasonChoice key={reason} testID={`block-reason-${reason}`} label={t(`blocks.reason.${reason}`)} selected={form.reasons.includes(reason)} disabled={busy} onPress={() => update({ reasons: toggleBlockReason(form.reasons, reason) })} />)}
      </View>
      <AppText className="text-sm text-body">{t('blocks.reasonHint')}</AppText>
    </View>
    {conflicts ? <AppointmentConflicts testID="block-conflicts" title={t('blocks.conflicts', { count: conflicts.total })} total={conflicts.total} conflicts={conflicts.conflicts} when={when} /> : null}
    {failure ? <AppText accessibilityRole="alert" className="text-danger">{t(failure)}</AppText> : null}
    <View className="flex-row gap-3">
      <View className="flex-1"><ActionButton label={t('blocks.save')} busy={busy} onPress={save} /></View>
      <View className="flex-1"><ActionButton secondary disabled={busy} label={t('blocks.cancel')} onPress={close} /></View>
    </View>
  </View>;
}

export function TimeBlockDialog({ staff, ...state }: TimeBlockDialogState & { staff: readonly { id: string; displayName: string }[] }) {
  return <FormDialog title={state.t('blocks.dialogTitle')} open={state.open} onClose={state.close} testID="block-dialog"><TimeBlockForm staff={staff} {...state} /></FormDialog>;
}
