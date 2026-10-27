import { useAuthStore } from '../state/auth';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppLocale } from '../i18n/LocaleContext';
import { intlLocale, localDate, timePolicyNote } from './appointmentTime';
import { slotLabels } from './slotLabels';
import { readBookingCalendar } from './CompactBooking.service';
import { addBookingDays, availableBookingSlots, bookingMonthCells, bookingSlotId, preferredBookingPage, shiftBookingMonth, validBookingDate } from './CompactBooking.utils';
import type { CompactBookingInput } from '../types/CompactBooking.types';
import { formatMoney } from '../types/flows';
export function useCompactBooking(input: CompactBookingInput) {
  const identityId = useAuthStore(state => state.identityId), contextVersion = useAuthStore(state => state.contextVersion);
  const { locale, t, direction } = useAppLocale(), language = intlLocale(locale);
  const [sheet, setSheet] = useState<'service' | 'calendar' | null>(null);
  const [monthChoice, setMonthChoice] = useState({ scope: '', month: '' });
  const [preferred, setPreferred] = useState(''), [pageOffset, setPageOffset] = useState<number | null>(null);
  const [searching, setSearching] = useState(false), [searchNotice, setSearchNotice] = useState('');
  const search = useRef<AbortController | null>(null), sequence = useRef(0);
  const scope = `${identityId}:${contextVersion}:${input.providerId}:${input.fromBookingId ?? ''}:${input.serviceId}:${input.date}`;
  const today = input.provider ? localDate(input.provider.timezone) : '';
  const fallbackMonth = (validBookingDate(input.date) ? input.date : today).slice(0, 7);
  const month = monthChoice.scope === scope ? monthChoice.month : fallbackMonth;
  const calendar = useQuery({ queryKey: ['booking-calendar', identityId, contextVersion, input.providerId, input.fromBookingId ?? 'public', input.serviceId, month], queryFn: ({ signal }) => readBookingCalendar(input.providerId, input.serviceId, `${month}-01`, 31, input.fromBookingId, signal), enabled: Boolean(input.provider && input.serviceId && /^\d{4}-\d{2}$/.test(month)), staleTime: 10000 });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearching(false); setPageOffset(null);
    return () => { sequence.current += 1; search.current?.abort(); };
  }, [scope]);
  const available = availableBookingSlots(input.slots, input.excluded);
  const labels = slotLabels(input.slots, locale), byId = new Map(input.slots.map((slot, index) => [bookingSlotId(slot), labels[index] ?? slot.localTime]));
  const validPreferred = preferred === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(preferred);
  const start = Math.max(0, Math.min(pageOffset ?? preferredBookingPage(available, preferred), Math.max(0, available.length - 6)));
  const page = validPreferred ? available.slice(start, start + 6).map(slot => ({ id: bookingSlotId(slot), label: byId.get(bookingSlotId(slot)) ?? slot.localTime })) : [];
  const availableDates = calendar.data?.days.filter(day => day.available && day.date >= calendar.data.today && day.date <= calendar.data.maximumDate).map(day => day.date) ?? [];
  const choices = input.provider?.services.map(service => ({ id: service.id, label: service.name, summary: `${service.durationMinutes} ${t('bookingCommit.minutes')} · ${formatMoney(service.priceMinor, service.currency)}`, selected: service.id === input.serviceId })) ?? [];
  const chosen = choices.find(choice => choice.selected);
  function open(next: 'service' | 'calendar') { if (!input.disabled) { setSearchNotice(''); setSheet(next); if (next === 'calendar') void calendar.refetch(); } }
  function selectDate(date: string) { if (input.disabled || !availableDates.includes(date)) return; input.onDate(date); setSheet(null); setPageOffset(null); }
  function selectService(id: string) { if (input.disabled || !choices.some(choice => choice.id === id)) return; input.onService(id); setSheet(null); setPageOffset(null); }
  function changePreferred(value: string) { if (input.disabled) return; input.onReset(); setPreferred(value); setPageOffset(null); }
  async function nextDate() {
    if (searching || input.disabled || !input.serviceId || !calendar.data) return;
    const current = ++sequence.current; search.current?.abort(); const controller = new AbortController(); search.current = controller;
    setSearching(true); setSearchNotice('');
    try {
      let from = input.date < calendar.data.today ? calendar.data.today : addBookingDays(input.date, 1);
      const maximum = calendar.data.maximumDate;
      while (from <= maximum) {
        const remaining = Math.round((+new Date(`${maximum}T12:00Z`) - +new Date(`${from}T12:00Z`)) / 86400000) + 1;
        const result = await readBookingCalendar(input.providerId, input.serviceId, from, Math.min(31, remaining), input.fromBookingId, controller.signal);
        if (controller.signal.aborted || current !== sequence.current || useAuthStore.getState().identityId !== identityId || useAuthStore.getState().contextVersion !== contextVersion) return;
        const found = result.days.find(day => day.available && day.date >= result.today && day.date <= result.maximumDate);
        if (found) { input.onDate(found.date); setPageOffset(null); return; }
        from = addBookingDays(from, 31);
      }
      setSearchNotice(t('compact.noMoreDates'));
    } catch { if (!controller.signal.aborted && current === sequence.current) setSearchNotice(t('compact.searchFailed')); }
    finally { if (current === sequence.current) setSearching(false); }
  }
  const monthTitle = validBookingDate(`${month}-01`) ? new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00Z`)) : '';
  const dateTitle = validBookingDate(input.date) ? new Intl.DateTimeFormat(language, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${input.date}T12:00Z`)) : t('compact.chooseDate');
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + index, 12))));
  return { direction, sheet, open, close: () => setSheet(null), choices, chosen, selectService, month, monthTitle, dateTitle, weekdays,
    cells: bookingMonthCells(month, availableDates, input.date, language), selectDate,
    previousMonth: () => setMonthChoice({ scope, month: shiftBookingMonth(month, -1) }), nextMonth: () => setMonthChoice({ scope, month: shiftBookingMonth(month, 1) }),
    canPreviousMonth: Boolean(calendar.data && month > calendar.data.today.slice(0, 7)), canNextMonth: Boolean(calendar.data && month < calendar.data.maximumDate.slice(0, 7)),
    calendarLoading: calendar.isFetching, calendarError: calendar.isError, retryCalendar: () => void calendar.refetch(),
    preferred, validPreferred, changePreferred, page, earlier: () => setPageOffset(Math.max(0, start - 6)), later: () => setPageOffset(Math.min(Math.max(0, available.length - 6), start + 6)),
    hasEarlier: start > 0, hasLater: start + 6 < available.length, pageSummary: t('compact.page', { start: page.length ? start + 1 : 0, end: start + page.length, total: available.length }),
    nextDate, searching, searchNotice, canSearch: Boolean(calendar.data && input.date < calendar.data.maximumDate), timeNote: input.provider ? timePolicyNote(input.provider.timezone, locale) : '',
  };
}
