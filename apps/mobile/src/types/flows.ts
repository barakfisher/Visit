import type { MemberSwitches, MembershipRole } from '../lib/MemberSwitches';
export type AuthProfile = { id: string; email: string | null; phone: string | null; preferredLocale?: 'he' | 'en' | null; is_provider: boolean; businesses: ProviderBusiness[] };
/** The calendar (staff row) a worker is linked to; `active` false means it takes no new bookings (worker-access.md). */
export type WorkerCalendar = { id: string; displayName: string; active: boolean };
/** A business the person opens provider mode for. A worker's entry carries their calendar, and provider mode is then their own My day. */
/** `switches` says what provider mode opens (decisions.md, "Switches"); a calendar is sent only to a member who does not see every calendar. */
export type ProviderBusiness = { id: string; name: string; timezone: string; role?: MembershipRole; switches?: MemberSwitches; calendar?: WorkerCalendar };
export type Service = { id: string; name: string; description: string | null; durationMinutes: number; priceMinor: number | null; currency: string | null };
export type Provider = { id: string; name: string; timezone: string; location: string | null; category: string | null; rating: number | null };
/** The API also returns the owner's public contact details; each may be missing. */
export type ProviderDetail = Provider & { description?: string | null; contactPhone?: string | null; contactEmail?: string | null; services: Service[]; weeklyAvailability: { weekday: number; startLocal: string; endLocal: string }[]; bookingPolicy: { maximumAdvanceDays: number; cancellationCutoffMinutes?: number; rescheduleCutoffMinutes?: number } | null };
export type Slot = { startsAt: string; localTime: string; utcOffset: string; staffId: string; staffName: string; available: boolean; locked: boolean };
export type Hold = { holdId: string; expiresAt: string; startsAt: string; endsAt: string };
export type ActiveBooking = { id: string; startsAt: string; service: { id: string; name: string }; business: { id: string; name: string; timezone: string }; staff: { displayName: string } };
export function formatMoney(minor: number | null, currency: string | null) {
  return minor !== null && currency ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100) : 'Price on request';
}
