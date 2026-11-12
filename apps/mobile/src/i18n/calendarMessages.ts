/** The business calendar screen (decisions.md, "The calendar screen" — 2026-11-11). */
export const calendarEn = {
  'nav.calendar': 'Calendar',
  'calendar.week': 'Week', 'calendar.threeDays': '3 days', 'calendar.day': 'Day', 'calendar.today': 'Today', 'calendar.mode': 'Calendar view',
  'calendar.previousWeek': 'Previous week', 'calendar.nextWeek': 'Next week', 'calendar.previousDay': 'Previous day', 'calendar.nextDay': 'Next day',
  'calendar.previousThreeDays': 'Previous 3 days', 'calendar.nextThreeDays': 'Next 3 days',
  'calendar.slotAt': 'Add or block, {date} {time}', 'calendar.slotTitle': '{date} · {time}',
  'calendar.slotAdd': 'Add appointment', 'calendar.slotBlock': 'Block time',
  'calendar.loading': 'Loading calendar…', 'calendar.loadFailure': 'The calendar could not load. Check your connection and retry.',
  'calendar.emptyWeek': 'No appointments on these days.', 'calendar.emptyDay': 'No appointments on this day.', 'calendar.closedDay': 'Closed on this day.',
  'calendar.appointmentTitle': 'Appointment',
} as const;
export const calendarHe: Record<keyof typeof calendarEn, string> = {
  'nav.calendar': 'יומן',
  'calendar.week': 'שבוע', 'calendar.threeDays': '3 ימים', 'calendar.day': 'יום', 'calendar.today': 'היום', 'calendar.mode': 'תצוגת יומן',
  'calendar.previousWeek': 'השבוע הקודם', 'calendar.nextWeek': 'השבוע הבא', 'calendar.previousDay': 'היום הקודם', 'calendar.nextDay': 'היום הבא',
  'calendar.previousThreeDays': '3 הימים הקודמים', 'calendar.nextThreeDays': '3 הימים הבאים',
  'calendar.slotAt': 'הוספה או חסימה, {date} {time}', 'calendar.slotTitle': '{date} · {time}',
  'calendar.slotAdd': 'הוספת תור', 'calendar.slotBlock': 'חסימת זמן',
  'calendar.loading': 'טוענים את היומן…', 'calendar.loadFailure': 'לא הצלחנו לטעון את היומן. בדקו את החיבור ונסו שוב.',
  'calendar.emptyWeek': 'אין תורים בימים האלה.', 'calendar.emptyDay': 'אין תורים ביום הזה.', 'calendar.closedDay': 'העסק סגור ביום הזה.',
  'calendar.appointmentTitle': 'תור',
};
