# Persisted booking success — VIS-28

Success and appointment details come from an authenticated, customer-owned PostgreSQL appointment, not navigation parameters or a cached upcoming-booking list. A fresh read is required before showing a confirmation or its actions. Opening a foreign, missing, held or expired booking never shows success. Errors, sign-in and retry are explicit. Route changes remount by booking ID, and navigation blur unmounts the content so returning forces a new read. Identity, context, route, focus and mounted-state guards prevent delayed cancellation/export work from continuing in another account or screen.

The confirmation route remains `/confirmation/:bookingId`; `/appointment/:bookingId` provides revisitable details. Home and appointment history link to owned details. Details remain accessible without a saved provider, including cancelled/completed/no-show history. Terminal appointments display their real state rather than a successful confirmation. English and Hebrew labels support LTR/RTL. Dates and disambiguated clock times use the persisted business timezone; the pilot remains Israel time even on traveler devices. Service name, duration, price and currency come from the immutable booking snapshot; live catalog edits do not rewrite the receipt.

`GET /v1/bookings/:bookingId/details` returns a minimal owned projection with status, revision, interval, service snapshot, staff/business display fields, cancellation cutoff, available actions and notification record status. It exposes no contact snapshot, actor identity, token or idempotency key. Cancellation and rescheduling retain their existing server authorization/cutoff/revision checks. Existing VIS-26 final-consent and uncertain-outcome recovery remain authoritative: review creates no reservation or confirmation; retries recover the same owned committed result.

## Calendar

`GET /v1/bookings/:bookingId/calendar?revision=N` requires an owned CONFIRMED booking and the displayed revision. A changed or terminal booking returns conflict. The JSON response supplies a filename and server-generated RFC 5545 content; mobile API transport remains JSON. Reads create no booking, lifecycle event or notification.

VEVENT uses absolute UTC DTSTART/DTEND, a stable encoded booking UID, persisted update timestamps and revision SEQUENCE. Israel DST gaps/folds and traveler timezones therefore preserve the actual instant. Text escapes backslash, newlines, comma and semicolon; other control characters are removed. Physical lines fold at 75 UTF-8 octets without splitting Unicode code points, with CRLF and a final line ending. Tests include Hebrew/emoji, injection, invalid dates/revisions and exact folding boundaries.

Web export downloads an `.ics` Blob and releases its URL. Native export writes a unique temporary cache file, uses Expo sharing, and deletes the file after completion/failure. Both paths recheck the initiating scope before side effects. Repeated exports use the same UID; importing/updating behavior still depends on the receiving calendar application. JavaScript bundles and downloaded-file checks do not prove real native calendar import or sharing.

## Notification contract

Migration `20261027061500_booking_notifications` adds business-owned `BookingNotification`. Its composite event/booking/business foreign key and unique booking/event constraints bind one BOOKING_CONFIRMED record to the committed CREATED/CONFIRMED lifecycle event. An AFTER event trigger records it atomically; rollback removes both. Concurrent final-consent retries cannot create additional records. Known earlier CREATED/CONFIRMED events are backfilled with their actual event timestamp. Legacy baseline rows have no invented confirmation notice.

Notification rows are immutable; direct insertion, mutation and deletion are rejected. The existing privileged parent-booking purge cascades through events and notifications. There is no customer/provider deletion API. The record is an in-app confirmation intent, not evidence of an external delivery. No new recipient/contact data is stored. SMS and WhatsApp actions remain disabled and explicitly state that no message was sent. No delivery worker or live provider is included.

## Verification

Local evidence on 2026-10-27: 235 API tests, 60 foundation tests and 71 Storybook tests pass. Workspace typecheck/lint, API fixture compilation and Prisma migration status pass; all 28 migrations are applied locally. The full exported-web journey and iOS and Android JavaScript exports also pass. Real-device calendar sharing/import remains a manual release gate.

The API suite covers owned/foreign/provisional access, minimal/no-store responses, stale revisions, immutable snapshots, terminal export denial, final-consent retries, atomic rollback and immutable/deduplicated notification records. The browser journey proves delayed/failed reads never show success, foreign/held rejection, persisted reload, downloaded ICS bytes, cancellation, navigation-focus revalidation after cancellation while away, unchanged notification counts and Hebrew RTL. Existing journeys also pass final-consent zero-write review, lost-response recovery, races and Israel/legacy New York DST folds on traveler devices. Component stories cover loading, success, unavailable, cancellation, export failure and Hebrew. Pure units cover auth-return allowlisting, malformed IDs, freshness gating, UTC/DST conversion and calendar serialization.

Reproduce from the repository root, running database-backed API and browser suites sequentially:

```sh
npm run typecheck
npm run lint
NODE_ENV=test npm test --workspace @visit/api
npm run test:foundation --workspace @visit/mobile
npm run test-storybook --workspace @visit/mobile
VISIT_TEST_WEB_PORT=8083 npm run test:web --workspace @visit/mobile
```

From `apps/api`, run `../../node_modules/.bin/tsc -p tsconfig.test.json --noEmit` and `../../node_modules/.bin/prisma migrate status`. From `apps/mobile`, run `NODE_PATH=./node_modules ../../node_modules/.bin/expo export --platform ios --platform android --output-dir /tmp/vis28-native`.

## Independent audits

Fresh QA session `/root/vis28_qa` added unit and database-backed browser coverage. Its isolated 16-test run and mobile typecheck/lint passed. The developer runs the integrated database/browser suites sequentially; the audit did not claim independent device execution.

Fresh security session `/root/vis28_security` reviewed ownership/session validation, minimal projections, status/revision checks, ICS injection/path handling, atomic/deduplicated/immutable notification records, safe auth returns and asynchronous scope guards. Its navigation-focus freshness finding was fixed by unmounting content on blur and forcing fresh reads on remount. Final static review reported no outstanding concrete vulnerabilities. No live messaging, deployment or billing changes are included; native/device gates remain VIS-2 → VIS-43 → VIS-25.
