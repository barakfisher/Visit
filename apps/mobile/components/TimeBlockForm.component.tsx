import { View } from 'react-native';
import type { MessageKey } from '@/src/i18n/messages';
import { MAX_BLOCK_DAYS, MAX_BLOCK_REASON, type BlockFormError, type BlockKind } from '@/src/lib/TimeBlocks';
import type { TimeBlockDialogState } from '@/src/lib/TimeBlocks.hook';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import { FormDialog } from './FormDialog';
import { TextField } from './TextField';

const errorMessages: Record<BlockFormError, MessageKey> = { date: 'blocks.error.date', past: 'blocks.error.past', format: 'blocks.error.format', order: 'blocks.error.order', range: 'blocks.error.range', tooLong: 'blocks.error.tooLong', reason: 'blocks.error.reason' };

function Choice({ label, selected, disabled, onPress, testID }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; testID?: string }) {
  return <Control testID={testID} accessibilityRole="radio" aria-checked={selected} accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    className={`min-h-touch justify-center rounded-control border px-4 py-2 ${selected ? 'border-brand bg-brand-soft' : 'border-line'}`}>
    <AppText className={selected ? 'font-semibold text-brand' : 'text-ink'}>{label}</AppText>
  </Control>;
}

/** Who, what and when to block, with an optional reason. Saving here is the only save. */
export function TimeBlockForm({ staff, ...state }: TimeBlockDialogState & { staff: readonly { id: string; displayName: string }[] }) {
  const { t, form, errors, conflicts, failure, busy, update, save, close, when } = state;
  const errorFor = (key: keyof typeof errors) => errors[key] ? t(errorMessages[errors[key]!], { max: errors[key] === 'reason' ? MAX_BLOCK_REASON : MAX_BLOCK_DAYS }) : undefined;
  const kinds: BlockKind[] = ['hours', 'days'];
  return <View testID="block-form" className="gap-4">
    <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('blocks.who')}>
      <AppText className="font-medium text-ink">{t('blocks.who')}</AppText>
      <View className="flex-row flex-wrap gap-2">
        <Choice testID="block-who-business" label={t('blocks.wholeBusiness')} selected={!form.staffId} disabled={busy} onPress={() => update({ staffId: '' })} />
        {staff.map(row => <Choice key={row.id} testID={`block-who-${row.id}`} label={row.displayName} selected={form.staffId === row.id} disabled={busy} onPress={() => update({ staffId: row.id })} />)}
      </View>
    </View>
    <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('blocks.kind')}>
      <AppText className="font-medium text-ink">{t('blocks.kind')}</AppText>
      <View className="flex-row flex-wrap gap-2">
        {kinds.map(kind => <Choice key={kind} testID={`block-kind-${kind}`} label={t(`blocks.kind.${kind}`)} selected={form.kind === kind} disabled={busy} onPress={() => update({ kind })} />)}
      </View>
    </View>
    {form.kind === 'hours' ? <View className="gap-3">
      <TextField identifier editable={!busy} label={t('blocks.date')} value={form.date} placeholder="YYYY-MM-DD" maxLength={10} hint={t('blocks.dateHint')} onChangeText={date => update({ date })} error={errorFor('date')} />
      <View className="flex-row gap-3">
        <View className="flex-1"><TextField identifier editable={!busy} label={t('blocks.from')} value={form.startLocal} placeholder="12:00" maxLength={5} onChangeText={startLocal => update({ startLocal })} error={errorFor('startLocal')} /></View>
        <View className="flex-1"><TextField identifier editable={!busy} label={t('blocks.to')} value={form.endLocal} placeholder="13:00" maxLength={5} onChangeText={endLocal => update({ endLocal })} error={errorFor('endLocal')} /></View>
      </View>
      <AppText className="text-sm text-body">{t('blocks.timeHint')}</AppText>
    </View> : <View className="gap-3">
      <View className="flex-row gap-3">
        <View className="flex-1"><TextField identifier editable={!busy} label={t('blocks.fromDate')} value={form.fromDate} placeholder="YYYY-MM-DD" maxLength={10} onChangeText={fromDate => update({ fromDate })} error={errorFor('fromDate')} /></View>
        <View className="flex-1"><TextField identifier editable={!busy} label={t('blocks.toDate')} value={form.toDate} placeholder="YYYY-MM-DD" maxLength={10} onChangeText={toDate => update({ toDate })} error={errorFor('toDate')} /></View>
      </View>
      <AppText className="text-sm text-body">{t('blocks.daysHint')}</AppText>
    </View>}
    <TextField editable={!busy} label={t('blocks.reason')} value={form.reason} hint={t('blocks.reasonHint')} maxLength={MAX_BLOCK_REASON} onChangeText={reason => update({ reason })} error={errorFor('reason')} />
    {conflicts ? <View testID="block-conflicts" className="gap-2 rounded-control border border-danger bg-canvas p-3">
      <AppText accessibilityRole="alert" className="text-danger">{t('blocks.conflicts', { count: conflicts.total })}</AppText>
      {conflicts.conflicts.map((row, index) => <AppText key={row.kind === 'APPOINTMENT' ? row.id : `reservation-${index}`} className="text-sm text-ink">
        {when(row.startsAt)} · {row.staffName} · {row.kind === 'APPOINTMENT' ? [row.customerName, row.serviceName].filter(Boolean).join(' · ') || t('dashboard.customer') : t('blocks.reservation')}
      </AppText>)}
      {conflicts.total > conflicts.conflicts.length ? <AppText className="text-sm text-body">{t('blocks.more', { count: conflicts.total - conflicts.conflicts.length })}</AppText> : null}
    </View> : null}
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
