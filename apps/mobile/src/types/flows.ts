export type AuthProfile = { id: string; email: string | null; phone: string | null; preferredLocale?: 'he' | 'en' | null; is_provider: boolean; businesses: { id: string; name: string; timezone: string; role?: 'OWNER' | 'MANAGER' }[] };
export type Service = { id: string; name: string; description: string | null; durationMinutes: number; priceMinor: number | null; currency: string | null };
export type Provider = { id: string; name: string; timezone: string; location: string | null; category: string; rating: number | null };
export type ProviderDetail = Provider & { services: Service[]; weeklyAvailability: { weekday: number; startLocal: string; endLocal: string }[]; scheduleOverrides: { date: string; isOpen: boolean }[]; bookingPolicy: { maximumAdvanceDays: number } | null };
export type Slot = { startsAt: string; localTime: string; utcOffset: string; staffId: string; staffName: string; available: boolean; locked: boolean };
export type Hold = { holdId: string; expiresAt: string; startsAt: string; endsAt: string };
export type ActiveBooking = { id: string; startsAt: string; service: { id: string; name: string }; business: { id: string; name: string; timezone: string }; staff: { displayName: string } };
export function formatMoney(minor: number | null, currency: string | null) {
  return minor !== null && currency ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100) : 'Price on request';
}
