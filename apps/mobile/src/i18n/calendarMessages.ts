/** The business calendar screen (decisions.md, "The calendar screen" — 2026-11-11). */
export const calendarEn = {
  'nav.calendar': 'Calendar',
  'calendar.week': 'Week', 'calendar.day': 'Day', 'calendar.today': 'Today', 'calendar.mode': 'Calendar view',
  'calendar.previousWeek': 'Previous week', 'calendar.nextWeek': 'Next week', 'calendar.previousDay': 'Previous day', 'calendar.nextDay': 'Next day',
  'calendar.addAt': 'Add appointment, {date} {time}',
  'calendar.loading': 'Loading calendar…', 'calendar.loadFailure': 'The calendar could not load. Check your connection and retry.',
  'calendar.emptyWeek': 'No appointments on these days.', 'calendar.emptyDay': 'No appointments on this day.', 'calendar.closedDay': 'Closed on this day.',
  'calendar.appointmentTitle': 'Appointment',
} as const;
export const calendarHe: Record<keyof typeof calendarEn, string> = {
  'nav.calendar': 'יומן',
  'calendar.week': 'שבוע', 'calendar.day': 'יום', 'calendar.today': 'היום', 'calendar.mode': 'תצוגת יומן',
  'calendar.previousWeek': 'השבוע הקודם', 'calendar.nextWeek': 'השבוע הבא', 'calendar.previousDay': 'היום הקודם', 'calendar.nextDay': 'היום הבא',
  'calendar.addAt': 'הוספת תור, {date} {time}',
  'calendar.loading': 'טוענים את היומן…', 'calendar.loadFailure': 'לא הצלחנו לטעון את היומן. בדקו את החיבור ונסו שוב.',
  'calendar.emptyWeek': 'אין תורים בימים האלה.', 'calendar.emptyDay': 'אין תורים ביום הזה.', 'calendar.closedDay': 'העסק סגור ביום הזה.',
  'calendar.appointmentTitle': 'תור',
};
