import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { AppError, conflict } from '../http/errors.js';

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
  if ('code' in error && error.code === 'P2010' && 'meta' in error && error.meta && typeof error.meta === 'object') {
    if ('code' in error.meta && (error.meta.code === '40001' || error.meta.code === '40P01')) return true;
    if ('driverAdapterError' in error.meta) return isAdapterTransactionConflict(error.meta.driverAdapterError);
  }
  return isAdapterTransactionConflict(error);
}
function isAdapterTransactionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return 'name' in error && error.name === 'DriverAdapterError' && 'cause' in error &&
    !!error.cause && typeof error.cause === 'object' && 'kind' in error.cause && error.cause.kind === 'TransactionWriteConflict';
}

export async function retrySerializable<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new RangeError('Transaction attempts must be between one and three.');
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (error && typeof error === 'object' && (('message' in error && String(error.message).includes('VISIT_BUSINESS_UNPUBLISHED')) || ('meta' in error && JSON.stringify(error.meta).includes('VISIT_BUSINESS_UNPUBLISHED')))) throw conflict('This business is not published for bookings.');
      if (error && typeof error === 'object' && (('message' in error && String(error.message).includes('VISIT_CUSTOMER_CONTACT_REQUIRED')) || ('meta' in error && JSON.stringify(error.meta).includes('VISIT_CUSTOMER_CONTACT_REQUIRED')))) throw new AppError(409, 'CUSTOMER_CONTACT_REQUIRED', 'Complete this business’s required verified contact details before booking.');
      if (error && typeof error === 'object' && (('message' in error && String(error.message).includes('VISIT_ATTEMPT_REJECTED')) || ('meta' in error && JSON.stringify(error.meta).includes('VISIT_ATTEMPT_REJECTED')))) throw new AppError(409, 'ATTEMPT_REJECTED', 'This booking attempt is no longer active.');
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
