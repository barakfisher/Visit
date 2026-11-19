import type { ProviderBusiness } from '../types/flows';
import { MEMBER_SWITCHES, type MemberSwitch } from './MemberSwitches';
export type ManagedBusiness = ProviderBusiness;
/** A worker's own calendar, or null for the whole business (the owner, or a member who sees every calendar). The server scopes every read anyway. */
export const workerCalendar = (business: Pick<ProviderBusiness, 'role' | 'switches' | 'calendar'>) => business.role !== 'OWNER' && !business.switches?.seeAllCalendars && business.calendar ? business.calendar : null;
/** The calendar a member is linked to, whatever else they see; an owner has none (decisions.md, "My day for a worker"). */
export const ownCalendar = (business: Pick<ProviderBusiness, 'role' | 'calendar'>) => business.role !== 'OWNER' ? business.calendar ?? null : null;
/**
 * Whether Add appointment has somewhere to go: every calendar with "act" (once setup is done, for those who do setup),
 * else the member's own calendar while it takes bookings. "See" alone adds nothing (decisions.md, "Switches").
 */
export const mayAddAppointment = (business: Pick<ProviderBusiness, 'role' | 'switches' | 'calendar'> | undefined, setupReady: boolean) =>
  !business ? false : mayUse(business, 'actOnAllCalendars') ? (mayUse(business, 'businessSetup') ? setupReady : true) : ownCalendar(business)?.active ?? false;
/** Whether provider mode shows what a switch opens. The owner holds every switch; the server refuses anything else anyway. */
export const mayUse = (business: Pick<ProviderBusiness, 'role' | 'switches'> | undefined, name: MemberSwitch) => !!business && (business.role === 'OWNER' || !!business.switches?.[name]);
/** Changes when anything provider mode shows depends on changes: role, switches or calendar. */
export const workspaceKey = (business: Pick<ProviderBusiness, 'role' | 'switches' | 'calendar'>) => [business.role, ...MEMBER_SWITCHES.map(name => business.switches?.[name] ? 1 : 0), business.calendar?.id ?? ''].join(':');
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
