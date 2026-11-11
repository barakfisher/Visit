import { View } from 'react-native';
import { AppText as Text } from './AppText';
import { ActionButton } from './ActionButton';
import { CompactBookingControls } from './CompactBookingControls.component';
import { Control } from './Control';
import { FormDialog } from './FormDialog';
import { ManualCustomer, customerReviewLine } from './ManualCustomer.component';
import { isolateLtr } from '../src/i18n/messages';
import type { ManualBookingView, ManualSlotPicking } from '../src/types/ManualBooking.types';

function StaffChoice({ label, selected, disabled, onPress, testID }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; testID?: string }) {
  return <Control testID={testID} accessibilityRole="radio" aria-checked={selected} accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    className={`min-h-touch justify-center rounded-control border px-4 py-2 ${selected ? 'border-brand bg-brand-soft' : 'border-line'}`}>
    <Text className={selected ? 'font-semibold text-brand' : 'text-ink'}>{label}</Text>
  </Control>;
}

/** With several staff on the service, the times can be narrowed to one of them; a time always brings its own staff member. */
function StaffFilter({ t, picking }: { t: ManualBookingView['t']; picking: ManualSlotPicking }) {
  if (picking.staff.length < 2) return null;
  return <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('manual.staff')}>
    <Text className="text-sm font-semibold text-body">{t('manual.staff')}</Text>
    <View className="flex-row flex-wrap gap-2">
      <StaffChoice testID="manual-staff-any" label={t('manual.anyStaff')} selected={!picking.staffFilter} disabled={picking.disabled} onPress={() => picking.onStaffFilter('')} />
      {picking.staff.map(row => <StaffChoice key={row.id} testID={`manual-staff-${row.id}`} label={row.displayName} selected={picking.staffFilter === row.id} disabled={picking.disabled} onPress={() => picking.onStaffFilter(row.id)} />)}
    </View>
  </View>;
}

/** The form inside the Add appointment sheet. Everything but the customer is chosen, never typed (decisions.md, 2026-11-11). */
export function ManualBooking(view: ManualBookingView) {
  const { t, draft, update, options, busy, locked, picking } = view;
  const editing = !locked && !draft.reviewed;
  return <View className="gap-4" testID="manual-booking-form">
    <Text className="text-sm text-body">{t('manual.unverified')}</Text>
    {view.success ? <Text role="status" className="text-ink">{view.feedback}</Text>
      : editing && view.loadError ? <View className="gap-2"><Text accessibilityRole="alert">{t('manual.loadError')}</Text><ActionButton secondary label={t('common.retry')} onPress={view.retry} /></View>
      : editing && view.loading ? <Text role="status">{t('manual.loading')}</Text>
      : editing && !options?.bookable ? <Text>{t('manual.notBookable')}</Text>
      : editing && !options?.services.some(row => row.staff.length) ? <Text>{t('manual.empty')}</Text>
      : !editing ? <View className="gap-2">
        <Text accessibilityRole="header" className="font-semibold text-ink">{t('manual.reviewTitle')}</Text>
        <Text>{view.serviceSummary}</Text>
        <Text>{draft.localDate} · {picking?.slotLabel || draft.localTime}</Text>
        <Text>{draft.customerName}</Text><Text>{isolateLtr(draft.customerPhone)}</Text>{draft.customerEmail ? <Text>{isolateLtr(draft.customerEmail)}</Text> : null}
        <Text testID="manual-review-customer" className="text-sm text-body">{customerReviewLine(t, draft)}</Text>
        <ActionButton label={t(locked && !busy ? 'manual.retry' : 'manual.confirm')} onPress={view.confirm} busy={busy} />
        <ActionButton secondary label={t('manual.edit')} disabled={busy || locked} onPress={() => update({ reviewed: false })} />
      </View> : <>
        {picking ? <CompactBookingControls t={t} {...picking} beforeTimes={<StaffFilter t={t} picking={picking} />} /> : null}
        {picking?.slotLabel ? <Text testID="manual-chosen-time" className="font-semibold text-brand">{t('manual.chosenTime', { time: picking.slotLabel })}</Text> : null}
        <ManualCustomer view={view} />
        <ActionButton testID="manual-review" label={t('manual.review')} onPress={view.review} disabled={busy} />
      </>}
    {view.feedback && !view.success ? <Text accessibilityRole="alert" className="text-danger">{view.feedback}</Text> : null}
    <ActionButton secondary testID="manual-close" label={t('manual.close')} onPress={view.close} disabled={busy || locked} />
  </View>;
}

/** Add appointment rises from the bottom like Block time, over the business home (decisions.md, 2026-11-11). */
export function ManualBookingDialog(view: ManualBookingView) {
  return <FormDialog testID="manual-booking-sheet" title={view.t('manual.title')} open={view.draft.open} onClose={view.close}><ManualBooking {...view} /></FormDialog>;
}
