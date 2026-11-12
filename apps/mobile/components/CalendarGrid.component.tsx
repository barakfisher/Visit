import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { isolateLtr } from '@/src/i18n/messages';
import { SLOT_MINUTES, gridSlots, localClock, minutesOf, slotAvailable } from '@/src/lib/CalendarGrid';
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

type GridProps = Pick<BusinessCalendarView, 't' | 'mode' | 'status' | 'columns' | 'grid' | 'clock' | 'chooseSlot' | 'openEntry' | 'openDay'>;

/** The weekday and date over each column; with several days a tap opens that day. Visible text is each button's name: a separate label fails axe's label-content-name-mismatch. */
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
      return mode !== 'day'
        ? <Control key={column.date} testID={`calendar-day-${column.date}`} accessibilityRole="button" onPress={() => openDay(column.date)} className="flex-1 items-center gap-0.5 py-1 active:bg-brand-soft" style={flat}>{label}</Control>
        : <View key={column.date} testID={`calendar-day-${column.date}`} className="flex-1 items-center gap-0.5 py-1">{label}</View>;
    })}
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
    {/* Three columns leave room for a name, not for a name after the time: the name leads, then the time. */}
    {mode === 'threeDays' ? <>
      <Text numberOfLines={1} className={`text-xs font-bold ${ink}`}>{title}</Text>
      {lines > 1 ? <Text numberOfLines={1} className={`text-xs ${ink}`}>{time}</Text> : null}
      {lines > 2 && detail ? <Text numberOfLines={lines - 2} className={`text-xs ${ink}`}>{detail}</Text> : null}
    </> : mode === 'day' ? <>
      <Text numberOfLines={1} className={`text-xs font-bold ${ink}`}>{time} · {title}</Text>
      {lines > 1 && detail ? <Text numberOfLines={lines - 1} className={`text-xs ${ink}`}>{detail}</Text> : null}
    </> : <Text numberOfLines={lines} className={`text-xs font-semibold ${ink}`} style={{ lineHeight: 16 }}>{title}</Text>}
  </Control>;
}

/** The shade of every slot nothing can start in, past or outside working hours alike, so one colour means "not here". */
const UNAVAILABLE = 'bg-slate-100';

/** A day blocked whole is filled with its block, from the grid's top to its bottom; a tap opens the block. */
function AllDayBlocks({ column, t, openEntry }: { column: CalendarColumn } & Pick<GridProps, 't' | 'openEntry'>) {
  const count = column.allDay.length;
  return <>{column.allDay.map((block, index) => <Control key={block.id} testID={`calendar-allday-${column.date}-${block.id}`} accessibilityRole="button" onPress={() => openEntry({ kind: 'block', startsAt: block.startsAt, endsAt: block.endsAt, block })}
    className="absolute inset-y-0 border border-amber-300 bg-amber-100 px-1 py-1 active:bg-amber-200" style={{ ...flat, width: `${100 / count}%`, start: `${index * 100 / count}%` }}>
    <Text className="text-xs font-semibold text-warning">{block.reason || t('dashboard.blocked')}</Text>
  </Control>)}</>;
}

function Column({ column, grid, clock, mode, status, t, chooseSlot, openEntry }: { column: CalendarColumn } & Omit<GridProps, 'columns' | 'openDay'>) {
  const blockedAllDay = column.allDay.length > 0;
  return <View testID={`calendar-column-${column.date}`} className="relative flex-1 border-s border-line">
    {gridSlots(grid).map(localTime => {
      const minute = minutesOf(localTime), line = minute % 60 === 0 ? 'border-t border-line' : '', height = HOUR_HEIGHT / (60 / SLOT_MINUTES);
      // While the period loads its hours are unknown: every slot is plain and nothing can be tapped yet.
      if (status === 'loading') return <View key={localTime} className={`bg-surface ${line}`} style={{ height }} />;
      // A slot something can start in offers Add appointment or Block time; any other is only drawn, in the unavailable shade.
      return slotAvailable({ date: column.date, minute, hours: column.hours, blockedAllDay, clock })
        ? <Control key={localTime} testID={`calendar-slot-${column.date}-${localTime}`} accessibilityRole="button" accessibilityLabel={t('calendar.slotAt', { date: column.fullDate, time: isolateLtr(localTime) })} onPress={() => chooseSlot(column.date, localTime)}
          className={`bg-surface ${line} active:bg-brand-soft`} style={{ ...flat, height }} />
        : <View key={localTime} className={`${UNAVAILABLE} ${line}`} style={{ height }} />;
    })}
    <AllDayBlocks column={column} t={t} openEntry={openEntry} />
    {column.entries.map(piece => <Entry key={piece.key} piece={piece} grid={grid} mode={mode} t={t} openEntry={openEntry} />)}
    {column.today && clock.minute >= grid.start * 60 && clock.minute <= grid.end * 60 ? <View testID="calendar-now" accessible={false} pointerEvents="none" className="absolute inset-x-0 flex-row items-center" style={{ top: (clock.minute - grid.start * 60) / 60 * HOUR_HEIGHT - 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.color.danger }} />
      <View className="flex-1" style={{ height: 2, backgroundColor: tokens.color.danger }} />
    </View> : null}
  </View>;
}

/**
 * The hours of the period as rows and its days as columns (decisions.md, "The calendar screen" — 2026-11-11).
 * Slots nothing can start in share one shade; a day blocked whole is filled with its block. Appointments are
 * brand-filled until they end, then grey; blocks are amber, as on the home.
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
