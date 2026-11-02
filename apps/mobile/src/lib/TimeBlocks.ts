import { ApiError } from './apiClient';
import { validBookingDate } from './CompactBooking.utils';
import { intlLocale } from './appointmentTime';
import type { Locale } from '../i18n/messages';
import type { BlockConflicts, TimeBlock, TimeBlockInput } from '../types/TimeBlocks.types';

/** The API's limits (`apps/api/src/repositories/TimeBlocks.service.ts`). */
export const MAX_BLOCK_DAYS = 366;
export const MAX_BLOCK_REASON = 200;
export const BLOCK_CONFLICT = 'BLOCK_CONFLICT';
export const BLOCK_IN_PAST = 'BLOCK_IN_PAST';
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type BlockKind = 'hours' | 'days';
/** The block dialog. An empty staffId blocks the whole business. */
export type BlockForm = { staffId: string; kind: BlockKind; date: string; startLocal: string; endLocal: string; fromDate: string; toDate: string; reason: string };
export type BlockFormError = 'date' | 'format' | 'order' | 'range' | 'tooLong' | 'past' | 'reason';
export type BlockFormErrors = Partial<Record<'date' | 'startLocal' | 'endLocal' | 'fromDate' | 'toDate' | 'reason', BlockFormError>>;

/** A new block starts as a midday hour for the whole business on the chosen date. */
export function emptyBlockForm(date: string): BlockForm {
  return { staffId: '', kind: 'hours', date, startLocal: '12:00', endLocal: '13:00', fromDate: date, toDate: date, reason: '' };
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** Checks what the form can know; the server still refuses a time already over today or a clock-change gap. */
export function validateBlockForm(form: BlockForm, today: string): BlockFormErrors {
  const errors: BlockFormErrors = {};
  if (form.kind === 'hours') {
    if (!validBookingDate(form.date)) errors.date = 'date';
    else if (form.date < today) errors.date = 'past';
    if (!TIME.test(form.startLocal)) errors.startLocal = 'format';
    if (!TIME.test(form.endLocal)) errors.endLocal = 'format';
    else if (TIME.test(form.startLocal) && form.endLocal <= form.startLocal) errors.endLocal = 'order';
  } else {
    if (!validBookingDate(form.fromDate)) errors.fromDate = 'date';
    if (!validBookingDate(form.toDate)) errors.toDate = 'date';
    else if (!errors.fromDate && form.toDate < form.fromDate) errors.toDate = 'range';
    else if (!errors.fromDate && daysBetween(form.fromDate, form.toDate) + 1 > MAX_BLOCK_DAYS) errors.toDate = 'tooLong';
    else if (form.toDate < today) errors.toDate = 'past';
  }
  if (form.reason.trim().length > MAX_BLOCK_REASON) errors.reason = 'reason';
  return errors;
}

export function blockInput(form: BlockForm, businessId: string): TimeBlockInput {
  const reason = form.reason.trim(), who = { businessId, ...(form.staffId ? { staffId: form.staffId } : {}), ...(reason ? { reason } : {}) };
  return form.kind === 'hours' ? { ...who, kind: 'hours', date: form.date, startLocal: form.startLocal, endLocal: form.endLocal } : { ...who, kind: 'days', fromDate: form.fromDate, toDate: form.toDate };
}

/** The appointments and reservations a refused block would have covered, or null for any other failure. */
export function blockConflicts(error: unknown): BlockConflicts | null {
  if (!(error instanceof ApiError) || error.code !== BLOCK_CONFLICT) return null;
  const details = error.details as Partial<BlockConflicts> | undefined;
  return { total: typeof details?.total === 'number' ? details.total : 0, conflicts: Array.isArray(details?.conflicts) ? details.conflicts : [] };
}

/** "Thu, 24 Dec 2026", computed from the local date alone so no device timezone can shift it. */
export function formatBlockDate(date: string, locale: Locale) {
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
/** Dates and times read left to right in Hebrew too, so they sit in an isolated LTR run. */
export const ltr = (text: string) => `⁦${text}⁩`;
/** The date part of a block: one date, or "first – last" for a range. */
export function blockDates(block: Pick<TimeBlock, 'fromDate' | 'toDate'>, locale: Locale) {
  return block.fromDate === block.toDate ? formatBlockDate(block.fromDate, locale) : `${formatBlockDate(block.fromDate, locale)} – ${formatBlockDate(block.toDate, locale)}`;
}
