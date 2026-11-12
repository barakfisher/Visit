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
/** The reasons a block can carry, in the order they are offered and written; any number of them, or none. */
export const BLOCK_REASONS = ['break', 'meeting', 'errands', 'vacation', 'other'] as const;
export type BlockReason = typeof BLOCK_REASONS[number];
/** The block dialog. An empty staffId blocks the whole business. */
export type BlockForm = { staffId: string; kind: BlockKind; date: string; startLocal: string; endLocal: string; fromDate: string; toDate: string; reasons: BlockReason[] };
export type BlockFormError = 'date' | 'format' | 'order' | 'range' | 'tooLong' | 'past';
export type BlockFormErrors = Partial<Record<'date' | 'startLocal' | 'endLocal' | 'fromDate' | 'toDate', BlockFormError>>;

/** A block started from a calendar slot lasts this long, unless the day ends first. */
export const SLOT_BLOCK_MINUTES = 60;
const LAST_MINUTE = 23 * 60 + 59;
const clockOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * A new block for the whole business on the chosen date: a midday hour, or `SLOT_BLOCK_MINUTES` from a calendar
 * slot's time (ending at 23:59 at the latest, since a block's end is a clock time of the same day).
 */
export function emptyBlockForm(date: string, startLocal?: string): BlockForm {
  const start = startLocal && TIME.test(startLocal) ? Number(startLocal.slice(0, 2)) * 60 + Number(startLocal.slice(3, 5)) : 12 * 60;
  return { staffId: '', kind: 'hours', date, startLocal: clockOf(start), endLocal: clockOf(Math.min(start + SLOT_BLOCK_MINUTES, LAST_MINUTE)), fromDate: date, toDate: date, reasons: [] };
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
  return errors;
}

/** Adds a reason that is not chosen, or takes away one that is, keeping the offered order. */
export function toggleBlockReason(reasons: readonly BlockReason[], reason: BlockReason): BlockReason[] {
  const chosen = reasons.includes(reason) ? reasons.filter(row => row !== reason) : [...reasons, reason];
  return BLOCK_REASONS.filter(row => chosen.includes(row));
}

/**
 * The chosen reasons travel as the block's text in the owner's language ("Break, Meeting"), so the API and the
 * cards that show it stay as they were. Five labels stay far under `MAX_BLOCK_REASON`.
 */
export function blockInput(form: BlockForm, businessId: string, label: (reason: BlockReason) => string): TimeBlockInput {
  const reason = BLOCK_REASONS.filter(row => form.reasons.includes(row)).map(label).join(', '), who = { businessId, ...(form.staffId ? { staffId: form.staffId } : {}), ...(reason ? { reason } : {}) };
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
