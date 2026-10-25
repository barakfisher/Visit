# Tenant ownership and repository isolation

VIS-4 implementation contract and audit, 2026-10-24. Business IDs are selectors. Authorization comes from a current server-authenticated session and approved active membership, or explicit customer ownership for personal bookings.

## Complete table inventory

| Table | Classification | Authorization and relationship boundary |
| --- | --- | --- |
| Identity | Global | Own verified identity only; privileged admin review exposes only required applicant fields. A person may span businesses. Language preference is personal, not tenant-owned. |
| AccountContactChallenge | Global, identity-owned | Exact identity/session/security-version ownership; composite session FK; expiring hashed handle/HMAC proof with bounded attempts. No tenant authority. |
| IdentitySecurityEvent | Global, identity-owned | Own security settings history only; immutable allowlisted actions/methods, no raw contacts or credentials. Parent identity deletion is the explicit audit-retention exception. |
| SecurityNotification | Global, identity-owned | Private leased delivery outbox, composite event/identity FK; API projects status only. Recipient snapshot erased after provider acceptance or seven days. Test scopes cannot dispatch through live workers. |
| GoogleAuthProof | Global, identity-owned | One-time Google authentication/link proof digest, created transactionally for its resolved identity. Not a tenant capability; no public query route. |
| ExternalIdentity | Global | Stable provider subject belongs to one global identity; never grant a business role from provider claims. |
| EmailChallenge | Global | Expiring verified-ownership challenge; no business membership granted by challenge creation. |
| Session | Global | Token digest resolves global identity; expiry/revocation checked. Session storage is not tenant-owned. |
| SavedProvider | Global, identity-owned | Unique identity/business relation; required business reference. Current session owns add/list/remove; published-only save grants no membership. Unavailable entries project only the previously public saved name and business ID. |
| Business | Tenant root | Its primary key is businessId; approval controls current provider/public eligibility. Publication/readiness is added in VIS-34. |
| Membership | Business-owned | Non-null businessId and global identity reference; ACTIVE plus allowed role and approved business required. Identity existence alone grants no membership. |
| ProviderApplication | Business-owned | Applicant's own cross-business status projection and admin review are explicitly authorized exceptions to ordinary provider scope. Pending applications grant no access. |
| Staff | Business-owned | Non-null businessId; unique (businessId, id) resource key. |
| Service | Business-owned | Non-null businessId; unique (businessId, id); private CRUD requires authorized tenant context. |
| StaffService | Business-owned | Composite references include businessId for both staff and service. |
| BusinessWeeklyAvailability | Business-owned | Business FK and non-null businessId; replace/delete predicates include the tenant. |
| StaffWeeklyAvailability | Business-owned | Composite (businessId, staffId) FK, preventing staff from another business. |
| ScheduleOverride | Business-owned | Business FK; all reads and replacements include businessId. |
| StaffScheduleOverride | Business-owned | Composite (businessId, staffId) FK. |
| BookingPolicy | Business-owned | Unique businessId; provider policy writes require current OWNER/MANAGER membership. |
| Booking | Business-owned | Business FK and composite staff/service references; global customer identity reference is intentional. Customer sees only own records across businesses. |
| TimeBlock | Business-owned | Business FK and composite staff reference; agenda/delete/create predicates include businessId. |
| _prisma_migrations | Global infrastructure metadata | Migration/readiness checks only; never exposed as application/customer data. |

All tenant-owned records have non-null businessId. The business root and global identity/auth tables intentionally do not carry redundant tenant identifiers. Database FK constraints protect relational tenant consistency; they do not replace application authorization for a trusted database operator.

## Context and repository boundaries

- `requireBusinessMembership` resolves the server actor's current ACTIVE membership, allowed role and APPROVED business. It issues an immutable, privately branded context registered in a module-private WeakSet.
- Repository entrypoints reject forged objects and cloned contexts, including objects that copy a genuine context's private symbol and substitute businessId. Business ID and role in request headers/body cannot construct authorization.
- Service, provider-settings and provider-booking repositories recheck issued contexts against current membership/approval before access. Removed membership, changed role and withdrawn approval invalidate previously issued contexts. STAFF cannot use OWNER/MANAGER writes.
- Public service reads require an independently issued public context and recheck approval, publication and soft-deletion. A forged context cannot expose a pending business's service catalog. Exact provider links/services/availability are public; there is no global directory. Customer contacts, memberships, applications and private agenda remain protected.
- Customer-booking repositories require an in-process authenticated session capability and recheck session ownership/expiry/revocation. A copied session object with a substituted identity is rejected. Queries always bind customerId to the session actor.
- Service input keys are allowlisted at the repository boundary; businessId, id and nested relation payloads cannot reassign tenant ownership. Other provider-setting repositories construct data explicitly from permitted scalar fields and their issued context.
- Every private service get/update/delete predicate includes businessId. Service deletion archives any referenced booking history, including cancelled/expired records; restrictive FKs handle a booking arriving between the history check and delete.
- Business policy, staff creation/assignments, business hours and staff hours use scoped repositories. Both `/api` compatibility routes and `/v1` handlers use the same authorization/validation behavior.

Membership/session validation occurs at request and repository entry. This is not a claim that revoking a membership retroactively aborts an already running database transaction; concurrent revocation and privileged operational workflows require explicit transaction semantics in their feature/security issues.

## Booking and identity exceptions

Consumer booking/confirm/reschedule/cancel transactions first resolve a booking by current customerId; subsequent writes retain that ownership predicate. Consumers do not need provider membership to book or view their own appointments. Provider booking lists require current approved OWNER/MANAGER membership; provider mutations additionally match bookingId within that business.

Public availability/hold creation validates the approved business and tenant-matching staff/service composite keys. Availability and booking transactions scope occupied intervals and manual blocks by business/resource. Full concurrency and hold correctness are separate VIS-5/26/17 work.

The personal `/v1/me` projection intentionally lists the identity's own memberships/application summaries across businesses. A forged identityId query never changes the actor. Platform-admin review is an explicit privilege exception, not ordinary provider membership. VIS-33 replaces existing-business ownership applications with invitations/verified ownership; that operational workflow is not certified by this foundation audit. VIS-34 adds published-only discovery/confirmation guards. VIS-12/39 complete service edit snapshots and lifecycle history.

## Verification

`apps/api/test/tenant-isolation.test.ts` creates unique approved businesses A/B, a pending business, independent owners, a dual-business manager, staff, pending applicant and customer-only identity. It verifies:

- Repository CRUD, foreign record substitution, forged/cloned authorization, body/header tenant spoofing and service reassignment rejection.
- Private service/settings/staff/agenda reads and mutations across both HTTP surfaces, valid dual-business access and explicit selection for ambiguity.
- Customer-owned booking projections, foreign confirm/cancel/reschedule, wrong-business provider cancellation and time-block operations, with persisted-record assertions.
- Session/global identity projection isolation, non-admin review denial and revoked membership/approval/session handling.
- Direct database rejection of both StaffService links, staff hours/overrides, manual blocks and booking staff/service references across businesses.
- Safe archive behavior for cancelled booking history without changing another tenant's service.

Run `npm test --workspace @visit/api`. For migrations and integration tests on a fresh isolated database/Redis, run `npm run test:infra -- --api-tests`. This builds current source, applies migrations, runs the complete API suite inside its isolated API container and performs dependency/migration failure checks. It cleans only its own project/volumes. Fixture tests clean their unique rows; they never reset existing developer business data.
