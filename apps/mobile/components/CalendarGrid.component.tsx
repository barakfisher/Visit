import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { isolateLtr } from '@/src/i18n/messages';
import { SLOT_MINUTES, gridSlots, isOpen, localClock, minutesOf } from '@/src/lib/CalendarGrid';
import type { BusinessCalendarView, CalendarColumn, CalendarEntry } from '@/src/types/BusinessCalendar.types';
import type { Placed } from '@/src/lib/CalendarGrid';
import { AppText as Text } from './AppText';
import { Control } from './Control';

/** Height of one hour row. A 30-minute appointment is half of it, tall enough for one line of a name. */
export const HOUR_HEIGHT = 56;
/** The narrowest an entry is drawn, so a 5-minute appointment can still be tapped. */
const MIN_ENTRY_HEIGHT = 20;
const GUTTER_WIDTH = 44;
const flat = { minHeight: 0, minWidth: 0 };

/** A spacer as wide as the hours column, so headers line up with the grid in both directions (a padding's side flips differently on web). */
const Gutter = () => <View style={{ width: GUTTER_WIDTH }} />;

type GridProps = Pick<BusinessCalendarView, 't' | 'mode' | 'columns' | 'grid' | 'clock' | 'addAt' | 'openEntry' | 'openDay'>;

/** The weekday and date over each column; in the week a tap opens that day. Visible text is each button's name: a separate label fails axe's label-content-name-mismatch. */
export function CalendarDayHeaders({ mode, columns, openDay }: Pick<GridProps, 'mode' | 'columns' | 'openDay'>) {
  return <View className="flex-row border-b border-line bg-surface">
    <Gutter />
    {columns.map(column => {
      const label = <>
        <Text className={`text-xs font-semibold ${column.today ? 'text-brand' : 'text-muted'}`}>{column.weekday}</Text>
        <View className={`h-8 w-8 items-center justify-center ${column.today ? 'bg-brand' : ''}`} style={{ borderRadius: 16 }}>
          <Text className={`text-base font-bold ${column.today ? 'text-white' : 'text-ink'}`}>{column.dayOfMonth}</Text>
        </View>
      </>;
      return mode === 'week'
        ? <Control key={column.date} testID={`calendar-day-${column.date}`} accessibilityRole="button" onPress={() => openDay(column.date)} className="flex-1 items-center gap-0.5 py-1 active:bg-brand-soft" style={flat}>{label}</Control>
        : <View key={column.date} testID={`calendar-day-${column.date}`} className="flex-1 items-center gap-0.5 py-1">{label}</View>;
    })}
  </View>;
}

/** Whole-day blocks, above the grid like Google Calendar's all-day row. Shown only when the period has one. */
export function CalendarAllDayRow({ t, columns, openEntry }: Pick<GridProps, 't' | 'columns' | 'openEntry'>) {
  if (!columns.some(column => column.allDay.length)) return null;
  return <View className="flex-row border-b border-line bg-surface py-1">
    <Gutter />
    {columns.map(column => <View key={column.date} className="flex-1 gap-0.5 px-0.5">
      {column.allDay.map(block => <Control key={block.id} testID={`calendar-allday-${column.date}-${block.id}`} accessibilityRole="button" onPress={() => openEntry({ kind: 'block', startsAt: block.startsAt, endsAt: block.endsAt, block })}
        className="rounded-md border border-amber-300 bg-amber-100 px-1 py-0.5 active:bg-amber-200" style={flat}>
        <Text numberOfLines={1} className="text-xs font-semibold text-warning">{block.reason || t('dashboard.blocked')}</Text>
      </Control>)}
    </View>)}
  </View>;
}

function entryText(entry: CalendarEntry, t: GridProps['t']) {
  if (entry.kind === 'block') return { title: entry.block.reason || t('dashboard.blocked'), detail: '' };
  const { customer, service } = entry.booking;
  return { title: customer.displayName ?? customer.phone ?? customer.email ?? t('dashboard.customer'), detail: service.name };
}

