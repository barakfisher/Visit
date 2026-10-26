export type FinalBookingInput = { providerId: string; serviceId: string; staffId: string; startsAt: string; idempotencyKey: string; reviewedService: { name: string; durationMinutes: number; priceMinor: number | null; currency: string | null } };
export type BookingAttemptResult = { id: string; status: string };
