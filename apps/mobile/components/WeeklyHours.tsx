import { ActivityIndicator, View } from 'react-native';
import { formatIntervals, groupWeek, isClosedWeek } from '@/src/lib/WeeklyHours';
import type { WeeklyHoursState } from '@/src/lib/WeeklyHours.hook';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { FormDialog } from './FormDialog';
import { ScheduleImpact } from './ScheduleImpact.component';
import { WeeklyHoursForm } from './WeeklyHoursForm.component';

/** Times read left to right in Hebrew too, so they sit in an isolated LTR run. */
const ltr = (text: string) => `⁦${text}⁩`;

/** The weekly hours summary with its edit dialog, for the business and for a staff member. */
export function WeeklyHours(state: WeeklyHoursState) {
  const { t, direction, staff, loading, failed, ready, week, inherited, busy, preview, failure, saved, formOpen, openEdit, cancelForm, followBusiness, retry } = state;
  return <View testID="weekly-hours" className="gap-4" style={{ direction }}>
    <View className="flex-row flex-wrap items-center justify-between gap-3">
      <AppText accessibilityRole="header" className="text-xl font-semibold text-ink">{t('hours.title')}</AppText>
      {ready ? <ActionButton secondary label={t('hours.edit')} disabled={busy} onPress={openEdit} /> : null}
    </View>
    {loading ? <ActivityIndicator accessibilityLabel={t('common.loading')} />
      : failed ? <><AppText accessibilityRole="alert">{t('hours.loadFailed')}</AppText><ActionButton secondary label={t('common.retry')} onPress={retry} /></>
      : isClosedWeek(week) ? <AppText>{t('hours.empty')}</AppText>
      : <View testID="hours-summary" className="gap-2">
        {groupWeek(week).map(group => <AppText key={group.days.join('-')} testID={`hours-group-${group.days.join('-')}`} className="text-base text-ink">
          <AppText className="font-semibold">{group.days.map(day => t(`hours.day.${day}`)).join(', ')}:</AppText> {group.intervals.length ? ltr(formatIntervals(group.intervals)) : t('hours.closed')}
        </AppText>)}
      </View>}
    {ready && staff && inherited ? <AppText className="text-sm text-body">{t('hours.inherited')}</AppText> : null}
    {ready && staff && !inherited ? <ActionButton secondary label={t('hours.followBusiness')} busy={busy && !formOpen} disabled={busy} onPress={followBusiness} /> : null}
    {/* Results of "Follow business hours", which has no dialog of its own. */}
    {!formOpen && preview ? <ScheduleImpact {...state} /> : null}
    {!formOpen && failure ? <AppText accessibilityRole="alert" className="text-danger">{t(failure)}</AppText> : null}
    {saved ? <AppText role="status">{t('hours.saved')}</AppText> : null}
    <FormDialog title={t('hours.editTitle')} open={formOpen} onClose={cancelForm} testID="hours-dialog"><WeeklyHoursForm {...state} /></FormDialog>
  </View>;
}
