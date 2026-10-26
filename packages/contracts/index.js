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

// Non-secret navigation hint only. Each destination revalidates server access.
export function safeAuthReturnTo(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\\\s#]/.test(value) || value.startsWith('//')) return undefined;
  const [pathname] = value.split('?');
  if (pathname === '/discover' && value === '/discover') return '/'; // Retired route.
  if (/^\/p\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pathname) && pathname.length <= 83 && value === pathname) return pathname;
  if ((pathname === '/' || pathname === '/register/provider') && value === pathname) return pathname;
  if (/^\/provider\/(?:dashboard|[A-Za-z0-9_-]{1,128}|team\/[A-Za-z0-9_-]{1,128})$/.test(pathname)) {
    if (pathname !== '/provider/dashboard') return value === pathname ? pathname : undefined;
    try {
      const url = new URL(value, 'https://visit.invalid');
      for (const [key, field] of url.searchParams) if (key !== 'businessId' || url.searchParams.getAll(key).length !== 1 || !/^[A-Za-z0-9_-]{1,128}$/.test(field)) return undefined;
      return `${pathname}${url.search}`;
    } catch { return undefined; }
  }
  if (!/^\/booking\/[A-Za-z0-9_-]{1,128}$/.test(pathname)) return undefined;
  try {
    const url = new URL(value, 'https://visit.invalid');
    if (url.origin !== 'https://visit.invalid' || url.pathname !== pathname || url.username || url.password) return undefined;
    for (const [key, field] of url.searchParams) {
      if (!['serviceId', 'date', 'fromBookingId'].includes(key) || url.searchParams.getAll(key).length !== 1) return undefined;
      if (key === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(field) || !Number.isFinite(Date.parse(`${field}T00:00:00Z`)) || new Date(`${field}T00:00:00Z`).toISOString().slice(0, 10) !== field) return undefined;
      } else if (!/^[A-Za-z0-9_-]{1,128}$/.test(field)) return undefined;
    }
    return `${url.pathname}${url.search}`;
  } catch { return undefined; }
}

// Pilot onboarding policy. Existing business zones/booking instants are never relabelled.
export const PILOT_TIMEZONE = 'Asia/Jerusalem';

export function providerSharePath(slug) {
  if (typeof slug !== 'string' || slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return undefined;
  return `/p/${slug}`;
}
