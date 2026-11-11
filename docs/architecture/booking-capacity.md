# Booking coordination and capacity guards (VIS-5)

## Scope

This foundation protects occupied intervals and staff capacity. VIS-26 owns authoritative hold/confirm integration and business-policy revalidation; VIS-17 owns independent concurrency stress testing. Passing these foundation tests does not close either issue.

## Redis mutex contract

`redis-slot-lock.ts` atomically acquires every whole-minute bucket in the full occupied interval, including buffers. Keys encode business and staff IDs, in ascending time order. Intervals are half-open: adjacent intervals share no bucket. Inputs must be minute-aligned, positive, and at most 72 hours.

Each acquisition has a random owner token. Lua checks all keys before setting any. The default mutex TTL is 30 seconds, bounded to 1–30,000 ms; attempts default to one and are bounded to three. These short transaction mutexes are separate from customer reservation countdowns. Release compares ownership atomically, so an expired owner cannot remove a replacement owner's keys. Worker death is recovered by expiry. Cleanup failure returns false without undoing an already committed database operation.

Redis readiness or acquisition failure returns HTTP 503 `LOCK_UNAVAILABLE`; it never fabricates a successful acquisition. Contention returns an unsuccessful acquisition. Redis coordination reduces conflicting work; PostgreSQL remains authoritative if the mutex expires or a writer bypasses it.

## PostgreSQL guard

Migration `20261024180000_booking_capacity_guard` adds positive capacity, valid occupied interval and held-expiry constraints. It refuses existing over-capacity active data rather than rewriting bookings. Deployment must reconcile such data before retrying. Migration locks have a five-second acquisition deadline.

Booking writes lock and update the corresponding staff rows, in canonical business/staff order. A volatile SQL sweep counts peak occupancy across the entire occupied interval: confirmed bookings and unexpired holds consume capacity; expired holds and cancelled bookings do not. End events precede start events, allowing adjacency. Capacity may exceed one. Capacity reductions cannot invalidate active allocations. Raw Prisma/SQL writers are covered by the trigger too.

The intentional staff row update makes stale Repeatable Read writers retry. `withBookingTransaction` runs at Repeatable Read (`BOOKING_ISOLATION_LEVEL`) and retries only serialization/deadlock conflicts (Prisma P2034, raw-query 40001/40P01, the adapter's `TransactionWriteConflict`), at most three times, with five-second transaction and acquisition limits. Capacity violations and exhausted retries become HTTP 409. Other errors retain their original meaning.

Booking transactions are Repeatable Read, not Serializable (PR #67; decisions.md, "Booking transactions run at Repeatable Read"). Every race between two booking writes is decided by something Repeatable Read enforces: the staff row update above (capacity, including staff changes), `FOR UPDATE` on the booking (two changes to one appointment), unique keys and attempt rows that the winner updates (idempotency), and `Business FOR SHARE` against the configuration writers' `FOR UPDATE` plus row-version update (hours, blocks, services, policy, publication; those writers are Read Committed, so Serializable never covered them). Serializable added only predicate locks, on index and heap pages that unrelated businesses share; four concurrent reschedules in four different businesses failed 28% of the time after three attempts. Repeatable Read refuses a stale snapshot only on a row the other transaction *updated*: waiting on a row it merely locked `FOR SHARE` refuses nothing. The hold guard trigger only shares the `BookingAttempt` row, so the attempt rejection step (`runBookingAttempt`) runs at Read Committed (`withAfterLockTransaction`) and reads a hold of its key that committed while it waited, then expires it. A new invariant that two booking writes could break without updating a common row needs a row to update, a constraint, a trigger or a Read Committed re-read after the lock; isolation will not catch it. `cross-tenant-contention.test.ts` keeps unrelated businesses independent; `booking-attempt-rejection.test.ts` replays the rejection race step by step.

The guard validates stored occupied intervals, not all booking eligibility rules. Publication, contact requirements, working hours, and recomputation from current service/buffer policies belong in VIS-16/VIS-26. Multi-resource batch contention, prolonged load, and broader failover scenarios remain VIS-17. A privileged database owner can disable triggers; production role restrictions belong in infrastructure/security work.

## Reproducible checks

- `npm test --workspace @visit/api`: lock expiry/stale release, overlap/adjacency, key scope, bounded attempts, Redis failure, capacity one/two without Redis, buffer conflicts, expiry/reactivation, rollback, idempotency, and rescheduling past expired holds.
- `npm run typecheck` and `npm run lint`.
- `node apps/api/scripts/infra-smoke.mjs --api-tests`: fresh migrations and API suite in isolated Docker resources, followed by readiness/outage/recovery checks. For committed-source evidence, run this from a clean `git archive` and set `VISIT_TEST_COMMIT`.
- Mobile browser regression: `NODE_PATH=./node_modules npx tsx scripts/web-smoke.mts` from `apps/mobile`, using its configured API/browser fixtures.

Database rationale: PostgreSQL documents [row locking](https://www.postgresql.org/docs/16/explicit-locking.html), [transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html), and [volatile function snapshot behavior](https://www.postgresql.org/docs/16/xfunc-volatility.html).
