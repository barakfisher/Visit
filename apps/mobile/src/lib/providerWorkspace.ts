import type { ProviderBusiness } from '../types/flows';
export type ManagedBusiness = ProviderBusiness;
/** A worker's own calendar, or null for the whole business (owner, manager). The server scopes every read anyway. */
export const workerCalendar = (business: Pick<ProviderBusiness, 'role' | 'calendar'>) => business.role === 'STAFF' && business.calendar ? business.calendar : null;
/** URL selectors never silently fall back to another tenant. */
export function resolveProviderWorkspace(businesses: ManagedBusiness[], requested: unknown, active: string | null): { state: 'allowed'; business: ManagedBusiness } | { state: 'choose' } | { state: 'denied' } {
  if (requested !== undefined) {
    if (typeof requested !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requested)) return { state: 'denied' as const };
    const business = businesses.find(b => b.id === requested);
    return business ? { state: 'allowed' as const, business } : { state: 'denied' as const };
  }
  const selected = businesses.find(b => b.id === active);
  if (selected) return { state: 'allowed' as const, business: selected };
  if (businesses.length === 1) return { state: 'allowed' as const, business: businesses[0]! };
  return { state: businesses.length ? 'choose' as const : 'denied' as const };
}
