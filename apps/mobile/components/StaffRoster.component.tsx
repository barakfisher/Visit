import { ActivityIndicator, View } from 'react-native';
import { assignedServiceNames, type RosterStaff } from '@/src/lib/StaffRoster';
import type { StaffRosterState, StaffTab } from '@/src/lib/StaffRoster.hook';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { AddButton, outlineActionClass } from './AddButton';
import { AppointmentConflicts } from './AppointmentConflicts.component';
import { Control } from './Control';
import { EditButton } from './EditButton';
import { FormDialog } from './FormDialog';
import { StaffForm } from './StaffForm.component';
import type { ReactNode } from 'react';

/** The "Hours" tab's content, supplied by the screen so this view stays free of router hooks (Storybook cannot bundle them). */
type RosterProps = StaffRosterState & { hours: (staffId: string) => ReactNode };

/** The staff settings screen: a list of cards, an add dialog, and one card's settings open at a time. */
export function StaffRosterView(state: RosterProps) {
  const { t, direction, staff, services, assignable, addOpen, expanded, message, busy, openAdd, cancelAdd, canAddSelf, openAddSelf } = state;
  const loading = staff.isLoading || services.isLoading, failed = staff.isError || services.isError;
  return <View className="gap-4" style={{ direction }}>
    <View className="flex-row flex-wrap items-center justify-between gap-3">
      <AppText accessibilityRole="header" className="text-xl font-semibold text-ink">{t('roster.title')}</AppText>
      {loading || failed || assignable.length ? <AddButton testID="staff-add" label={t('roster.add')} disabled={busy || loading || failed} onPress={openAdd} /> : null}
    </View>
    <AppText className="text-body">{t('roster.hint')}</AppText>
    {loading ? <ActivityIndicator accessibilityLabel={t('common.loading')} />
      : failed ? <><AppText accessibilityRole="alert">{t('roster.loadFailed')}</AppText><ActionButton secondary label={t('common.retry')} onPress={() => { void staff.refetch(); void services.refetch(); }} /></>
      : <>
        {!assignable.length ? <AppText>{t('roster.needsService')}</AppText> : null}
        {!staff.data?.staff.length ? <>
          <AppText>{t('roster.empty')}</AppText>
          {canAddSelf ? <View testID="staff-add-self" className="gap-3 rounded-control border border-line bg-canvas p-3"><AppText className="text-body">{t('roster.addSelfHint')}</AppText><ActionButton label={t('roster.addSelf')} disabled={busy} onPress={openAddSelf} /></View> : null}
        </> : staff.data.staff.map(row => <StaffCard key={row.id} row={row} {...state} />)}
      </>}
    {message ? <AppText role={message === 'roster.removeFailed' ? 'alert' : 'status'} className={message === 'roster.removeFailed' ? 'text-danger' : 'text-ink'}>{t(message)}</AppText> : null}
    {/* The add dialog and an open card share one draft, so the dialog never opens over an open card. */}
    <FormDialog title={t('roster.add')} open={addOpen && expanded === null} onClose={cancelAdd} testID="staff-dialog"><StaffForm testID="staff-add-form" {...state} /></FormDialog>
  </View>;
}

function StaffCard({ row, ...state }: RosterProps & { row: RosterStaff }) {
  const { t, locale, expanded, removing, removingPending, conflicts, busy, toggleEdit, askRemove, confirmRemove, when } = state;
  const open = expanded === row.id;
  return <View testID={`staff-card-${row.id}`} className="gap-3 rounded-control border border-line bg-surface p-4">
    <AppText accessibilityRole="header" className="text-lg font-semibold text-ink">{row.displayName}</AppText>
    {row.active ? null : <AppText className="self-start rounded-full bg-canvas px-3 py-1 text-sm font-semibold text-warning">{t('roster.unavailable')}</AppText>}
    <AppText>{t('roster.capacityLine', { count: row.parallelCapacity })}</AppText>
    <View className="flex-row flex-wrap gap-2">
      {assignedServiceNames(row, locale).map(name => <AppText key={name} className="rounded-full border border-line bg-canvas px-3 py-1 text-sm text-ink">{name}</AppText>)}
    </View>
    {removing === row.id ? <View className="gap-3 rounded-control border border-line bg-canvas p-3">
      <AppText>{t('roster.removeHelp', { name: row.displayName })}</AppText>
      {conflicts ? <AppointmentConflicts testID="staff-conflicts" title={t('roster.conflicts', { count: conflicts.total })} total={conflicts.total} conflicts={conflicts.conflicts} when={when} /> : null}
      <View className="flex-row gap-3">
        <View className="flex-1"><ActionButton busy={removingPending === row.id} disabled={(busy && removingPending !== row.id) || !!conflicts} label={t('roster.confirmRemove')} onPress={() => confirmRemove(row.id)} /></View>
        <View className="flex-1"><ActionButton secondary disabled={busy} label={t('roster.cancel')} onPress={() => askRemove(null)} /></View>
      </View>
    </View> : <View className="flex-row flex-wrap gap-2">
      <EditButton testID={`staff-edit-${row.id}`} label={t('roster.edit')} accessibilityLabel={t('roster.editLabel', { name: row.displayName })} expanded={open} disabled={busy} onPress={() => toggleEdit(row)} />
      {/* Remove shares Edit's compact look so the two sit as one row of card actions. */}
      <Control testID={`staff-remove-${row.id}`} accessibilityRole="button" accessibilityLabel={t('roster.removeLabel', { name: row.displayName })} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => askRemove(row.id)} className={outlineActionClass(busy)}>
        <AppText className={`font-semibold ${busy ? 'text-muted' : 'text-brand'}`}>{t('roster.remove')}</AppText>
      </Control>
    </View>}
    {open ? <StaffSettings row={row} {...state} /> : null}
  </View>;
}

function StaffSettings({ row, ...state }: RosterProps & { row: RosterStaff }) {
  const { t, tab, busy, setTab } = state;
  const tabs: StaffTab[] = ['general', 'hours'];
  return <View testID={`staff-settings-${row.id}`} className="gap-4 border-t border-line pt-4">
    <View accessibilityRole="tablist" accessibilityLabel={t('roster.tabs')} className="flex-row gap-2">
      {tabs.map(key => <Control key={key} testID={`staff-tab-${key}`} accessibilityRole="tab" aria-selected={tab === key} accessibilityState={{ selected: tab === key, disabled: busy }} disabled={busy} onPress={() => setTab(key)}
        className={`min-h-touch flex-1 items-center justify-center rounded-control border px-4 py-2 ${tab === key ? 'border-brand bg-brand-soft' : 'border-line'}`}>
        <AppText className={tab === key ? 'font-semibold text-brand' : 'text-ink'}>{t(`roster.${key}`)}</AppText>
      </Control>)}
    </View>
    {tab === 'general' ? <StaffForm testID={`staff-general-${row.id}`} {...state} /> : state.hours(row.id)}
  </View>;
}
