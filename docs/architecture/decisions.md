# Architecture and product decisions

## Current pilot amendment — 2026-10-25

[pilot-product-journey.md](pilot-product-journey.md) supersedes earlier discovery, initial routing, timezone rollout and selection-time-hold assumptions. One identity retains customer capability plus approved provider memberships. Provider URL/QR acquisition automatically saves to the authenticated identity's My Providers list; public link preview GET does not mutate lists or grant management rights. Ordinary login lands on Home with upcoming appointment, compact saved providers and a minimal hamburger menu. No global directory/search, counts-based bypass or bottom tabs.

Pilot business schedules/display use Asia/Jerusalem, while durable booking instants remain UTC and DST-aware. Historical non-Israel businesses/fixtures need explicit migration review; no blanket relabeling or shifted appointments. Compact service dropdown/calendar/nearby available slots lead to exact appointment review and verified contacts, with no capacity hold until final explicit booking consent. Then use owner-bound Redis coordination plus authoritative idempotent PostgreSQL commit/recovery. Phase 2 free-text assistance is deferred and cannot mutate bookings or bypass deterministic checks.

Implementation is tracked in VIS-13/24/26/27/28/29/34/35/45/46/47; VIS-22 is canceled and VIS-48 is deferred. Earlier completed foundations keep their commit/test evidence; the amendment does not certify the new product flow. Native VIS-2 → VIS-43 → VIS-25 and operational release gates are unchanged.

## Historical baseline

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
- VIS-10 adopts configurable onboarding prefill: 60-minute notice, 60-day horizon, zero buffers, and 24-hour cancellation/reschedule cutoffs. Providers must explicitly save the policy; no universal cutoff activates silently. See [scheduling policy](scheduling-policy.md).
- VIS-32 delivers admin-only review, recorded approval/rejection reasons and applicant notification status. VIS-33 prevents arbitrary existing-business ownership requests. VIS-34/35 deliver readiness and provider setup; approval alone never publishes.
- Language policy confirmed for VIS-31: Hebrew and English, Hebrew default, account-settings language switch, persisted account preference and RTL Hebrew layouts. See [localization policy](localization.md) for bidirectional rendering and validation scope.

## Identity/navigation contract

See [Identity, provider capability and navigation](identity-and-navigation.md) for the post-login routing precedence, mode preference, business selection, authorization boundaries, stale-state recovery and shared transition matrix. This supersedes the original forced-role/onboarding assumptions.

## Browser test isolation — 2026-10-28 (VIS-14)

- **Choice:** the database-backed browser suite (`npm run test:web`) runs against a dedicated `visit_test` PostgreSQL database and Redis logical database `1`. `apps/mobile/scripts/test-environment.ts` assigns every API setting explicitly, so the API's own `.env` loading can supply none of them (dotenv never overrides keys that are already set). Locally it defaults to the docker-compose local-only credentials. CI passes `VISIT_TEST_DATABASE_URL` and `VISIT_TEST_REDIS_URL`. The harness refuses any other database name, Redis database `0`, a non-loopback host or `host`/`port` query overrides, and reports a malformed override without echoing it, and applies committed migrations to `visit_test` before each run (Prisma creates the database on first use). The session secret is random per run.
- **Rejected: keep running against the development database and Redis, with per-test ID cleanup.** A run that crashed before cleanup would leave synthetic businesses, identities and bookings in the developer's data. The suite also resets rate-limit keys in the same Redis keyspace the running dev API uses. And whatever happened to be in `.env` (Google, Twilio, delivery modes) silently shaped test behaviour, so a run could pass on one machine only.
- **Rejected: a separate Postgres/Redis container per run.** Isolation would be stronger, but it adds container orchestration to every local run and slows feedback, while a dedicated database and keyspace already remove the failures above.
- **Consequence:** the API's own `env.ts` still calls `dotenv.config()`. It never overrides keys that are already set, and the harness sets all of them. `env.ts` exports `environmentKeys`, and the harness refuses to start if any key is missing from `testEnvironment()`, so a new API setting cannot silently take its test value from `.env`. Keys outside the API schema can still be loaded into the process, which the static web server inherits; they don't affect the API. `expo export` separately reads `apps/mobile/.env*` for `EXPO_PUBLIC_*` values, outside this decision. Prisma created `visit_test` on first `migrate deploy` locally; the first hosted CI run must confirm the same there.

## Booking resilience browser proof — 2026-10-28 (VIS-14)

- **Choice: prove an outage with the API's real failure, not a faked browser reply.** `booking-resilience-smoke.ts` closes the in-process test API's own Redis client, so `/api/bookings/commit` answers its real `503 LOCK_UNAVAILABLE`, then reconnects in `finally`. A separate case aborts the request in the browser for "never reached the server". The Redis server, db 1 and the dev API's own connection are untouched.
- **Rejected: fake the 503 in the browser only.** It would prove the screen, not the server: a regression that hung or answered 500 when Redis is down would still pass.
- **Choice: a slot goes stale only when other real customers fill every remaining place.** The lifecycle business's staff member takes two appointments at once, so one rival booking leaves the slot bookable and the app is right to keep the choice. Each rival is a separate customer, so the proof does not rely on the open self-overlap question below.
- **Choice: refusals that end a new-booking attempt show the app's localized message** (`bookingCommit.conflict`, or `bookingContact.help` for `CUSTOMER_CONTACT_REQUIRED`). Before, the booking screen displayed the server's English diagnostic, so a Hebrew customer read "That time was just booked" in English. Rejected: localize server messages; they are diagnostics, and the client already owns the copy. Rejected: the same generic copy for reschedule refusals; it would tell a customer past the reschedule cutoff to "choose another time", which is refused again. Reschedule refusals keep the server's specific (English) reason until the reschedule slice gives them localized copy.
- **Open decision: may one customer hold overlapping bookings, and how many bookings may one customer make?** Nothing in the API or database prevents either: there is no per-customer overlap rule, booking cap or rate limit on `/api/bookings/commit`. On a slot with places left, one customer confirming the same time from two tabs (or twice, one after the other) gets two bookings; each tab is its own attempt with its own idempotency key, so idempotency cannot join them. Legitimate for "one account books for two children", wrong for an accidental second tab, and abusable: one account can take every remaining place of a slot, or many slots, with fresh keys. Options: allow; reject a customer's overlapping booking; cap bookings per customer; rate-limit commits. The resilience smoke records today's behaviour (two bookings) and must change with this decision.
- **Observed, not asserted: truly simultaneous confirms can conflict while a place remains.** A short exclusive Redis lock (`redis-slot-lock.ts`) per staff member over every minute of the occupied interval (buffers included) is tried once; a second concurrent attempt on the same or an overlapping interval for that staff member is rejected with `409 CONFLICT` (it does not wait), regardless of capacity, and its attempt is marked rejected. The outcome depends on timing, so the browser proof confirms sequentially; concurrency belongs to VIS-17.
- **Not covered: retry after a page reload.** The uncertain attempt lives only in memory, so a reload loses its idempotency key and a retry is a new attempt. On a slot with places left that can create a second booking. VIS-17.
