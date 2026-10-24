# Architecture and product decisions

Status: VIS-1 baseline with production-plan decisions reconciled for VIS-9, 2026-10-24. Target contracts do not certify implementation completion.

## Confirmed with the product owner

| Area | Decision |
| --- | --- |
| Mobile and web client | Expo + React Native + TypeScript + Expo Router; shared single-brand UI |
| Design system | NativeWind |
| Server data | TanStack Query; Zustand only for transient client UI state |
| API | Node.js + TypeScript. Use Fastify for the HTTP boundary: small, typed plugin model and good schema validation support. |
| Database | PostgreSQL with Prisma migrations and generated client |
| Cache and coordination | Redis for ephemeral coordination only; booking correctness remains a PostgreSQL invariant |
| Email authentication | Passwordless email sign-in link, single-use and expiring; never activate or link an email identity before verification |
| Provider onboarding | Identity-only login; post-login new-business applications require admin approval. Existing-business joining requires invitation or verified ownership. Approved providers switch customer/provider modes from the account menu. |
| Google authentication | Authorization code + PKCE and explicit authenticated account linking; never merge accounts on matching email alone. Existing ID-token-only implementation must be replaced under VIS-15. |
| Phone authentication | Live Twilio Verify; isolated Redis development/test challenges; expiry, single-use/replay protection and throttling on both paths. |
| Business publication | Approval and publication are separate. Approved providers configure draft businesses and publish only after server-side readiness validation. |
| Booking policy | Each business configures its own booking window, buffers, and cancellation/rescheduling policy |
| Staff capacity | Defaults to one concurrent appointment per staff member; capacity is checked across the complete occupied interval |
| DST | Reject nonexistent local times during spring-forward; require an explicit offset/fold choice for ambiguous fall-back times. Persist booking instants in UTC and retain the business IANA timezone for display and recurring schedules. |
| Brand and scope | One shared brand across tenants. Pilot requires live authentication and approval/rejection notifications; appointment messaging remains labeled placeholders. No payments, independent branding, or full native E2E automation; record native manual smoke separately. |

## Tenant and identity boundary

- `Business` is the tenant root and uses its primary key as the business identifier.
- Identity, authentication credential, and session records are global. A person can hold memberships in multiple businesses and may also book as a consumer.
- Business-owned staff, services, schedules, overrides, booking policies, bookings, and provider approval requests carry a non-null `business_id`.
- Every provider operation resolves an authenticated identity and verifies an active membership and role on the server. A client-supplied `business_id` is only a selector, never proof of access.
- Tenant-owned references use composite keys/foreign keys that include `business_id`, so cross-tenant references fail at the database boundary too.
- A provider applicant has no provider permissions until approval is recorded and an active membership is created. Existing approved memberships are not implicitly granted to other businesses.

## Booking invariants

- Occupied ranges are half-open `[start, end)`: adjacent appointments can touch; any true overlap conflicts.
- The occupied interval includes service duration plus configured pre/post buffers. Overlap checks use full intervals, not equal start times.
- The default per-staff capacity is one. If a business configures higher parallel capacity, all overlapping intervals count against it.
- Availability is advisory. Booking confirmation rechecks authorization, policy, and capacity transactionally in PostgreSQL.
- Redis holds use random owner tokens, bounded TTL, atomic acquire, and compare-owner-and-delete release. Redis loss or expiry cannot permit an invalid database booking.
- Booking mutations accept idempotency keys. Rescheduling commits the new allocation and releases the old allocation atomically; on failure, the original booking remains intact. Cancellation is idempotent and releases capacity once.
- Store recurring schedules as local times associated with a business IANA timezone; store actual bookings as UTC instants. Nonexistent DST wall times are invalid; ambiguous wall times require an explicit offset/fold choice.
- Business policy owns minimum notice, maximum booking horizon, buffers, cancellation cutoff, and reschedule cutoff. Define safe configurable defaults in the policy schema and require an explicit business policy before accepting bookings.

## Phase 1 integration contracts

- Monorepo packages: `apps/mobile` (Expo native/web), `apps/api` (Fastify), and shared TypeScript contracts/UI packages as needed.
- PostgreSQL is the durable source of truth. Prisma owns schema and migrations. Redis never replaces database invariants, but is a required dependency for current rate-limit and reservation routes. These fail closed on Redis outage; readiness requires database/migration health and Redis.
- HTTP errors use stable machine-readable codes and safe human-readable messages. Validation errors are field-addressable; authentication and authorization failures do not disclose tenant or account existence.
- UI query keys include authenticated identity and selected business where relevant. Switching business clears or invalidates business-scoped cached and transient state.
- CI uses disposable PostgreSQL and Redis services, deterministic fixtures for at least two businesses, and runs lint, typecheck, unit/API checks, Storybook build, and web smoke/E2E checks as those foundations land.

## Open implementation details

- Resend is the initial production email adapter; configure its secret and verified sender on the server. Passwordless email, Google code + PKCE and phone OTP are in pilot scope. Disabled/unconfigured options must be labeled honestly. Hosting/deployment target is decided in VIS-40; real authentication/native evidence is VIS-43.
- Exact per-business scheduling policy defaults need product review; until then, keep them explicit and configurable rather than silently applying a universal cutoff.
- VIS-32 delivers admin-only review, recorded approval/rejection reasons and applicant notification status. VIS-33 prevents arbitrary existing-business ownership requests. VIS-34/35 deliver readiness and provider setup; approval alone never publishes.
- Language policy confirmed for VIS-31: Hebrew and English, Hebrew default, account-settings language switch, persisted account preference and RTL Hebrew layouts. See [localization policy](localization.md) for bidirectional rendering and validation scope.

## Identity/navigation contract

See [Identity, provider capability and navigation](identity-and-navigation.md) for the post-login routing precedence, mode preference, business selection, authorization boundaries, stale-state recovery and shared transition matrix. This supersedes the original forced-role/onboarding assumptions.
