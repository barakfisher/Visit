import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { env } from '../env.js';
import { prisma } from '../db/client.js';
import { AppError, conflict, notFound } from '../http/errors.js';
import { releaseHold } from './reservations.js';
import { withBookingTransaction } from './booking-transaction.js';
import type { FinalBookingInput, BookingAttemptResult } from './booking-attempts.types.js';
// Orchestration ownership has its own bounded pool; it never occupies a Prisma worker connection.
const ownership = new Pool({ connectionString: env.DATABASE_URL, max: 4, connectionTimeoutMillis: 1500, idleTimeoutMillis: 10000, allowExitOnIdle: true });
// pg discards broken idle clients; no active attempt may be rejected by an idle disconnect.
ownership.on('error', () => {});
export async function runBookingAttempt(input: FinalBookingInput, customerId: string, commit: () => Promise<BookingAttemptResult>): Promise<BookingAttemptResult> {
  const businessId = input.providerId, key = input.idempotencyKey, lockKey = JSON.stringify([businessId, key]);
  const fingerprint = createHash('sha256').update(JSON.stringify([customerId, businessId, input.serviceId, input.staffId, new Date(input.startsAt).toISOString(), input.reviewedService.name, input.reviewedService.durationMinutes, input.reviewedService.priceMinor, input.reviewedService.currency])).digest('hex');
  if (!await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } })) throw notFound();
  await prisma.bookingAttempt.createMany({ data: [{ businessId, customerId, idempotencyKey: key, fingerprint }], skipDuplicates: true });
  const registered = await prisma.bookingAttempt.findUniqueOrThrow({ where: { businessId_idempotencyKey: { businessId, idempotencyKey: key } } });
  if (registered.customerId !== customerId) throw notFound();
  if (registered.fingerprint !== fingerprint) throw conflict('This attempt was already used for different appointment details.');
  const lease = await ownership.connect().catch(() => { throw new AppError(503, 'ATTEMPT_PENDING', 'Retry the same booking attempt shortly.'); });
  let locked = false, lost = false;
  const lostOwnership = () => { lost = true; };
  lease.on('error', lostOwnership);
  try {
    const acquired = await lease.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [lockKey]).catch(() => { lost = true; throw new AppError(503, 'ATTEMPT_PENDING', 'Retry the same booking attempt shortly.'); });
    locked = acquired.rows[0]?.locked === true;
    if (!locked) throw new AppError(409, 'ATTEMPT_PENDING', 'This same booking attempt is still processing. Check its result shortly.');
    const attempt = await prisma.bookingAttempt.findUniqueOrThrow({ where: { id: registered.id } });
    const current = await prisma.booking.findFirst({ where: { businessId, customerId, idempotencyKey: key }, select: { id: true, status: true } });
    if (current && ['CONFIRMED', 'COMPLETED', 'NO_SHOW'].includes(current.status)) {
      await prisma.bookingAttempt.update({ where: { id: attempt.id }, data: { status: 'CONFIRMED', bookingId: current.id } });
      return current;
    }
    if (attempt.status === 'REJECTED' || current?.status === 'CANCELLED' || current?.status === 'EXPIRED' || attempt.status === 'CONFIRMED') throw new AppError(409, 'ATTEMPT_REJECTED', 'This attempt is no longer active. Choose another available time.');
    try {
      // No orchestration timeout releases ownership while independent writes are still running.
      const result = await commit();
      if (result.status !== 'CONFIRMED') throw conflict('The booking has not committed.');
      await prisma.bookingAttempt.update({ where: { id: attempt.id }, data: { status: 'CONFIRMED', bookingId: result.id } });
      return result;
    } catch (error) {
      if (!lost && error instanceof AppError && error.statusCode >= 400 && error.statusCode < 500 && ![408, 429].includes(error.statusCode)) {
        const final = await withBookingTransaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR SHARE`;
          await tx.$queryRaw`SELECT id FROM "BookingAttempt" WHERE id = ${attempt.id} FOR UPDATE`;
          const committed = await tx.booking.findFirst({ where: { businessId, customerId, idempotencyKey: key, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } }, select: { id: true, status: true } });
          if (committed) {
            await tx.bookingAttempt.update({ where: { id: attempt.id }, data: { status: 'CONFIRMED', bookingId: committed.id } });
            return { committed, expired: null };
          }
          const held = await tx.booking.findFirst({ where: { businessId, customerId, idempotencyKey: key, status: 'HELD' }, select: { id: true } });
          if (held) await tx.booking.updateMany({ where: { id: held.id, status: 'HELD' }, data: { status: 'EXPIRED', holdExpiresAt: null } });
          await tx.bookingAttempt.update({ where: { id: attempt.id }, data: { status: 'REJECTED', bookingId: held?.id ?? null } });
          return { committed: null, expired: held };
        });
        if (final.committed) return final.committed;
        if (final.expired) await releaseHold(final.expired.id, customerId).catch(() => {});
      }
      throw error;
    }
  } finally {
    if (locked && !lost) await lease.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]).catch(() => { lost = true; });
    lease.off('error', lostOwnership);
    lease.release(lost);
  }
}
