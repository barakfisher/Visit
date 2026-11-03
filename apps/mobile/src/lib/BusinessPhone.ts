/** The API stores public phone numbers in E.164 only. */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
export const ISRAEL_COUNTRY_CODE = '972';
/** Israeli local numbers start with a trunk 0: 9 digits for landlines (03-1234567), 10 for mobiles (050-1234567). */
const ISRAELI_LOCAL_PATTERN = /^0[1-9]\d{7,8}$/;

/**
 * Turns what an Israeli owner types into the E.164 number the API accepts, or null when it is not a phone number.
 * Spaces, dashes, dots and parentheses are ignored; a local number gets the Israeli country code.
 */
export function internationalBusinessPhone(value: string) {
  const compact = value.trim().replace(/[\s\-.()]/g, '');
  if (E164_PATTERN.test(compact)) return compact;
  if (ISRAELI_LOCAL_PATTERN.test(compact)) return `+${ISRAEL_COUNTRY_CODE}${compact.slice(1)}`;
  return null;
}
