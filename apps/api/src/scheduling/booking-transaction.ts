import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { conflict } from '../http/errors.js';

export function isDatabaseCapacityError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return ('message' in error && String(error.message).includes('VISIT_BOOKING_CAPACITY')) ||
    ('meta' in error && JSON.stringify(error.meta).includes('VISIT_BOOKING_CAPACITY'));
}

// The pg adapter can surface a serialization/deadlock failure at COMMIT as a
// DriverAdapterError, before Prisma wraps it as P2034. Match structured types;
// a message substring is not sufficient grounds to replay a transaction.
export function isTransactionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === 'P2034') return true;
  return 'name' in error && error.name === 'DriverAdapterError' && 'cause' in error &&
    !!error.cause && typeof error.cause === 'object' && 'kind' in error.cause && error.cause.kind === 'TransactionWriteConflict';
}

export async function retrySerializable<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new RangeError('Transaction attempts must be between one and three.');
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (error && typeof error === 'object' && (('message' in error && String(error.message).includes('VISIT_BUSINESS_UNPUBLISHED')) || ('meta' in error && JSON.stringify(error.meta).includes('VISIT_BUSINESS_UNPUBLISHED')))) throw conflict('This business is not published for bookings.');
      if (isDatabaseCapacityError(error)) throw conflict('That time has no remaining capacity. Choose another time.');
      if (!isTransactionConflict(error)) throw error;
      if (attempt === attempts - 1) throw conflict('Availability changed. Please retry.');
    }
  }
  throw conflict('Availability changed. Please retry.');
}

export function withBookingTransaction<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>) {
  return retrySerializable(() => prisma.$transaction(work, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 5000 }));
}