function Entry({ piece, grid, mode, t, openEntry }: { piece: Placed<CalendarEntry> } & Pick<GridProps, 'grid' | 'mode' | 't' | 'openEntry'>) {
  const entry = piece.item, top = (piece.startMinute - grid.start * 60) / 60 * HOUR_HEIGHT;
  const height = Math.max(MIN_ENTRY_HEIGHT, (piece.endMinute - piece.startMinute) / 60 * HOUR_HEIGHT - 2);
  const { title, detail } = entryText(entry, t), time = isolateLtr(`${localClock(piece.startMinute)}–${localClock(piece.endMinute)}`);
  const lines = Math.max(1, Math.floor((height - 4) / 16));
  const look = entry.kind === 'block' ? 'border border-amber-300 bg-amber-100 active:bg-amber-200' : entry.ended ? 'border border-line bg-slate-200 active:bg-slate-300' : 'bg-brand active:bg-brand-pressed';
  const ink = entry.kind === 'block' ? 'text-warning' : entry.ended ? 'text-body' : 'text-white';
  return <Control testID={`calendar-entry-${piece.key}`} accessibilityRole="button" onPress={() => openEntry(entry)}
    className={`absolute overflow-hidden rounded-md px-1 py-0.5 ${look}`}
    style={{ ...flat, top, height, width: `${100 / piece.lanes}%`, start: `${piece.lane * 100 / piece.lanes}%`, borderWidth: entry.kind === 'appointment' && !entry.ended ? 0 : undefined }}>
    {mode === 'day' ? <>
      <Text numberOfLines={1} className={`text-xs font-bold ${ink}`}>{time} · {title}</Text>
      {lines > 1 && detail ? <Text numberOfLines={lines - 1} className={`text-xs ${ink}`}>{detail}</Text> : null}
    </> : <Text numberOfLines={lines} className={`text-xs font-semibold ${ink}`} style={{ lineHeight: 16 }}>{title}</Text>}
  </Control>;
}

function Column({ column, grid, clock, mode, t, addAt, openEntry }: { column: CalendarColumn } & Omit<GridProps, 'columns' | 'openDay'>) {
  const past = (localTime: string) => column.date < clock.today || column.date === clock.today && minutesOf(localTime) < clock.minute;
  return <View testID={`calendar-column-${column.date}`} className="relative flex-1 border-s border-line">
    {gridSlots(grid).map(localTime => {
      const minute = minutesOf(localTime), shade = isOpen(column.hours, minute) ? 'bg-surface' : 'bg-slate-100', line = minute % 60 === 0 ? 'border-t border-line' : '';
      // An empty slot ahead starts a new appointment there; a slot already past is only drawn.
      return past(localTime) ? <View key={localTime} className={`${shade} ${line}`} style={{ height: HOUR_HEIGHT / (60 / SLOT_MINUTES) }} />
        : <Control key={localTime} testID={`calendar-slot-${column.date}-${localTime}`} accessibilityRole="button" accessibilityLabel={t('calendar.addAt', { date: column.fullDate, time: isolateLtr(localTime) })} onPress={() => addAt(column.date, localTime)}
          className={`${shade} ${line} active:bg-brand-soft`} style={{ ...flat, height: HOUR_HEIGHT / (60 / SLOT_MINUTES) }} />;
    })}
    {column.entries.map(piece => <Entry key={piece.key} piece={piece} grid={grid} mode={mode} t={t} openEntry={openEntry} />)}
    {column.today && clock.minute >= grid.start * 60 && clock.minute <= grid.end * 60 ? <View testID="calendar-now" accessible={false} pointerEvents="none" className="absolute inset-x-0 flex-row items-center" style={{ top: (clock.minute - grid.start * 60) / 60 * HOUR_HEIGHT - 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.color.danger }} />
      <View className="flex-1" style={{ height: 2, backgroundColor: tokens.color.danger }} />
    </View> : null}
  </View>;
}

/**
 * The hours of the period as rows and its days as columns (decisions.md, "The calendar screen" — 2026-11-11).
 * Outside working hours is shaded. Appointments are brand-filled until they end, then grey; blocks are amber, as on the home.
 */
export function CalendarTimeGrid(props: GridProps) {
  const { grid, columns } = props;
  const hours = Array.from({ length: grid.end - grid.start }, (_, index) => grid.start + index);
  return <View testID="calendar-grid" className="flex-row bg-surface">
    <View style={{ width: GUTTER_WIDTH }}>
      {hours.map(hour => <View key={hour} style={{ height: HOUR_HEIGHT }} className="items-center">
        <Text className="text-xs text-muted" style={{ marginTop: -8 }}>{hour === grid.start ? '' : isolateLtr(localClock(hour * 60))}</Text>
      </View>)}
    </View>
    {columns.map(column => <Column key={column.date} column={column} {...props} />)}
  </View>;
}
