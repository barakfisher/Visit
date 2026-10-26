# Final-consent booking protocol (VIS-26)

Browsing, service/date changes, advisory slot selection, review, name editing and contact verification perform no Redis reservation or PostgreSQL booking write. The review states the exact business, service, staff, local appointment instant, duration, price, cancellation cutoff and required contacts. The explicit final action starts one logical attempt. Reservation countdowns are absent from browsing.

## Persisted intent and ownership

`POST /api/bookings/commit` requires explicit final consent and the reviewed service snapshot. Migration24 persists an identity-bound BookingAttempt with a hash of business, service, staff, normalized instant and reviewed service fields. Reusing its key with different details is rejected; another identity cannot recover it. The attempt is durable before reservation work starts.

A separate bounded pg pool holds a nonblocking session advisory lock for each business/key while orchestration executes. It does not occupy the Prisma transaction pool and has no transaction deadline that could release ownership while independent writes continue. Acquisition failures destroy the connection; idle-client errors are contained. Concurrent same-key requests return ATTEMPT_PENDING and retain the original key.

The server creates a bounded provisional HELD row, atomically acquires the complete interval's Redis minute buckets and owner metadata, then confirms through the authoritative PostgreSQL transaction. These stores are not one atomic transaction. A crash before Redis leaves a bounded provisional row that the same intent may resume. Redis retries never extend the original database deadline. Unknown transport outcomes remain PENDING. A committed booking is recoverable even if the HTTP response or Redis cleanup was lost.

A definitive rejection expires any owned provisional booking and releases its reservation. Finalization rereads committed state under database locks before recording REJECTED. Migration25 fences late HELD/CONFIRMED persistence against a rejected intent or a different customer. Previously confirmed history is retained. Failed/expired attempts are never shown as successful appointments.

## Authoritative final validation

Both compatibility and v1 confirmation require current publication/approval, unchanged active service and staff assignment, current policy window, working hours, duration/buffers, time blocks, full Redis ownership and the unexpired database deadline. Existing PostgreSQL triggers remain authoritative for staff capacity and current verified contact policy. Confirmation locks business, attempt and booking in a consistent order. Direct legacy confirmation cannot bypass Redis ownership.

Redis acquisition writes ownership metadata and every minute member in one Lua operation. Validation checks the exact metadata and every member using Redis time. Release compares the current raw ownership record before deleting only that booking's members. Acquisition and retry do not renew a deadline. Redis loss cannot bypass PostgreSQL capacity/contact constraints or manufacture confirmation.

`GET /api/bookings/attempts` returns only the authenticated customer's attempt state. Durable committed results are recovered before mutable publication/contact/service checks; v1 instant and local-date/time retries both match the original instant. Legacy hold endpoints require explicit final consent. Their optional reviewed-service assertion preserves compatibility; the final application endpoint always requires it, and all confirmation paths revalidate the current service against the captured snapshot.

## Client recovery

A synchronous operation guard blocks duplicate taps. The identity-bound in-memory attempt retains its idempotency key across navigation. A 409, recovery 404 or outage cannot discard an uncertain key; only an authoritative cancelled/expired outcome permits a new attempt. A pending attempt in another business is resumed before starting another booking. Logout and account changes clear another identity's local attempt.

Late results from an unmounted or blurred screen do not navigate. Re-entering booking can recover the same committed result. Leaving after final consent does not cancel an already authorized commit. On a definitive conflict, the stale selection is cleared and provider/contact/availability data refreshed; a different time is never silently substituted. API calls, hooks, state, types, utilities and presentation remain separate.

## Independent reviews

Fresh QA added reservation input-boundary tests and attempt/recovery unit tests. It checked null/expired deadlines, invalid capacity, reversed/empty/oversized intervals, exact key retention, nullable prices and terminal-only clearing. Initial concerns about contact/capacity rechecks were retracted after reviewing the existing authoritative SQL triggers. QA performed no concurrent database test run.

Fresh static Security audit identified an uncertain-key race, followed by the outer-transaction lifetime risk and an idle-pool error edge. All were fixed and re-reviewed. The audit reviewed ownership, fingerprints, tenant binding, injection, data exposure, expiry, full interval checks, release comparison and database fencing. No unresolved security blocker remained; security review itself did not execute runtime or database checks.

## Verification and boundaries

Local verification on 2026-10-26:

- `NODE_ENV=test npm test --workspace @visit/api`: 204 passing, including the 21-second orchestration ownership test, late-worker database fence, server restart, stale review/current settings, complete ownership and expiry.
- `npm run test:foundation --workspace @visit/mobile`: 41 passing.
- `npm run test-storybook --workspace @visit/mobile`: 55 passing.
- `VISIT_TEST_WEB_PORT=8083 npm run test:web --workspace @visit/mobile` (and the same harness against the final exported bundle): complete regression passed, including review with zero booking writes, lost-response recovery, delayed response without navigation, same-attempt recovery after re-entry, simultaneous final attempts, tenant recovery and DST/travel cases.
- `npm run typecheck`, `npm run lint`, API `tsc -p tsconfig.test.json --noEmit`: passed.
- Prisma migration status: 25 migrations applied; migration24 intent ledger and migration25 terminal-worker guard were added without changing applied migrations.
- Expo iOS/Android JavaScript exports: passed at `/tmp/vis26-native`.

 Tests use real local PostgreSQL/Redis with synthetic delivery boundaries. Hosted Actions billing and VIS-2 → VIS-43 → VIS-25 installed-native/live-provider gates remain separate. No deployment or real outbound message is part of this change. Existing API3000/Metro8081 and orphan Expo8082 processes are preserved; exported-web regression uses port8083.

Implementation PR: https://github.com/barakfisher/Visit/pull/11. Code commit: 4ebbdf0f6a12a41b3071e7a9cbf0033cd4976c18. Hosted Actions run40319031356/job121558904554 executed zero steps; GitHub reported failed account payments or a spending-limit restriction. This is not passing hosted CI.
