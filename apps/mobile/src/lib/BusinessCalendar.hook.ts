import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { SHEET_LEAVE_MS } from '../../components/FormDialog';
import { useProviderWorkspace } from '../../components/ProviderAccess';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { useLiveAgenda } from './LiveSignals.hook';
import { openAgendaContact, readProviderAgenda } from './ProviderAgenda.service';
import { useBlockRemoval, useTimeBlockDialog } from './TimeBlocks.hook';
import { openManualBooking } from './ManualBookingEntry';
import { useManualBooking } from './ManualBooking.hook';
import { appointmentSpan, dateRange, fullDate } from './appointmentTime';
import { isolateLtr } from '../i18n/messages';
import { calendarColumns, calendarMonthTitle } from './CalendarColumns';
import { CALENDAR_MODES, PERIOD_DAYS, SWIPE_TAP_GUARD_MS, localPoint, periodDates, stepPeriod, swipeStep, type CalendarMode } from './CalendarGrid';
import type { BusinessCalendarView } from '../types/BusinessCalendar.types';

/** The "now" line moves on this beat; the agenda's own data is re-read by live signals, not by this timer. */
export const CALENDAR_CLOCK_MS = 60_000;
const validDate = (value: string | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));

/**
 * The business calendar: a week or a day on a grid of the business's hours (decisions.md, "The calendar screen" —
 * 2026-11-11). The period lives in the URL (`date`, `mode`), so a reload or Back keeps it.
 */
