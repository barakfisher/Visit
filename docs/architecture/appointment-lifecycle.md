# Appointment lifecycle — VIS-39

Customer-facing **Scheduled** is persisted `CONFIRMED`. `HELD` and `EXPIRED` remain provisional reservation states and do not appear in customer appointment history or provider agenda. New unconfirmed hold cancellations also stay outside appointment history. Existing durable rows receive an explicitly labeled migration baseline: earlier actors, edits and original confirmation timestamps are unknown and are not invented. A legacy Cancelled baseline preserves that persisted state without asserting the earlier hold was ever confirmed.

## Permissions and transitions

| Actor | Allowed operations |
| --- | --- |
| Customer | Read own appointments/events and cancel an owned active appointment within the current cancellation cutoff. |
| Active approved-business owner/manager | Read that business's appointments/events; cancel an active appointment; mark an ended scheduled appointment Completed or No-show. |
| Staff membership | Staff membership grants no provider lifecycle authority. Own customer records remain accessible. The schema has no identity-to-staff resource assignment for enforcing narrower provider access. |
| Other identity/tenant | No access, even with substituted booking/business IDs. |

`CONFIRMED` can become `CANCELLED`, `COMPLETED` or `NO_SHOW`. Completed and no-show decisions are accepted only after `endsAt`. Terminal states cannot be reactivated or rescheduled. Repeating the same authorized outcome succeeds without another event. Competing outcomes conflict rather than overwrite each other. The database enforces transitions, immutable terminal intervals and an incrementing revision. Outcome requests require the displayed revision; cancellation accepts a revision while retaining compatibility with existing clients. Customer cancellation rechecks the current cutoff under the booking lock. Rescheduling uses a revision comparison to reject a competing mutation.

The mutation service revalidates the session and active owner/manager membership inside a serializable transaction with session/membership/business/booking locks. Its retry helper recognizes structured Prisma/adapter serialization errors, including nested `P2010` raw-query errors. It never retries merely because a message contains conflict text.

Completed/no-show intervals remain capacity-bearing in PostgreSQL and the shared availability engine. Recording an outcome cannot reopen the elapsed interval or its buffer, and direct historical inserts still face the capacity fence. Cancelled intervals release capacity. A provider's agenda count excludes cancellation; expected revenue includes Scheduled/Completed prices and excludes Cancelled/No-show outcomes. Revenue remains an estimate, not payment evidence.

## Audit and snapshots

`BookingEvent` is business-owned through its composite `(businessId, bookingId)` reference. An AFTER trigger appends creation, reschedule, cancellation, completion and no-show events in the same transaction as the booking mutation. Each event stores revision, actor identity ID, time, allowlisted source/reason, old/new status, old/new absolute start/end and staff IDs. Server code sets transaction-local audit context from authenticated authority; request bodies cannot choose it. No free-text reason, contact, credential, token or IP is copied into the event. Missing privileged/system context is labeled `SYSTEM`, not attributed to a customer.

Direct event insertion, update and deletion are rejected by a database trigger. The explicit retention exception is privileged deletion of the parent Booking, which cascades its events. There is no customer/provider Booking deletion API. Fixture cleanup uses that parent deletion only for its own IDs. Operational retention periods and privileged privacy purge approval remain release operations policy; the application does not promise a legal retention period or expose an audit-redaction bypass. Events retain pseudonymous actor IDs without a mutable identity/contact join. Public-facing history projections omit those actor IDs and contact snapshots. Event APIs are read-only and scope every lookup to the owning customer or authorized business.

The existing database-enforced service name/duration/price/currency snapshot remains the historical authority after catalog edits or archiving. VIS-36 operational contact snapshots retain their existing protections. Removing a saved provider does not remove owned appointments or events.

`GET /v1/bookings/:bookingId/history` is customer-owned. `GET /v1/provider/businesses/:businessId/bookings/:bookingId/history` requires owner/manager authorization. Provider completion/no-show uses `POST /v1/provider/businesses/:businessId/bookings/:bookingId/outcome` with `{ status, expectedRevision }`; cancellation retains the existing routes. There is no event mutation endpoint.

The customer appointment screen now includes persisted history and audit expansion. The provider agenda shows all durable statuses with local-time details and authorized lifecycle controls. All new labels support Hebrew RTL and English LTR. A clock-boundary timer enables ended-appointment actions even when polling returns structurally unchanged data. Cancellation rechecks the initiating identity, context version, active business and mounted state after confirmation, immediately before mutation. Query keys isolate identity, context, business, appointment and revision.

A completed/no-show appointment is still a committed booking attempt. Recovery returns that existing result, preserves its idempotency identity, clears the pending client attempt and routes to appointment history without reserving again. VIS-28 still owns the expanded post-commit success/calendar work; VIS-30 owns further rescheduling/cancellation UX and idempotency integration.

## Verification

Local verification on 2026-10-26: **223 API, 58 foundation and 65 Storybook tests pass**, alongside the full exported-web journey, workspace typecheck/lint, API fixture compilation, 27 applied migrations and iOS/Android JavaScript exports. API integration covers role denial, current membership, owned/foreign reads, future and stale outcomes, duplicate outcomes, immutable audit rows, service snapshots, capacity preservation, exact reschedule events, final-consent actor attribution, committed terminal recovery and cancel/reschedule/status races. Unit tests cover raw-query retry boundaries, timer overflow/end boundaries, deferred-confirmation account/workspace/unmount fences and terminal attempt recovery. Component tests cover status, actions, history, errors and Hebrew presentation. The exported browser journey exercises real local database-backed provider outcomes, customer history and existing booking/security journeys on traveler devices.

Native JavaScript exports are bundle evidence only. Real native/device/live-provider gates remain VIS-2 → VIS-43 → VIS-25. No deployment, external delivery or billing change is included.

Reproduce from the repository root (run database-backed API and browser suites sequentially):

```sh
npm run typecheck
npm run lint
NODE_ENV=test npm test --workspace @visit/api
npm run test:foundation --workspace @visit/mobile
npm run test-storybook --workspace @visit/mobile
VISIT_TEST_WEB_PORT=8083 npm run test:web --workspace @visit/mobile
```

From `apps/api`, run `../../node_modules/.bin/tsc -p tsconfig.test.json --noEmit` and `../../node_modules/.bin/prisma migrate status`. From `apps/mobile`, run `NODE_PATH=./node_modules ../../node_modules/.bin/expo export --platform ios --platform android --output-dir /tmp/vis39-native`.

## Independent audit record

Fresh QA session `/root/vis39_qa` added structured transaction-retry tests, exact/invalid/offset outcome boundaries, timer end/overflow checks, deferred-confirmation account/workspace/unmount fences and committed terminal recovery tests. Its clock-refresh finding was fixed with an end-boundary timer. QA ran isolated unit tests plus mobile foundation/typecheck/lint; it did not run the database or browser suites concurrently.

Fresh security session `/root/vis39_security` reviewed tenant ownership, role/session locking, audit immutability and data minimization, transitions, capacity and committed recovery. Its P2 stale-confirmation finding was fixed by scope checks before mutation and all response/error follow-up queries. Final static re-review reported no outstanding concrete security findings. Audit statements do not imply device, external delivery or hosted CI success.

The browser expiry fixture unloads Home before manually expiring its session so outstanding Home requests cannot rotate a cookie from an abandoned document. This preserves a deterministic fresh-document refresh check without changing production authentication behavior.
