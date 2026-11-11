import type { ManualDraft, ManualInput, ManualOptions } from '../types/ManualBooking.types';
import { validBookingDate } from './CompactBooking.utils';
import { internationalPhone } from './PhoneNumber';
/** The reviewed payload, or null when something is missing. The phone may be typed the local way (050-1234567); it is sent in E.164. */
export function manualInput(draft: Readonly<ManualDraft>, options: ManualOptions | undefined, key: string): ManualInput | null {
  // A picked card's own contacts win; only what an app customer's card lacks is typed (the server applies the same rule).
  const card = draft.customerCard, service = options?.services.find(row => row.id === draft.serviceId), phone = card?.phone ?? internationalPhone(draft.customerPhone), name = (card?.name ?? draft.customerName).trim(), email = (card ? card.email ?? '' : draft.customerEmail).trim();
  if (!options?.bookable || !service?.staff.some(row => row.id === draft.staffId) || !validBookingDate(draft.localDate) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.localTime) || [...name].length < 2 || name.length > 120 || !phone || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (draft.utcOffset && !/^[+-]\d{2}:\d{2}$/.test(draft.utcOffset))) return null;
  return { finalConsent: true, idempotencyKey: key, serviceId: service.id, staffId: draft.staffId, localDate: draft.localDate, localTime: draft.localTime, customerName: name, customerPhone: phone, ...(email ? { customerEmail: email } : {}), ...(card ? { customerCardId: card.id } : { saveCustomer: draft.saveCustomer }), ...(draft.utcOffset ? { utcOffset: draft.utcOffset } : {}), reviewedService: { name: service.name, durationMinutes: service.durationMinutes, priceMinor: service.priceMinor, currency: service.currency } };
}
/** The fields of the Add appointment sheet that can be wrong, each shown with its own message under it. */
export const MANUAL_FIELDS = ['service', 'time', 'name', 'phone', 'email'] as const;
export type ManualField = typeof MANUAL_FIELDS[number];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Which fields stop the review, by the same rules as `manualInput`. A picked card's own name and phone count as filled,
 * since those fields are not shown then. `timeChosen` is whether a free time is chosen for this service and day.
 */
export function manualFieldErrors(draft: Readonly<ManualDraft>, timeChosen: boolean): ManualField[] {
  const card = draft.customerCard, name = (card?.name ?? draft.customerName).trim(), email = card ? '' : draft.customerEmail.trim();
  const wrong: Record<ManualField, boolean> = {
    service: !draft.serviceId, time: Boolean(draft.serviceId) && !timeChosen,
    name: [...name].length < 2 || name.length > 120, phone: !(card?.phone ?? internationalPhone(draft.customerPhone)),
    email: Boolean(email) && !EMAIL.test(email),
  };
  return MANUAL_FIELDS.filter(field => wrong[field]);
}
/** A draft belongs to one person, one session context and one business; anything else starts empty. */
export const manualDraftScope = (identity: string | null, version: number, businessId: string) => JSON.stringify([identity, version, businessId]);