export function useBusinessCalendar(): BusinessCalendarView {
  const business = useProviderWorkspace(), { t, locale, direction } = useAppLocale(), router = useRouter(), focused = useIsFocused();
  const identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const params = useLocalSearchParams<{ date?: string; mode?: string }>();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!focused) return;
    // A return to the screen reads the clock at once; the interval keeps it current after that.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), CALENDAR_CLOCK_MS);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [focused]);
  const clock = localPoint(now, business.timezone);
  const mode: CalendarMode = CALENDAR_MODES.find(option => option === params.mode) ?? 'week';
  const date = validDate(params.date) ? params.date : clock.date;
  const dates = periodDates(date, mode), from = dates[0]!, to = dates[dates.length - 1]!;
  const go = (next: { date?: string; mode?: CalendarMode }) => router.setParams({ date: next.date ?? date, mode: next.mode ?? mode });

  const agenda = useQuery({
    queryKey: ['provider', business.id, 'agenda', identity, version, mode, from],
    queryFn: ({ signal }) => readProviderAgenda(business.id, from, signal, PERIOD_DAYS[mode]), enabled: focused, staleTime: 0,
  });
  useLiveAgenda(business.id, focused);
  const removal = useBlockRemoval(business.id);
  const { removeFailure, ...blockRemoval } = removal;
  // A slot names its own day; the footer's Add appointment starts today, as everywhere else. The sheet opens over this screen.
  const manual = useManualBooking(business, clock.date);
  const [opened, setOpened] = useState<{ kind: 'appointment' | 'block'; id: string } | null>(null);
  const blockDialog = useTimeBlockDialog(business.id, business.timezone);
  // A tapped slot asks first: Add appointment or Block time. The next sheet opens once this one has left.
  const [slot, setSlot] = useState<{ date: string; localTime: string } | null>(null);
  const followUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (followUp.current) clearTimeout(followUp.current); }, []);
  // A swipe that starts on a slot or an appointment must not also open it when the finger lifts: taps stay off
  // from the swipe's start until SWIPE_TAP_GUARD_MS after its end.
  const swipeGuard = useRef(false), guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (guardTimer.current) clearTimeout(guardTimer.current); }, []);
  const tapAllowed = () => !swipeGuard.current;
  function startSwipe() { if (guardTimer.current) clearTimeout(guardTimer.current); swipeGuard.current = true; }
  function endSwipe(translationX: number, velocityX: number) {
    guardTimer.current = setTimeout(() => { swipeGuard.current = false; guardTimer.current = null; }, SWIPE_TAP_GUARD_MS);
    const step = swipeStep(translationX, velocityX, direction);
    if (step) go({ date: stepPeriod(date, mode, step) });
  }
  function fromSlot(open: (chosen: { date: string; localTime: string }) => void) {
    if (!slot) return;
    const chosen = slot;
    setSlot(null);
    if (followUp.current) clearTimeout(followUp.current);
    followUp.current = setTimeout(() => { followUp.current = null; open(chosen); }, SHEET_LEAVE_MS);
  }

  const data = agenda.data;
  const { bookings, columns, grid } = calendarColumns({ agenda: data ?? { bookings: [], blocks: [], hours: [] }, dates, timezone: business.timezone, today: clock.date, now, locale });

  // Looked up among all bookings, cancelled included, so cancelling from the sheet keeps it open on the result.
  const openAppointment = opened?.kind === 'appointment' ? data?.bookings.find(booking => booking.id === opened.id) ?? null : null;
  const openBlock = opened?.kind === 'block' ? data?.blocks.find(block => block.id === opened.id) ?? null : null;
  const [feedback, setFeedback] = useState('');
  async function contact(phone: string | null, kind: 'call' | 'whatsapp') {
    if (!phone) return;
    setFeedback('');
    try { await openAgendaContact(phone, kind); } catch { setFeedback(t(kind === 'call' ? 'dashboard.callFailure' : 'dashboard.whatsappFailure')); }
  }
  return {
    t, locale, mode, monthTitle: calendarMonthTitle(from, to, locale), rangeTitle: mode === 'day' ? fullDate(date, locale) : dateRange(from, to, locale),
    setMode: next => go({ mode: next }),
    previous: () => go({ date: stepPeriod(date, mode, -1) }), next: () => go({ date: stepPeriod(date, mode, 1) }),
    swipe: { direction, onStart: startSwipe, onEnd: endSwipe },
    goToday: () => go({ date: clock.date }), showsToday: dates.includes(clock.date),
    openDay: day => { if (tapAllowed()) go({ date: day, mode: 'day' }); },
    status: agenda.isError ? 'error' : !data ? 'loading' : 'ready', retry: () => { if (focused) void agenda.refetch(); },
    columns, grid, clock: { today: clock.date, minute: clock.minute }, empty: data ? bookings.length === 0 : false,
    chooseSlot: (day, localTime) => { if (tapAllowed()) setSlot({ date: day, localTime }); }, closeSlot: () => setSlot(null),
    slot: slot ? { ...slot, title: t('calendar.slotTitle', { date: fullDate(slot.date, locale), time: isolateLtr(slot.localTime) }) } : null,
    // No staff from a slot: a staff member left over from a free-time card would narrow the times.
    addAtSlot: () => fromSlot(chosen => openManualBooking(business.id, { localDate: chosen.date, localTime: chosen.localTime, staffId: '' })),
    blockAtSlot: () => fromSlot(chosen => blockDialog.openDialog(chosen.date, chosen.localTime)),
    blockDialog, staff: data?.staff ?? [],
    openEntry: entry => { if (!tapAllowed()) return; blockRemoval.askRemove(null); setFeedback(''); setOpened(entry.kind === 'appointment' ? { kind: 'appointment', id: entry.booking.id } : { kind: 'block', id: entry.block.id }); },
    closeEntry: () => { blockRemoval.askRemove(null); setOpened(null); },
    openAppointment, openBlock, businessId: business.id, timezone: business.timezone,
    contact: (phone, kind) => void contact(phone, kind),
    blockRemoval, feedback: removeFailure ? t(removeFailure) : feedback, manual,
    span: (startsAt, endsAt) => appointmentSpan(startsAt, endsAt, business.timezone, locale, true),
  };
}
