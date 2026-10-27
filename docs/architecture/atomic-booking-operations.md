# Authorized atomic appointment operations — VIS-30

## Contract

Customer `POST /v1/bookings/:bookingId/reschedule` and owner/manager `POST /v1/provider/businesses/:businessId/bookings/:bookingId/reschedule` require `finalConsent: true`, `expectedRevision`, a 16–128 character `idempotencyKey`, destination `staffId`, and either an offset-qualified `startsAt` or local date/time with explicit fold offset when ambiguous. Foreign customer/tenant IDs remain unavailable. Staff membership alone grants no management authority.

The private provider, calendar and availability reads require owned confirmed bookings, use the immutable reserved duration, and exclude only that appointment's occupancy. An archived service remains reschedulable if its active staff assignment remains valid; its original name/duration/price/currency survive. Unpublished approved businesses remain manageable. Removing a saved provider does not affect appointment ownership or management.

Browsing, selecting and reviewing replacement slots are advisory and write no booking, attempt or Redis reservation. Final consent executes a bounded serializable transaction with current session, business, membership (for provider operations) and booking row locks. It rechecks status/revision, current policy and contact requirements, complete duration/buffers, shared business/staff hours, active assignment, blocks and destination capacity. The existing PostgreSQL capacity trigger remains authoritative against competing requests.

Each worker acquires a separate opaque, owner-bound 30-second Redis reservation for the destination's complete occupied interval and revalidates ownership before writing. The database transaction timeout is five seconds. Old and new capacity change in the same booking update; there is no intermediate release of the original booking. A conflict, expired/missing lease, Redis outage, failed database write or rolled-back transaction preserves the original booking and occupancy. Compare-owner cleanup runs after completion; crashed leases expire. Redis and PostgreSQL are not one cross-store transaction.

A successful transaction also inserts `BookingReschedule`, uniquely keyed by booking and logical key, with a canonical staff/instant/expected-revision fingerprint. Retries reject changed details, skip new effects for committed keys, and return the booking's **current** owned state. A later cancellation or move is never overwritten by replay. A response lost after commit can be recovered through the same POST even if mutable policy/catalog/publication subsequently changes. The mobile store retains the key across navigation and uncertain responses in the running app, clearing on logout/account change; a full app reload reads current persisted details before another explicitly reviewed operation.

Customer/provider cancellation retains explicit UI confirmation, session/ownership/tenant checks, current cutoff rules and revision fencing. Missing customer cancellation policy fails closed. Repeated cancelled requests return the stable cancelled revision before stale-revision checks. One status transition releases capacity; subsequent retries cannot release another booking's capacity. Provider owners/managers may cancel under the existing provider policy; they do not gain cross-tenant access.

## Lifecycle notification intent

Trigger-generated immutable `BookingEvent` rows retain actor/source/reason, revision and exact old/new status, staff and instants. `BookingNotification` now records `BOOKING_CONFIRMED`, `BOOKING_RESCHEDULED` and `BOOKING_CANCELLED`, unique per event. The former per-booking uniqueness is replaced by a booking index. The event FK and immutable notification trigger preserve tenant isolation and prevent forged or edited intents. Notification rows become visible only with the booking commit; failed operations and duplicate retries create no new lifecycle intent. No historic reschedule/cancellation delivery is invented by migration.

Consumers must use the referenced event revision and snapshot, and recheck current state before any future external delivery. This task provides durable notification intent only. SMS/WhatsApp remain explicitly unsupported; no worker, outbound messaging or deployment is enabled.

## Client behavior

The compact Israel-time review and explicit final reschedule action retain one logical key during uncertain responses. Conflicts clear the contested candidate without silently selecting another time. Commit success invalidates appointment details, history, customer/provider lists and availability/calendar queries; confirmation refetches persisted details. Cancelled replay opens history. Pending cancellation disables its controls. Identity/context/mount/focus fences prevent delayed work from navigating a changed session. Private calendar keys and manual date searches include identity/context; logout and account changes clear reschedule attempts.

## Verification

Reproduce from repository root, running DB-backed API and browser suites sequentially:

```sh
npm run typecheck
npm run lint
NODE_ENV=test npm test --workspace @visit/api
npm run test:foundation --workspace @visit/mobile
npm run test-storybook --workspace @visit/mobile
VISIT_TEST_WEB_PORT=8083 npm run test:web --workspace @visit/mobile
```

From `apps/api`: `../../node_modules/.bin/tsc -p tsconfig.test.json --noEmit` and `../../node_modules/.bin/prisma migrate status`.
From `apps/mobile`: `NODE_PATH=./node_modules ../../node_modules/.bin/expo export --platform ios --platform android --output-dir /tmp/vis30-native`.

Fresh QA added `booking-operations.test.ts` and `booking-reschedule-session.test.ts`: duplicate moves/cancels, reschedule-versus-cancel (existing lifecycle suite), capacity reuse, foreign customer/provider tenant/role checks, revoked session, malformed inputs, immutable archived snapshots, contact/cutoff/missing policy failures, Redis outage/ownership loss, database failure after booking write, rollback of events/intents/key, retry cleanup, and logout/account isolation. The exported-web suite proves zero reschedule writes before consent, lost committed response recovery with the same key and one lifecycle notification, declined/accepted cancellation, persisted details, Hebrew RTL and traveler/DST behavior.

Fresh read-only Security audit found private calendar/search context fencing and reschedule-store cleanup gaps; both were fixed and re-reviewed with no outstanding concrete findings. Auditor did not execute DB/browser suites. QA executed isolated session tests and fixture compilation; the developer executes integrated suites.

Local validation passed on 2026-10-27: **244 API / 63 foundation / 71 Storybook tests**, complete exported-web journey, workspace typecheck/lint, API fixture compilation, 29 applied migrations and iOS/Android JavaScript exports. Logs: `/tmp/vis30-api-verified.log`, `/tmp/vis30-foundation-final.log`, `/tmp/vis30-storybook.log`, `/tmp/vis30-web-second.log`, `/tmp/vis30-types-complete.log`, `/tmp/vis30-lint-complete.log`, `/tmp/vis30-native.log`. Hosted workflow outcome is recorded against the PR head in the local handoff and Linear completion record; these local results do not establish hosted CI success. Native JavaScript exports do not establish physical-device calendar/auth behavior; live-provider/native release gates remain VIS-2 → VIS-43 → VIS-25. Existing user runtimes on 3000/8081/8082 remain untouched; browser tests use 3001/8083.
