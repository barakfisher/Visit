import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { conflict } from '../http/errors.js';

export function isDatabaseCapacityError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return ('message' in error && String(error.message).includes('VISIT_BOOKING_CAPACITY')) ||
    ('meta' in error && JSON.stringify(error.meta).includes('VISIT_BOOKING_CAPACITY'));
}

export async function retrySerializable<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new RangeError('Transaction attempts must be between one and three.');
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (isDatabaseCapacityError(error)) throw conflict('That time has no remaining capacity. Choose another time.');
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2034') throw error;
      if (attempt === attempts - 1) throw conflict('Availability changed. Please retry.');
    }
  }
  throw conflict('Availability changed. Please retry.');
}

export function withBookingTransaction<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>) {
  return retrySerializable(() => prisma.$transaction(work, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 5000 }));
}
