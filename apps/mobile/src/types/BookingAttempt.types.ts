export type BookingAttempt = { identityId: string; providerId: string; serviceId: string; staffId: string; startsAt: string; idempotencyKey: string; reviewedService: { name: string; durationMinutes: number; priceMinor: number | null; currency: string | null } };
export type BookingOutcome = { id: string; status: 'PENDING' | 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' };
