import type { Slot } from './flows';
export type BookingContactDraft = { identityId: string; providerId: string; serviceId: string; date: string; selected: Slot | null };
export type BookingContactReadiness = { ready: boolean; missing: string[]; requirements: { requireCustomerName: boolean; requireVerifiedPhone: boolean; requireVerifiedEmail: boolean }; profile: { displayName: string | null } };
