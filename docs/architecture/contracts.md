# Domain and API contracts

This contract separates identity (who is signed in) from authorization (which business the identity may act for). A session never grants provider access by itself.

## Core records and ownership

| Record | Scope | Rules |
| --- | --- | --- |
| Identity, LoginCredential, Session, ExternalIdentity | Global | Identity may span businesses; credentials and sessions do not belong to a tenant. |
| Business | Tenant root | Primary key is `id`; includes a unique slug and IANA timezone. |
| Membership | Business-owned | Links identity to business and role; unique per identity/business/role; provider access requires active approved membership. |
| ProviderApplication | Business-owned | Pending/approved/rejected lifecycle; pending applicants have no provider permissions. |
| Staff, Service, WorkingHours, ScheduleOverride, BookingPolicy, Booking | Business-owned | Every read/write is scoped to authorized `business_id`; owned references include the business id. |

Every repository call that touches a business-owned row receives an `AuthorizedBusinessContext` created by server-side membership authorization. Record-id lookups also include the business id. The API rejects attempts to associate rows from different businesses, with composite database constraints as a second boundary.

See [tenant inventory and repository isolation](tenant-isolation.md) for every table classification, opaque runtime contexts, customer/admin/public exceptions and executable negative tests. Customer-owned booking access uses a validated global session plus customerId; it does not require provider membership.

## Authentication and onboarding states

- Anonymous → request passwordless email challenge or OAuth/phone challenge → challenge verified → authenticated session.
- Email challenge is single-use, expiring, rate-limited, and enumeration-resistant. An email address is not treated as verified until challenge completion.
- Every authenticated identity may use the customer experience without a separate customer role or forced onboarding. Provider application is an optional post-login account action and remains pending until admin approval.
- Consumer identity may use the shared consumer experience. Provider actions require an active provider membership for the selected business.
- Approved providers switch customer/provider modes through the account menu. When multiple provider memberships exist, select a permitted business before private agenda queries. Switching mode/business reloads authoritative state and cancels/clears old tenant-scoped queries and transient state.
- Revoked sessions require reauthentication; removed membership or stale business selection recovers to another permitted business or customer/account mode. Rejected applications preserve customer access. Client route guards are not authorization.

The complete routing precedence and state matrix are in [Identity, provider capability and navigation](identity-and-navigation.md). Pending/rejected applicants retain customer access; approved unpublished businesses retain provider setup access. Session revocation clears all private content; network errors have retry states rather than being treated as logout.

## Booking lifecycle

`requested/held → confirmed → completed` with terminal `cancelled` and `expired` states. A hold is provisional and expires. Only a successful transaction creates or updates a confirmed booking. Reschedule is atomic: destination capacity is reserved and the old allocation released in one transaction; any failure leaves the original booking intact. Cancellation is idempotent.

Intervals use half-open semantics `[start, end)` and include the service duration plus both buffers. Capacity counts simultaneous occupied intervals for the same staff resource. Adjacent intervals are allowed. Each business owns its booking window, buffer, cancellation, and rescheduling policy. Availability responses are advisory and confirmation always revalidates.

## Initial HTTP surface

All payloads are JSON. Mutations that can be retried accept `Idempotency-Key`; authenticated requests carry the session using secure, HTTP-only, same-site cookies on web and platform-secure storage on native.

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /health/live` | Public | Process liveness only. |
| `GET /health/ready` | Public | 200 only when database/migration checks and Redis succeed; otherwise 503. Redis-backed auth/reservation operations fail closed, while PostgreSQL remains authoritative for booking correctness. |
| `POST /v1/auth/email-challenges` | Public | Request passwordless email login; always return an enumeration-resistant accepted response. |
| `POST /v1/auth/email-challenges/verify` | Public | Consume a one-time challenge and establish a session. |
| `GET /v1/me` | Session | Return global identity, roles, provider membership/application summaries, and safe next action. |
| `POST /v1/provider-applications` | Session | Request provider/business access; returns pending state, grants no provider permissions. |
| `POST /v1/provider-applications/:id/decision` | Authorized approver | Approve/reject; approval creates active membership. |
| `GET /v1/businesses/:businessId/services` | Consumer or authorized member | Read active services for a business. |
| `GET /v1/businesses/:businessId/availability` | Consumer or authorized member | Query candidates by `serviceId`, optional `staffId`, and local date; returns UTC instants plus display timezone. |
| `POST /v1/businesses/:businessId/bookings/holds` | Session | Place an expiring provisional interval hold. |
| `POST /v1/businesses/:businessId/bookings` | Session | Confirm a booking transactionally using a valid hold and idempotency key. |
| `GET /v1/me/bookings/current` | Session | Deterministically return the next upcoming active booking for the identity and selected provider context. |
| `POST /v1/businesses/:businessId/bookings/:bookingId/reschedule` | Owner or authorized provider | Atomically move a booking while preserving it on failure. |
| `POST /v1/businesses/:businessId/bookings/:bookingId/cancel` | Owner or authorized provider | Idempotently cancel and release capacity. |

Validation errors use `{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "fields": { "field": "reason" } } }`. Other stable codes include `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `HOLD_EXPIRED`, `POLICY_VIOLATION`, `RATE_LIMITED`, and `INTERNAL_ERROR`. Responses never disclose whether an email/phone has an account, expose another tenant's records, or return internal database/provider details.

## Time and policy payloads

Recurring schedule values are local wall-clock times plus weekday and business IANA timezone. An override is explicitly `open` with intervals or `closed`. An unspecified day is closed. An explicit date override takes precedence over recurrence. DST-nonexistent values are invalid; DST-ambiguous input must carry an explicit offset/fold. Confirmed booking payloads and API responses use ISO-8601 UTC instants and include the IANA timezone for display.

Business policy is stored per business: `minimumNoticeMinutes`, `maximumAdvanceDays`, `bufferBeforeMinutes`, `bufferAfterMinutes`, `cancellationCutoffMinutes`, and `rescheduleCutoffMinutes`. Until product-approved defaults exist, onboarding must require a valid explicit policy before the business accepts bookings.
