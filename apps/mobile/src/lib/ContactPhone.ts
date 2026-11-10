import { internationalPhone } from './PhoneNumber';

/** Where the profile's contact phone endpoint lives. The number is unverified and only its owner sees it. */
export const CONTACT_PHONE_ENDPOINT = '/api/account/contact-phone';

/**
 * Reads what is typed in the profile's phone field against the stored number.
 * An empty field means "remove the number"; anything else must be a phone number.
 */
export function contactPhoneEdit(draft: string, saved: string | null) {
  const empty = !draft.trim();
  const phone = empty ? null : internationalPhone(draft);
  const invalid = !empty && !phone;
  return { phone, invalid, changed: !invalid && phone !== saved };
}
