export const SERVICE_CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP'];
export const MAX_PRICE_MINOR = 2_000_000_000;
// One pure contract runs in Node, Expo and browser forms. Prices are integer hundredths.
export function validateService(input, partial = false) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { form: 'invalid' };
  const known = ['name', 'description', 'durationMinutes', 'priceMinor', 'currency', 'active'];
  if (Object.keys(input).some(key => !known.includes(key))) errors.form = 'unknown';
  if (!partial || 'name' in input) {
    if (typeof input.name !== 'string' || Array.from(input.name.trim()).length < 2 || Array.from(input.name.trim()).length > 120) errors.name = 'name';
  }
  if ('description' in input && input.description !== null && (typeof input.description !== 'string' || Array.from(input.description.trim()).length > 2000)) errors.description = 'description';
  if (!partial || 'durationMinutes' in input) {
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 1440) errors.durationMinutes = 'duration';
  }
  if ('priceMinor' in input && input.priceMinor !== null && (!Number.isInteger(input.priceMinor) || input.priceMinor < 0 || input.priceMinor > MAX_PRICE_MINOR)) errors.priceMinor = 'price';
  if ('currency' in input && input.currency !== null && !SERVICE_CURRENCIES.includes(input.currency)) errors.currency = 'currency';
  if ((!partial || ('priceMinor' in input && 'currency' in input)) && ((input.priceMinor != null) !== (input.currency != null))) errors.priceMinor = 'pair';
  if ('active' in input && typeof input.active !== 'boolean') errors.active = 'invalid';
  if (partial && !Object.keys(input).length) errors.form = 'empty';
  return errors;
}
export function parseServicePrice(text) {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result <= MAX_PRICE_MINOR ? result : undefined;
}
