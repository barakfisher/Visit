import type { AccountNavigation } from './navigation';
/** The device remembers which business its signed-in owner or manager last worked in (decisions.md, 2026-11-03).
 *  Only the two ids are kept; the server still decides access every time the workspace opens. */
export type RememberedProviderMode = { identityId: string; businessId: string };
export const PROVIDER_MODE_KEY = 'visit.providerMode';
export function parseProviderMode(raw: string | null): RememberedProviderMode | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && typeof (value as RememberedProviderMode).identityId === 'string' && typeof (value as RememberedProviderMode).businessId === 'string') return { identityId: (value as RememberedProviderMode).identityId, businessId: (value as RememberedProviderMode).businessId };
  } catch { /* A damaged entry is the same as none. */ }
  return null;
}
/** 'restore' reopens the business, 'forget' drops an entry that no longer applies, 'none' leaves Home as it is.
 *  `managed` is null when the account could not be read: the entry is kept for the next visit. */
export function providerModeOnHome(saved: RememberedProviderMode | null, identityId: string | null, managed: AccountNavigation['memberships'] | null): 'restore' | 'forget' | 'none' {
  if (!saved || !identityId) return 'none';
  if (saved.identityId !== identityId) return 'forget';
  if (!managed) return 'none';
  return managed.some(m => m.business.id === saved.businessId) ? 'restore' : 'forget';
}
