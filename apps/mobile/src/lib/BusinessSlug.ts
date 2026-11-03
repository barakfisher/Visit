/** The business URL name the API accepts (`/p/<slug>`): ASCII so links and QR codes read the same everywhere. */
export const BUSINESS_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BUSINESS_SLUG_MAX_LENGTH = 80;

/** Owners type freely; capitals are folded so "Roni-Cuts" is accepted as "roni-cuts". */
export function businessSlugInput(value: string) {
  return value.toLowerCase();
}

export function isBusinessSlug(value: string) {
  return value.length <= BUSINESS_SLUG_MAX_LENGTH && BUSINESS_SLUG_PATTERN.test(value);
}

export function businessSlugPath(slug: string) {
  return `/p/${slug}`;
}
