import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { possibleLocalInstants } from './local-time.js';

export const DEFAULT_BOOKING_POLICY = Object.freeze({ minimumNoticeMinutes: 60, maximumAdvanceDays: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 1440, rescheduleCutoffMinutes: 1440 });
export const bookingPolicySchema = z.strictObject({
  minimumNoticeMinutes: z.number().int().min(0).max(525600),
  maximumAdvanceDays: z.number().int().min(1).max(730),
  bufferBeforeMinutes: z.number().int().min(0).max(1440),
  bufferAfterMinutes: z.number().int().min(0).max(1440),
  cancellationCutoffMinutes: z.number().int().min(0).max(525600),
  rescheduleCutoffMinutes: z.number().int().min(0).max(525600),
}).refine(value => value.minimumNoticeMinutes <= value.maximumAdvanceDays * 1440, { path: ['minimumNoticeMinutes'], message: 'Minimum notice cannot exceed the booking horizon.' });
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm in 24-hour time.');
const interval = z.strictObject({ startLocal: time, endLocal: time }).refine(value => value.startLocal < value.endLocal, { path: ['endLocal'], message: 'End time must follow start time on the same day.' });
export const availabilityRulesSchema = z.strictObject({
  weekly: z.array(z.strictObject({ weekday: z.number().int().min(0).max(6), intervals: z.array(interval).max(8) })).max(7),
  overrides: z.array(z.strictObject({ date: z.string().date(), isOpen: z.boolean(), startLocal: time.optional(), endLocal: time.optional() }).refine(value => value.isOpen ? Boolean(value.startLocal && value.endLocal && value.startLocal < value.endLocal) : value.startLocal === undefined && value.endLocal === undefined, { message: 'Open overrides need an increasing interval; closed overrides have no hours.' })).max(400),
}).superRefine((value, context) => {
  const weekdays = new Set<number>(), dates = new Set<string>();
  value.weekly.forEach((day, index) => {
    if (weekdays.has(day.weekday)) context.addIssue({ code: 'custom', path: ['weekly', index, 'weekday'], message: 'Each weekday can appear once.' });
    weekdays.add(day.weekday);
    const ordered = day.intervals.map((hours, original) => ({ ...hours, original })).sort((a, b) => a.startLocal.localeCompare(b.startLocal));
    ordered.forEach((hours, position) => {
      if (position && hours.startLocal < ordered[position - 1]!.endLocal) context.addIssue({ code: 'custom', path: ['weekly', index, 'intervals', hours.original, 'startLocal'], message: 'Opening intervals cannot overlap. Adjacent intervals are allowed.' });
    });
  });
  value.overrides.forEach((day, index) => {
    if (dates.has(day.date)) context.addIssue({ code: 'custom', path: ['overrides', index, 'date'], message: 'Each override date can appear once.' });
    dates.add(day.date);
  });
});

function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Review the schedule or policy fields.', Object.fromEntries(parsed.error.issues.map(issue => [issue.path.join('.') || 'form', issue.message])));
  return parsed.data;
}
export const parseBookingPolicy = (input: unknown) => validated(bookingPolicySchema, input);
export function parseAvailabilityRules(input: unknown, timezone: string) {
  const rules = validated(availabilityRulesSchema, input);
  const fields: Record<string, string> = {};
  rules.overrides.forEach((day, index) => {
    if (!day.isOpen) return;
    for (const boundary of ['startLocal', 'endLocal'] as const) {
      const candidates = possibleLocalInstants(day.date, day[boundary]!, timezone);
      if (candidates.length !== 1) fields[`overrides.${index}.${boundary}`] = candidates.length ? 'This boundary is ambiguous during the clock change. Choose an unambiguous opening boundary.' : 'This local time does not exist during the clock change.';
    }
  });
  if (Object.keys(fields).length) throw new AppError(400, 'INVALID_LOCAL_TIME', 'Review the date override boundaries.', fields);
  return rules;
}

export function effectiveWindows(override: { isOpen: boolean; startLocal: string | null; endLocal: string | null } | null, weekly: { startLocal: string; endLocal: string }[]) {
  return override ? (override.isOpen && override.startLocal && override.endLocal ? [{ startLocal: override.startLocal, endLocal: override.endLocal }] : []) : weekly;
}
