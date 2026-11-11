# Visit handoff — 2026-11-11, booking transactions at Repeatable Read

PR #67, built on `main` after PR #64. Decisions: `decisions.md`, "Booking transactions run at Repeatable Read". Mechanism and guarantees: `booking-capacity.md`, "PostgreSQL guard".

## Where things stand

- **`withBookingTransaction` runs at Repeatable Read** (`BOOKING_ISOLATION_LEVEL` in `scheduling/booking-transaction.ts`). It is the only place booking writes choose an isolation level. It still makes three bounded attempts, through `retrySerializable`.
- **The booking-attempt rejection step in `runBookingAttempt` runs at Read Committed** (`withAfterLockTransaction`). Nothing else does.
- **New tests:**
  - `cross-tenant-contention.test.ts`: six businesses reschedule at once, three rounds, and no move is refused.
  - `booking-attempt-rejection.test.ts`: replays the rejection race step by step, watching `pg_stat_activity` for the lock wait.
  - Both are in `test:security`.
- **`provider-agenda.test.ts`** now builds its stale reader at `BOOKING_ISOLATION_LEVEL`, not a hard-coded Serializable.

## Lessons

- **The CI 409 "Availability changed. Please retry." was unrelated businesses aborting each other under Serializable**, not a slow or flaky test.
  - SSI puts predicate locks on index leaf pages and heap pages. Time-ordered ids and concurrent inserts make those pages shared between tenants. A tiny table (CI's fresh database) is locked whole by a seq scan.
  - Postgres logs name it: `Canceled on identification as a pivot`.
  - A single test file rarely shows it. Four processes rescheduling in four businesses failed 28%.
- **To measure contention, amplify it with separate tenants. Don't rerun the suite.** Twelve full-suite runs at concurrency 2 never failed locally, and the suite plus a loop failed once in 4,500. Parallel loops on separate businesses show it at once.
- **Retry delays can make SSI contention worse.** Jittered backoff took two writers from 0 to up to 87 failures in 800, because a delayed retry lands on the partner's next transaction.
- **At Repeatable Read, waiting on a row another transaction only locked (`FOR SHARE`) refuses nothing.** Only an update of the row does. Any step that must see what committed while it waited needs Read Committed or a row the other side updates.
- **Tests run against a disposable database.** Point `DATABASE_URL` at a throwaway one (for example `visit_flake` on the local Postgres) and recreate it with `DROP DATABASE … WITH (FORCE)` before each run. Leftover rows make SSI page locks finer and hide this class of bug.

## Debt

- **Isolation no longer catches write skew between booking writes.** A new invariant that two booking transactions could break without updating a common row needs a lock, a constraint, a trigger or a Read Committed re-read. `booking-capacity.md` lists what guards each race today.
- **A future card unlink path must update the card row**, not only lock it. `lockCustomerOwnedBooking` takes the card `FOR SHARE`, and only an update refuses its snapshot.
- **The same phone can end up on a linked and an unlinked card of one business.** This happens when a hand-saved card races a customer's own booking. SSI did not prevent it either. Decide whether one card per phone is an invariant.
- **`retrySerializable` keeps its name** although no booking transaction is Serializable now. Repeatable Read's write conflicts are the same SQLSTATE (40001).

## Not verified

- **CI itself.** Every check ran locally against PostgreSQL 16 (CI uses 16-alpine too). The first CI run of the PR is the check.
