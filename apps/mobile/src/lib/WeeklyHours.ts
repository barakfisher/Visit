import type { ScheduleDraft, ScheduleInterval, ScheduleProposal, ScheduleRules } from '../types/ScheduleEditor.types';

/** API weekdays, 0 = Sunday. The week is shown from Sunday, as it starts in Israel. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** The API accepts at most this many opening intervals per weekday (`availabilityRulesSchema`). */
export const MAX_DAY_INTERVALS = 8;
export const DEFAULT_INTERVAL: ScheduleInterval = { startLocal: '09:00', endLocal: '17:00' };
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type Week = ScheduleInterval[][];
/** Days that share exactly the same hours; a closed group has no intervals. */
export type HoursGroup = { days: Weekday[]; intervals: ScheduleInterval[] };
/** The edit dialog: the chosen days all get the same hours, or are all closed. */
export type HoursForm = { days: number[]; closed: boolean; intervals: ScheduleInterval[] };
export type HoursFormError = 'days' | 'format' | 'order' | 'overlap' | 'staffClosed';
/** Keys: `days`, `start.{index}`, `end.{index}`, and `form` for a whole-week problem. */
export type HoursFormErrors = Record<string, HoursFormError>;

export function scheduleDraft(rules?: ScheduleRules): ScheduleDraft {
  return { weekly: WEEKDAYS.map(day => sortIntervals(rules?.weekly.filter(row => row.weekday === day).map(({ startLocal, endLocal }) => ({ startLocal, endLocal })) ?? [])), overrides: rules?.overrides.map(row => ({ ...row, date: row.date.slice(0, 10) })) ?? [] };
}
export function scheduleProposal(draft: ScheduleDraft): ScheduleProposal {
  return { weekly: draft.weekly.map((intervals, weekday) => ({ weekday, intervals })), overrides: draft.overrides.map(row => ({ date: row.date, isOpen: row.isOpen, ...(row.isOpen ? { startLocal: row.startLocal, endLocal: row.endLocal } : {}) })) };
}
export function sortIntervals(intervals: ScheduleInterval[]) { return [...intervals].sort((a, b) => a.startLocal.localeCompare(b.startLocal)); }
export const isClosedWeek = (week: Week) => week.every(day => !day.length);

/**
 * A staff member without weekly rows follows the business hours (`assertWorkingHours` in the API),
 * so the editor shows and starts from the business week until the staff member has a week of their own.
 */
export function effectiveWeek(own: Week, business?: Week): { week: Week; inherited: boolean } {
  return business && isClosedWeek(own) ? { week: business, inherited: true } : { week: own, inherited: false };
}

/** Groups days with identical hours, in week order, e.g. Sun, Wed, Thu: 09:00–19:00. */
export function groupWeek(week: Week): HoursGroup[] {
  const groups = new Map<string, HoursGroup>();
  for (const day of WEEKDAYS) {
    const intervals = sortIntervals(week[day] ?? []), key = intervals.map(row => `${row.startLocal}-${row.endLocal}`).join('|');
    const group = groups.get(key);
    if (group) group.days.push(day); else groups.set(key, { days: [day], intervals });
  }
  return [...groups.values()];
}
export const formatIntervals = (intervals: ScheduleInterval[]) => intervals.map(row => `${row.startLocal}–${row.endLocal}`).join(' | ');

export const emptyHoursForm = (): HoursForm => ({ days: [], closed: false, intervals: [{ ...DEFAULT_INTERVAL }] });
/** The first chosen day loads its current hours into the form; later days take the form's hours. */
export function toggleFormDay(form: HoursForm, day: number, week: Week): HoursForm {
  if (form.days.includes(day)) return { ...form, days: form.days.filter(item => item !== day) };
  const days = [...form.days, day].sort((a, b) => a - b);
  if (form.days.length) return { ...form, days };
  const current = week[day] ?? [];
  return { days, closed: !current.length, intervals: current.length ? current.map(row => ({ ...row })) : [{ ...DEFAULT_INTERVAL }] };
}

export function validateHoursForm(form: HoursForm, week: Week, staff: boolean): HoursFormErrors {
  const errors: HoursFormErrors = {};
  if (!form.days.length) errors.days = 'days';
  if (form.closed) {
    // A staff member with no weekly rows follows the business hours, so "closed every day" cannot be stored.
    if (form.days.length && staff && isClosedWeek(applyHoursForm(week, form))) errors.form = 'staffClosed';
    return errors;
  }
  form.intervals.forEach((row, index) => {
    if (!TIME.test(row.startLocal)) errors[`start.${index}`] = 'format';
    if (!TIME.test(row.endLocal)) errors[`end.${index}`] = 'format';
    else if (TIME.test(row.startLocal) && row.startLocal >= row.endLocal) errors[`end.${index}`] = 'order';
  });
  if (Object.keys(errors).some(key => key !== 'days')) return errors;
  // Adjacent intervals are allowed, as in the API.
  const ordered = form.intervals.map((row, index) => ({ ...row, index })).sort((a, b) => a.startLocal.localeCompare(b.startLocal));
  ordered.forEach((row, position) => { if (position && row.startLocal < ordered[position - 1]!.endLocal) errors[`start.${row.index}`] = 'overlap'; });
  return errors;
}

export function applyHoursForm(week: Week, form: HoursForm): Week {
  return WEEKDAYS.map(day => form.days.includes(day) ? form.closed ? [] : sortIntervals(form.intervals.map(row => ({ ...row }))) : (week[day] ?? []).map(row => ({ ...row })));
}
