import type { MessageKey } from '../i18n/messages';
import type { CompactBookingControlsProps } from '../../components/CompactBookingControls.types';
export type ManualService = { id: string; name: string; durationMinutes: number; priceMinor: number | null; currency: string | null; staff: { id: string; displayName: string; parallelCapacity: number }[] };
export type ManualOptions = { timezone: string; bookable: boolean; services: ManualService[] };
/** The time comes from a free slot, which also brings its staff member and UTC offset; nothing here is typed except the customer. */
/** A business's saved customer as the sheet shows it: name plus phone (or email for an app customer without one). */
export type CustomerCardSummary = { id: string; name: string | null; phone: string | null; email: string | null; linked: boolean };
/** The customer is a picked card, or typed; a typed one is saved as a card unless the business turns that off (customer-cards.md). */
export type ManualDraft = { customerCard: CustomerCardSummary | null; saveCustomer: boolean; open: boolean; serviceId: string; staffId: string; localDate: string; localTime: string; utcOffset: string; customerName: string; customerPhone: string; customerEmail: string; reviewed: boolean };
export type ManualInput = { finalConsent: true; idempotencyKey: string; serviceId: string; staffId: string; localDate: string; localTime: string; utcOffset?: string; customerName: string; customerPhone: string; customerEmail?: string; customerCardId?: string; saveCustomer?: boolean; reviewedService: { name: string; durationMinutes: number; priceMinor: number | null; currency: string | null } };
export type ManualResult = { customerCard?: { id: string } | null; id: string; status: string; startsAt: string; endsAt: string; revision: number; source: 'MANUAL'; contactVerification: 'UNVERIFIED'; notification: 'NOT_SENT' };
/** The service, date and time controls are the customer booking's own (decisions.md, 2026-11-11). */
export type ManualSlotPicking = Omit<CompactBookingControlsProps, 't'> & { staff: { id: string; displayName: string }[]; staffFilter: string; onStaffFilter: (id: string) => void; slotLabel: string };
/** The customer field's search over this business's own cards. A failed search never blocks typing a new customer. */
export type ManualCustomerPicking = { suggestions: CustomerCardSummary[]; searching: boolean; searchError: boolean; searched: boolean; phoneMatch: CustomerCardSummary | null; onRetrySearch: () => void; onPick: (card: CustomerCardSummary) => void; onClearPick: () => void };
export type ManualBookingView = { customer: ManualCustomerPicking; t: (key: MessageKey, values?: Record<string, string | number>) => string; draft: Readonly<ManualDraft>; options: ManualOptions | undefined; loading: boolean; loadError: boolean; busy: boolean; locked: boolean; feedback: string; success: boolean; serviceSummary: string; picking: ManualSlotPicking | null; update: (patch: Partial<ManualDraft>) => void; retry: () => void; review: () => void; confirm: () => void; close: () => void };
