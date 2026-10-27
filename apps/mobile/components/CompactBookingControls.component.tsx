import { useState } from 'react';
import { CALENDAR_MIN_WIDTH, compactBookingStyles as styles } from './CompactBookingControls.styles';
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { TimeChips } from './TimeChips';
import type { CompactBookingControlsProps } from './CompactBookingControls.types';
export function CompactBookingControls({ controls: c, t, disabled, date, selectedId, slotLoading, slotError, onRetrySlots, onSelectSlot }: CompactBookingControlsProps) {
  // Sheet width measured at layout; the grid takes it, or scrolls horizontally below the minimum touch-target width.
  const [sheetWidth, setSheetWidth] = useState(0);
  return <View className="gap-5">
    <View className="gap-2"><AppText className="text-sm font-semibold text-body">{t('compact.service')}</AppText>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('compact.chooseService')} · ${c.chosen?.label ?? t(c.choices.length ? 'compact.chooseService' : 'compact.noServices')} ⌄`} accessibilityState={{ expanded: c.sheet === 'service', disabled: disabled || !c.choices.length }} disabled={disabled || !c.choices.length} onPress={() => c.open('service')} className="min-h-14 flex-row items-center justify-between gap-3 rounded-control border border-line bg-surface px-4 py-3"><AppText className="flex-1 font-semibold text-ink">{c.chosen?.label ?? t(c.choices.length ? 'compact.chooseService' : 'compact.noServices')}</AppText><AppText>⌄</AppText></Pressable>
      {c.chosen ? <AppText className="text-sm text-body">{c.chosen.summary}</AppText> : null}
    </View>
    <View className="gap-2"><AppText className="text-sm font-semibold text-body">{t('compact.date')}</AppText>
      <Pressable testID="booking-date-trigger" accessibilityRole="button" accessibilityLabel={`${t('compact.chooseDate')} · ${c.dateTitle} · ${date}`} accessibilityState={{ expanded: c.sheet === 'calendar', disabled: disabled || !c.chosen }} disabled={disabled || !c.chosen} onPress={() => c.open('calendar')} className="min-h-14 rounded-control border border-line bg-surface px-4 py-3"><AppText className="font-semibold text-brand">{c.dateTitle}</AppText></Pressable>
    </View>
    {c.chosen ? <View className="gap-3"><AppText className="text-sm font-semibold text-body">{t('compact.around')}</AppText><TextInput testID="booking-preferred-time" accessibilityLabel={t('compact.around')} value={c.preferred} onChangeText={c.changePreferred} editable={!disabled} placeholder="09:00" maxLength={5} keyboardType="numbers-and-punctuation" style={styles.identifier} className="rounded-control border border-line bg-surface px-4 py-3 text-ink" />
      <AppText className="text-sm text-muted">{t('compact.preferenceHelp')}</AppText>
      {!c.validPreferred ? <AppText accessibilityRole="alert" className="text-danger">{t('compact.validTime')}</AppText> : slotError ? <View className="gap-2"><AppText accessibilityRole="alert" className="text-danger">{t('compact.slotsFailed')}</AppText><ActionButton secondary label={t('common.retry')} onPress={onRetrySlots} /></View> : <>
        <TimeChips timezone="" slots={c.page} selectedId={selectedId} loading={slotLoading} busy={disabled} onSelect={onSelectSlot} />
        {!slotLoading && !c.page.length ? <AppText accessibilityRole="status" className="text-body">{t('compact.noTimes')}</AppText> : null}
        {!slotLoading && c.page.length ? <><AppText accessibilityLiveRegion="polite" className="text-sm text-muted">{c.pageSummary}</AppText><View className="flex-row gap-3"><View className="flex-1"><ActionButton secondary label={t('compact.earlier')} disabled={disabled || !c.hasEarlier} onPress={c.earlier} /></View><View className="flex-1"><ActionButton secondary label={t('compact.later')} disabled={disabled || !c.hasLater} onPress={c.later} /></View></View></> : null}
        {!slotLoading && !c.page.length ? <ActionButton secondary label={t('compact.nextDate')} disabled={disabled || !c.canSearch} busy={c.searching} onPress={() => void c.nextDate()} /> : null}
      </>}
      {c.searchNotice ? <AppText accessibilityRole="status">{c.searchNotice}</AppText> : null}
    </View> : null}
    <Modal transparent visible={c.sheet !== null} animationType="none" accessibilityLabel={t(c.sheet === 'service' ? 'compact.chooseService' : 'compact.chooseDate')} onRequestClose={c.close}>
      <View style={[styles.overlay, { direction: c.direction }]}>
        <ScrollView accessibilityViewIsModal style={styles.panel} contentContainerStyle={styles.panelContent}>
          <AppText accessibilityRole="header" className="text-xl font-bold text-ink">{t(c.sheet === 'service' ? 'compact.chooseService' : 'compact.chooseDate')}</AppText>
          <ActionButton secondary label={t('compact.close')} onPress={c.close} />
          {c.sheet === 'service' ? <ScrollView contentContainerStyle={styles.choices}>{c.choices.map(choice => <Pressable key={choice.id} accessibilityRole="button" accessibilityState={{ selected: choice.selected }} aria-pressed={choice.selected} onPress={() => c.selectService(choice.id)} className={`min-h-14 gap-1 rounded-control border px-4 py-3 ${choice.selected ? 'border-brand bg-brand-soft' : 'border-line'}`}><AppText className="font-semibold text-ink">{choice.label}</AppText><AppText className="text-sm text-body">{choice.summary}</AppText></Pressable>)}</ScrollView> : <>
            <View className="flex-row items-center gap-2"><View className="flex-1"><ActionButton secondary label={t('compact.previousMonth')} disabled={c.calendarLoading || !c.canPreviousMonth} onPress={c.previousMonth} /></View><AppText testID="booking-calendar-month" accessibilityLabel={c.month} className="flex-1 text-center font-semibold text-ink">{c.monthTitle}</AppText><View className="flex-1"><ActionButton secondary label={t('compact.nextMonth')} disabled={c.calendarLoading || !c.canNextMonth} onPress={c.nextMonth} /></View></View>
            {c.calendarLoading ? <ActivityIndicator accessibilityLabel={t('compact.loadingCalendar')} /> : null}
            {c.calendarError ? <View className="gap-2"><AppText accessibilityRole="alert" className="text-danger">{t('compact.calendarFailed')}</AppText><ActionButton secondary label={t('common.retry')} onPress={c.retryCalendar} /></View> : <View onLayout={event => setSheetWidth(event.nativeEvent.layout.width)}><ScrollView horizontal accessibilityLabel={c.monthTitle}><View style={{ width: Math.max(sheetWidth, CALENDAR_MIN_WIDTH) }}>
              <View className="flex-row">{c.weekdays.map((label, index) => <AppText key={index} style={styles.weekday} className="text-xs text-muted">{label}</AppText>)}</View>
              <View className="flex-row flex-wrap">{c.cells.map((cell, index) => <View key={cell?.date ?? `blank-${index}`} style={styles.cell}>{cell ? <Pressable testID={`booking-day-${cell.date}`} accessibilityRole="button" accessibilityLabel={cell.label} accessibilityState={{ disabled: !cell.available || c.calendarLoading, selected: cell.selected }} aria-pressed={cell.selected} disabled={!cell.available || c.calendarLoading} onPress={() => c.selectDate(cell.date)} className={`min-h-11 items-center justify-center rounded-control border ${!cell.available ? 'border-transparent bg-canvas' : cell.selected ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}><AppText className={cell.available ? 'font-semibold text-brand' : 'text-muted'}>{cell.day}</AppText></Pressable> : <View style={styles.blank} />}</View>)}</View>
            </View></ScrollView></View>}
            <AppText className="text-sm text-muted">{t('compact.calendarHelp')}</AppText>
          </>}
        </ScrollView>
      </View>
    </Modal>
  </View>;
}
