import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { runBookingAttempt } from '../src/scheduling/booking-attempts.service.js';
import { BOOKING_ISOLATION_LEVEL } from '../src/scheduling/booking-transaction.js';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

const LOCK_WAIT_POLL_MS = 20;
const LOCK_WAIT_LIMIT_MS = 5000;

// Resolves once a backend is blocked by the hold's own transaction: the rejection step then waits behind the hold.
async function blockedBy(holdPid: number) {
  const deadline = Date.now() + LOCK_WAIT_LIMIT_MS;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ waiting: number }[]>`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE ${holdPid}::int = ANY(pg_blocking_pids(pid))`;
    if (rows[0]!.waiting > 0) return;
    await new Promise(resolve => setTimeout(resolve, LOCK_WAIT_POLL_MS));
  }
  throw new Error('The rejection step never waited on the hold.');
}

test('a rejected attempt expires a hold of the same key that committed while the rejection waited', async () => {
  const suffix = randomUUID();
  const business = await prisma.business.create({ data: { publishedAt: new Date(), location: 'Synthetic fixture', name: 'Rejection fixture', slug: `rejection-${suffix}`, timezone: 'UTC', approvalStatus: 'APPROVED' } });
  const identity = await prisma.identity.create({ data: { email: `rejection-${suffix}@example.test` } });
  try {
    const service = await prisma.service.create({ data: { businessId: business.id, name: 'Rejection service', durationMinutes: 30 } });
    const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Rejection staff', parallelCapacity: 1 } });
    await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
    await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
    const startsAt = new Date(`${new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)}T09:00:00Z`);
    const input = { providerId: business.id, serviceId: service.id, staffId: staff.id, startsAt: startsAt.toISOString(), idempotencyKey: randomUUID(), reviewedService: { name: service.name, durationMinutes: 30, priceMinor: null, currency: null } };
    let releaseHold!: () => void;
    const holdMayCommit = new Promise<void>(resolve => { releaseHold = resolve; });
    let concurrentHold: Promise<unknown> | undefined;
    let reportPid!: (pid: number) => void;
    const holdPid = new Promise<number>(resolve => { reportPid = resolve; });
    // The attempt's own commit loses (409) while a second request with the same key is inserting its hold.
    const attempt = runBookingAttempt(input, identity.id, async () => {
      let inserted!: () => void;
      const holdInserted = new Promise<void>(resolve => { inserted = resolve; });
      concurrentHold = prisma.$transaction(async tx => {
        reportPid((await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
        await tx.booking.create({ data: { businessId: business.id, customerId: identity.id, staffId: staff.id, serviceId: service.id, startsAt, endsAt: new Date(+startsAt + 1800000), occupiedFrom: startsAt, occupiedUntil: new Date(+startsAt + 1800000), status: 'HELD', holdExpiresAt: new Date(Date.now() + 300000), idempotencyKey: input.idempotencyKey } });
        inserted();
        await holdMayCommit;
      }, { isolationLevel: BOOKING_ISOLATION_LEVEL, timeout: LOCK_WAIT_LIMIT_MS * 2 });
      await holdInserted;
      throw new AppError(409, 'SLOT_TAKEN', 'Synthetic loss to the concurrent hold.');
    });
    const outcome = attempt.then(() => null, (error: unknown) => error);
    await blockedBy(await holdPid);
    releaseHold();
    await concurrentHold;
    const error = await outcome;
    assert.ok(error instanceof AppError && error.statusCode === 409, String(error));
    const ledger = await prisma.bookingAttempt.findUniqueOrThrow({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: input.idempotencyKey } } });
    assert.equal(ledger.status, 'REJECTED');
    const booking = await prisma.booking.findUniqueOrThrow({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: input.idempotencyKey } } });
    // A hold the rejected attempt can never confirm must not keep occupying the slot.
    assert.equal(booking.status, 'EXPIRED');
    assert.equal(ledger.bookingId, booking.id);
  } finally {
    await prisma.booking.deleteMany({ where: { businessId: business.id } });
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.identity.delete({ where: { id: identity.id } });
  }
});
