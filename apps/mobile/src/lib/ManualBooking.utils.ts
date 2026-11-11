import type { ManualDraft, ManualInput, ManualOptions } from '../types/ManualBooking.types';
import { validBookingDate } from './CompactBooking.utils';
import { internationalPhone } from './PhoneNumber';
/** The reviewed payload, or null when something is missing. The phone may be typed the local way (050-1234567); it is sent in E.164. */
export function manualInput(draft: Readonly<ManualDraft>, options: ManualOptions | undefined, key: string): ManualInput | null {
  const service = options?.services.find(row => row.id === draft.serviceId), phone = internationalPhone(draft.customerPhone), name = draft.customerName.trim(), email = draft.customerEmail.trim();
  if (!options?.bookable || !service?.staff.some(row => row.id === draft.staffId) || !validBookingDate(draft.localDate) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.localTime) || [...name].length < 2 || name.length > 120 || !phone || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (draft.utcOffset && !/^[+-]\d{2}:\d{2}$/.test(draft.utcOffset))) return null;
  return { finalConsent: true, idempotencyKey: key, serviceId: service.id, staffId: draft.staffId, localDate: draft.localDate, localTime: draft.localTime, customerName: name, customerPhone: phone, ...(email ? { customerEmail: email } : {}), ...(draft.utcOffset ? { utcOffset: draft.utcOffset } : {}), reviewedService: { name: service.name, durationMinutes: service.durationMinutes, priceMinor: service.priceMinor, currency: service.currency } };
}
/** A draft belongs to one person, one session context and one business; anything else starts empty. */
export const manualDraftScope = (identity: string | null, version: number, businessId: string) => JSON.stringify([identity, version, businessId]);
