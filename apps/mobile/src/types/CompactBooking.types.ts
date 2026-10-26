import type { ProviderDetail, Slot } from './flows';
export type BookingCalendar = { timezone: string; today: string; maximumDate: string; advisory: boolean; days: { date: string; available: boolean }[] };
export type CalendarCell = { date: string; day: string; label: string; available: boolean; selected: boolean } | null;
export type BookingChoice = { id: string; label: string; summary: string; selected: boolean };
export type AdvisorySelection = { providerId: string; serviceId: string; date: string; slot: Slot };

export type CompactBookingInput = { provider: ProviderDetail | undefined; providerId: string; serviceId: string; date: string; fromBookingId: string | undefined; slots: readonly Slot[]; excluded: string | null; disabled: boolean; onDate: (date: string) => void; onService: (id: string) => void; onReset: () => void };
