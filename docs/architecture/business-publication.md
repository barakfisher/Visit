# Business publication and readiness — VIS-34

Approval and publication are independent. Review leaves `publishedAt=null`; an approved owner/manager can configure the draft, inspect the checklist and explicitly publish. The provider workspace shows publishing status, localized blockers, publish/unpublish and retry controls. Approval does not grant public bookability.

## Atomic publishing and configuration

Readiness requires approved business, exact pilot `Asia/Jerusalem`, valid name/slug/location/category, at least one active service, active assigned staff for every active service, compatible business/staff hours with enough room for duration and both buffers, and an explicitly saved booking policy. Recurrence, overrides, DST boundaries, local horizon, elapsed notice and the same 15-minute grid as availability determine whether an eligible start fits. Existing bookings/blocks do not make an otherwise configured business unpublishable; they still reduce actual advisory availability.

Publish locks the business and its active owner/manager membership, revalidates authorization and all readiness inputs, then sets publication metadata in that transaction. Repeated publication retains the original timestamp. Readiness reads use repeatable-read snapshots; only the mutation is authoritative. Blockers are field-addressable API codes and localized instructions in the UI.

All exposed profile/catalog/staff/hours/policy mutation paths serialize on the business row, including compatibility service creation. An edit that makes service/policy/hour readiness invalid suspends publication and expires temporary holds. Valid catalog edits retain publication; fixing an invalid configuration does not silently republish. Profile fields are validated on mutation; immutable timezone is checked at initial explicit publication. Synthetic generic engine fixtures deliberately retain non-pilot zones and opt into publication directly; this is not an operational migration path.

## Public boundary and removal of enumeration

Global `/api/providers` and `/v1/businesses` directories are removed. A private `/appointments` page lists the current identity’s upcoming appointments, so removing the directory does not strand appointments beyond the single nearest card on Home. `/discover` redirects Home; the legacy Explore card is removed. VIS-45/VIS-46 supply shared-provider resolution, saved cards and the final Home/menu. No alternative global listing or provider count is exposed.

Direct provider detail, public service reads and both availability surfaces require approval plus publication. New hold insertion rechecks publication inside the booking transaction, after Redis contention, while holding a shared business-row lock. Confirmation does the same. Database triggers independently guard new active bookings, held confirmation and expired/cancelled reactivation, serializing with unpublish even for raw writes. Existing confirmed-record rescheduling is deliberately distinct from new reservations.

## Unpublish, existing records and owned rescheduling

Unpublish atomically clears publication and marks current HELD rows EXPIRED, without moving their recorded instants/snapshots. Redis ownership entries are released after commit; failed cleanup recovers via TTL. Republish never revives an expired hold. Confirmed/completed/cancelled appointments and their snapshots are not modified. A previously confirmed booking's idempotent confirmation retry still returns its owned persisted result.

Owned appointment history, agenda, cancellation and policy-eligible rescheduling remain accessible. Private rescheduling detail/availability endpoints validate the authenticated booking owner and current confirmed status/cutoff, use the booked service snapshot and reserved duration (including after catalog archival), and exclude that booking's old allocation from advisory capacity. Foreign booking IDs fail closed. They cannot authorize a new booking or another business. Reschedule remains atomic and enforces staff, hours, buffers, notice/horizon and capacity; publication alone is not required for an existing confirmed appointment, but business approval is.

## Conservative rollout

VIS-32 added nullable publication metadata without populating it. These guard migrations do not publish any legacy business, relabel a timezone, shift a confirmed booking, or delete historical rows. Existing unconfirmed legacy holds cannot confirm against an unpublished business and recover by expiry/release. Existing six UTC businesses remain unpublished and require reviewed migration before the Israeli-only pilot, as recorded in `pilot-time-policy.md`.

## Evidence

The lifecycle suite exercises incomplete/foreign attempts, field blockers, complete setup and explicit publish, every retained public surface, directory removal, temporary-hold expiry/Redis release, permanent expiry across republish, preserved confirmed snapshots, private owned rescheduling/foreign rejection, archived-service snapshot availability, buffers/disjoint staff hours, catalog invalidation, publish-versus-edit and unpublish-between-preflight-and-insert races, raw database guard and legacy timezone rejection. Existing generic engine, tenant, snapshot and DST tests opt their synthetic fixtures into publication explicitly and retain their original security assertions.

Browser coverage extends the application/admin flow through business setup, provider publish UI, public detail and unpublish; booking/concurrency/DST regressions remain enabled. Native exports only prove compilation. Actual native interaction and live delivery remain VIS-2/VIS-43. Full final command results and PR merge evidence are recorded in Linear; no hosted-CI success is implied by local results.

Final local validation on 2026-10-25: 147/147 API tests under NODE_ENV=test, 25/25 foundation tests, 47/47 Storybook tests, full browser suite, root typecheck/lint and API test-source typechecking passed. Native bundles exported; no device or live-provider execution is claimed. Earlier concurrent runs intermittently returned 500 from pre-existing screen-flow/catalog cases; assertions now preserve synthetic error diagnostics, and the final sequential validation pipeline passed. Prolonged stability/load investigation remains VIS-17 rather than being claimed solved by this run.
