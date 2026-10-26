import { z } from 'zod';
export const reviewedServiceSchema = z.strictObject({ name: z.string(), durationMinutes: z.number().int(), priceMinor: z.number().int().nullable(), currency: z.string().nullable() });
