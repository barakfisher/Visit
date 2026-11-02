import { z } from 'zod';
import { AppError } from '../http/errors.js';

export const DEFAULT_BOOKING_POLICY = Object.freeze({ minimumNoticeMinutes: 60, maximumAdvanceDays: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 1440, rescheduleCutoffMinutes: 1440 });
export const bookingPolicySchema = z.strictObject({
  requireCustomerName: z.boolean().optional(),
  requireVerifiedPhone: z.boolean().optional(),
  requireVerifiedEmail: z.boolean().optional(),
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
}).superRefine((value, context) => {
  const weekdays = new Set<number>();
  value.weekly.forEach((day, index) => {
    if (weekdays.has(day.weekday)) context.addIssue({ code: 'custom', path: ['weekly', index, 'weekday'], message: 'Each weekday can appear once.' });
    weekdays.add(day.weekday);
    const ordered = day.intervals.map((hours, original) => ({ ...hours, original })).sort((a, b) => a.startLocal.localeCompare(b.startLocal));
    ordered.forEach((hours, position) => {
      if (position && hours.startLocal < ordered[position - 1]!.endLocal) context.addIssue({ code: 'custom', path: ['weekly', index, 'intervals', hours.original, 'startLocal'], message: 'Opening intervals cannot overlap. Adjacent intervals are allowed.' });
    });
  });
});

function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Review the schedule or policy fields.', Object.fromEntries(parsed.error.issues.map(issue => [issue.path.join('.') || 'form', issue.message])));
  return parsed.data;
}
export const parseBookingPolicy = (input: unknown) => validated(bookingPolicySchema, input);
export const parseAvailabilityRules = (input: unknown) => validated(availabilityRulesSchema, input);
