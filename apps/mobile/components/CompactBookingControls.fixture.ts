/** A filled-in set of booking controls for stories: one service chosen and a page of times. */
import { fn } from 'storybook/test';
import type { useCompactBooking } from '@/src/lib/CompactBooking.hook';
export const compactControlsFixture: ReturnType<typeof useCompactBooking> = {
  direction: 'ltr', sheet: null, open: fn(), close: fn(), choices: [{ id: 'service', label: 'Consultation with a deliberately long service name', summary: '30 min · ₪120', selected: true }], chosen: { id: 'service', label: 'Consultation with a deliberately long service name', summary: '30 min · ₪120', selected: true }, selectService: fn(), month: '2026-10', monthTitle: 'October 2026', dateTitle: 'Tuesday, October 27, 2026', weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], cells: [], selectDate: fn(), previousMonth: fn(), nextMonth: fn(), canPreviousMonth: false, canNextMonth: true, calendarLoading: false, calendarError: false, retryCalendar: fn(), page: [{ id: 'staff:instant', label: '09:00 · Specialist' }], earlier: fn(), later: fn(), hasEarlier: false, hasLater: true, pageSummary: 'Times 1–6 of 12', nextDate: fn(), searching: false, searchNotice: '', canSearch: true,
};
