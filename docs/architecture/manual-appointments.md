# Provider-entered appointments — VIS-38

## Confirmed behavior

The product owner approved new walk-in/telephone customers without registration or verified contact (option 1, 2026-10-27). OWNER/MANAGER members can create an appointment from their provider agenda using an active service, assigned active staff, a business-local date/time, customer name, international phone and optional email. The form reviews these details and current service duration/price before explicit confirmation. It never looks up or links a global Identity by entered phone/email, even if that contact matches a verified account.

A manual booking has `source=MANUAL`, nullable customerId (always null for this flow), immutable tenant-local contact snapshots with null verification timestamps, entering actor, input fingerprint and optional recorded reason. A new database constraint keeps existing CUSTOMER bookings attached to a real Identity and their existing contact-proof pairing. Manual source, actor, fingerprint, reason and snapshots cannot be changed after insertion. Customer reads/confirm/cancel/reschedule continue to require customerId equal to the authenticated identity; neither entering staff nor a matching phone owner can claim the guest record as a customer appointment.

Name and phone are always required. If current policy requires verified phone or email, the provider must record a 5–500-character exception reason. This is the only permitted policy exception. The CREATED audit event records the current actor, source MANUAL and reason MANUAL_CONTACT_EXCEPTION (or MANUAL_ENTRY without a verification requirement). The entered reason remains visible on the provider agenda. All manual contacts are labeled unverified; automatic BookingNotification intent is suppressed for guest creation and later guest lifecycle changes. The response says NOT_SENT, never delivered/verified. Existing manual contact actions remain deliberate user clicks; this work sends no live messages.

## Authoritative scheduling and recovery

`GET /v1/provider/businesses/:businessId/manual-booking-options` returns only tenant service snapshots, assigned active staff/capacity, timezone, bookability and whether an exception is required. It exposes no customer directory. `POST …/manual-bookings` strictly parses the input, checks authenticated OWNER/MANAGER membership and optionally fences the expected identity header. Client-supplied customerId, proof timestamps, source, actor and scheduling overrides are rejected.

The write reuses `withBookingTransaction`, the shared working-window engine, complete occupied buffer intervals, block checks, peak-capacity calculation, the shared consumer creation mutex, owned Redis reservations and the PostgreSQL authoritative capacity trigger. Inside Serializable transactions it fences current Session, Business and Membership rows, rechecks publication/approval/deletion, current service/assignment/reviewed price and duration, notice/horizon, staff capacity and availability. Local times reject DST gaps, require a matching UTC offset for repeated hours, and never use the traveling device timezone. On a Serializable retry, any prior owned reservation is released before releasing/reacquiring its creation mutex, preventing stale provisional occupancy from rejecting both competitors. Existing Business row-version updates force stale waiting booking readers to retry after schedule changes. Provider rescheduling of a guest retains its immutable contact exception; if newly tightened verification policy requires a reason absent from that guest's snapshot, rescheduling fails closed instead of inventing another exception.

ManualBookingAttempt is a durable actor-bound journal, keyed by business plus a private actor/UUID namespace. Registration binds the entire validated input fingerprint. Serializable booking work locks this attempt row, reads current state, and atomically commits the booking and CONFIRMED row version. Concurrent same-key workers retry against the new row version and recover the same current booking, including later rescheduled/cancelled status. A different fingerprint cannot reuse the key.

Any definitive scheduling failure finalizes REJECTED under the same business/attempt locks, unless another worker already committed, in which case its booking is returned. The database manual-attempt trigger forbids a missing, rejected, wrong-actor or wrong-fingerprint intent from creating a late manual booking. If rejection finalization itself fails, the response is 503 MANUAL_ATTEMPT_PENDING, not a misleading definitive 409. This protocol matters when a response is lost while the original worker is still running: a temporary conflict in a retry cannot discard the key and allow a duplicate late commit.

## Client boundaries

ManualBooking.component.tsx renders typed props and callbacks. The hook owns orchestration, the service owns API access, pure utilities validate/prepare data, and scoped transient Zustand state owns the draft, frozen review input, active attempt and result. Review freezes the actual price/duration payload independently of later query refresh. Double-submit and scope/focus/mount guards protect async continuations. Unknown results retain the same key/payload and disable edits until recovery; an authoritative rejection unlocks the retained draft for another reviewed attempt. Recovery remains available even if option loading fails or the business later becomes unpublished. Committed results invalidate agenda and availability through shared booking query predicates.

Account, permission, context and business changes clear private drafts/attempts. Drafts are transient memory, not persisted PII; a hard application/browser restart does not restore a manual form. Operators should check the agenda before re-entering after such a restart. Hebrew/English dictionaries cover the complete new form, audit reasons, manual badge and failure/retry states. RTL layouts use the existing presentation system; business timezone and persisted UTC instants remain independent of locale.

## Evidence

Fresh QA added API tests for strict inputs, role/session/tenant boundaries, minimal options, contact isolation even against an existing verified phone, immutable actor/contact/source/audit, no automatic notification, current-state replay, four concurrent same-key requests, rejected-key tombstones, buffers/blocks/hours/service/policy/publication, DST negatives and four real manual-versus-consumer HTTP races. Customer access to guest details/confirm/cancel is denied; provider reschedule/cancel remains authorized. A losing consumer attempt may leave an EXPIRED row by design: race assertions require exactly one occupied active allocation and all additional rows expired, rather than mistaking a retained expired attempt for overbooking.

Three pure mobile tests cover validation/snapshot copying, uncertain same-attempt locking/recovery and scope reset. Eleven pure-prop stories cover loading, failure/retry, empty/unpublished, editable and reviewed/pending/uncertain/success, exceptions and Hebrew long content. Exported-web coverage exercises option failure/retry, no-write review, required exception, pending controls, actual committed response loss, exact same-key recovery, one persisted unlinked/unverified guest, no notification intent, capacity conflict with preserved input and Hebrew mobile/desktop without horizontal overflow.

Reproducible commands from root:

```sh
npm run typecheck
npm run lint
NODE_ENV=test npm test --workspace @visit/api
npm run test:foundation --workspace @visit/mobile
npm run test-storybook --workspace @visit/mobile
VISIT_TEST_WEB_PORT=8083 npm run test:web --workspace @visit/mobile
```

Run DB-backed API/browser suites sequentially, preserving unrelated user runtimes; browser services use API3001/web8083. From apps/api, compile fixtures with `../../node_modules/.bin/tsc -p tsconfig.test.json --noEmit` and check migrations with `../../node_modules/.bin/prisma migrate status`. From apps/mobile, export native JavaScript with `NODE_PATH=./node_modules ../../node_modules/.bin/expo export --platform ios --platform android --output-dir /tmp/vis38-native`.

Two additive migrations introduce guest snapshots/guards and the attempt journal (31 total). An initial local SQL CASE parsing error rolled back the first migration atomically, was corrected before successful application, and no existing booking data was reset. Fresh read-only Security identified the concurrent unknown-outcome risk and finalizer uncertainty edge; both were corrected and re-reviewed. Final local checks passed: 272 API, 71 foundation and 102 Storybook tests (445 total), full exported-web regression, workspace typecheck/lint, API fixture compilation, 31 migrations current and iOS/Android JavaScript exports. Commit-linked hosted CI evidence is recorded in the PR, Linear and local handoff. Hosted account billing failures are not passing CI. Exports establish JavaScript bundles, not physical-device/live-provider acceptance; VIS-2 → VIS-43 → VIS-25 remains the release gate. No billing change, administrative bypass, deployment or live delivery is performed.
