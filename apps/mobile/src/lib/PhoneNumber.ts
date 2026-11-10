/** The API stores phone numbers in E.164 only. */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
export const ISRAEL_COUNTRY_CODE = '972';
/** Israeli local numbers start with a trunk 0: 9 digits for landlines (03-1234567), 10 for mobiles (050-1234567). */
const ISRAELI_LOCAL_PATTERN = /^0[1-9]\d{7,8}$/;

/**
 * Turns what someone in the Israeli pilot types into the E.164 number the API accepts, or null when it is not a phone number.
 * Spaces, dashes, dots and parentheses are ignored; a local number gets the Israeli country code.
 */
export function internationalPhone(value: string) {
  const compact = value.trim().replace(/[\s\-.()]/g, '');
  if (E164_PATTERN.test(compact)) return compact;
  if (ISRAELI_LOCAL_PATTERN.test(compact)) return `+${ISRAEL_COUNTRY_CODE}${compact.slice(1)}`;
  return null;
}

/** Shows a stored Israeli number the way people write it (050-1234567); any other country stays in E.164. */
export function localPhone(e164: string) {
  if (!e164.startsWith(`+${ISRAEL_COUNTRY_CODE}`)) return e164;
  const national = `0${e164.slice(ISRAEL_COUNTRY_CODE.length + 1)}`;
  return `${national.slice(0, national.length - 7)}-${national.slice(-7)}`;
}
