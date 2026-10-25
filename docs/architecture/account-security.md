# Linked methods and verified contact changes (VIS-37)

## Implementation policy

Login authenticates an identity; method management never merges identities or
moves a Google subject, phone or email from another identity. Ownership conflicts
use one generic METHOD_UNAVAILABLE response after proof, without returning the
other identity. Lost access to every method requires a human-reviewed recovery
case with independently verified ownership evidence and an authorized reviewer.
There is no self-service bypass, automatic email merge, public ownership claim or
working recovery button until that review workflow exists.

Require a currently authenticated server-issued session, with authentication no
older than five minutes, for starting/confirming method changes and removals.
Refresh preserves authentication age and does not satisfy reauthentication.
Verification is bound to the exact identity, session and security version; login
OTPs or email-login links are not accepted as account-management requests.
Contact challenges expire, have bounded attempts/throttling, and are consumed
atomically. Reissuing or changing contacts invalidates previous pending challenges.

Email and phone are primary verified contacts and independent login methods.
Google methods are provider-subject records; linking never changes primary
contacts. Only proven email/phone and linked Google count as usable methods.
Removing the last usable method is rejected under a per-identity transaction lock.

Contact replacement/removal and Google removal revoke every prior login session
and return a replacement in a new login family for the current device. The new
family prevents replay of an old revoked refresh token from revoking the new
security state; authentication age and absolute refresh deadline are preserved.
Google addition keeps the current login family and revokes other families.

Resource locks precede the identity-security lock; session-family locks are last.
Login issuance and Google linking participate in the identity lock so removals,
new methods and revocation cannot race. Email/phone resource locks serialize old
contact reuse with contact updates. Session refresh/logout retain family mutexes;
management rechecks current authorization after holding those locks.

Every successful change writes an identity-owned append-only security event with
an allowlisted action/method and timestamp, without proofs, raw Google subjects,
contact values, provider bodies or session tokens. Contact/security version advances
invalidate outstanding method verification and email login challenges. Security
alerts to previous available verified channels are queued transactionally. Delivery
uses a durable leased outbox, bounded provider calls, retries and explicit pending /
sent / failed status; queued does not mean delivered. Delivery never rolls back an
already committed security change. No external messages are sent by local tests.

Production delivery and actual device/provider verification remain VIS-43. A local
inbox/fake adapter demonstrates behavior only. Unconfigured SMS alerts remain
pending/blocked explicitly; Twilio Verify cannot send arbitrary security messages.
Twilio Messaging requires a separately configured Messaging Service. Secrets stay
server-side; recipient snapshots are private delivery data, not audit fields, and
must be removed after delivery/retention. Logs must exclude provider request bodies,
verification codes, destination addresses, opaque challenges and tokens.

## Implemented API and client behavior

- GET `/api/account/sign-in-methods`: actor-owned methods, usability/removal flags,
  recent-auth requirement, and last 20 secret-free events with notification status.
  The returned identity ID is checked against the active client identity before
  populating its query cache.
- POST `/api/account/contact-challenges`: explicit consent, normalized email/phone,
  exact session/security-version-bound challenge, send quotas per identity/IP and
  normalized destination plus a 30-second destination cooldown. Email uses a
  six-digit HMAC-protected ten-minute code; phone uses the hardened Twilio Verify /
  local OTP service in a distinct account namespace. Five attempts maximum.
- POST `/api/account/contact-challenges/verify`: explicit confirmation and proof,
  transactional ownership conflict check, verified contact update, pending-proof
  invalidation, audit/outbox and current-device replacement session. Ordinary
  login codes/links are not account-management proofs.
- POST `/api/account/sign-in-methods/remove`: explicit confirmation and scoped
  method ID; serialized last-usable-method check, audit and session replacement.
- POST `/__dev/account/contact-code`: development/loopback-only, requires the
  exact authenticated challenge owner/session. It cannot retrieve live provider
  codes. The UI helper exists only in development builds.

Account settings provide Hebrew/English method list, verification and explicit
removal confirmation, last-method protection, recent-auth messaging and security
history. Issued replacement sessions are retained in memory during profile outage;
retry checks the proven identity without redeeming a consumed proof. Successful
security refresh clears private queries/mutations, advances request context and
preserves only a still-authorized selected business. Unsupported recovery remains
a disabled future action. Google account linking uses the existing code broker
and final consent, then revokes other login families and records the same audit.

Primary-contact uniqueness belongs to Identity.email/phone. A Google provider
email is descriptive verified provider data, not a reserved primary-contact alias.
Removing a primary address releases it for independently verified use by a new
identity; that never recovers the original identity or transfers Google subjects,
roles, memberships or bookings. Public signup always creates USER. The legacy
PLATFORM_ADMIN_EMAILS bootstrap hint is deliberately ignored: a recycled address
must not acquire administrative authority. Existing stored roles are preserved;
explicit operator-controlled admin bootstrap belongs to VIS-32.

## Lock order and a verified race

Acquire relevant Google-subject/email/phone resource locks, then identity-security,
then current/all active session-family mutexes **before updating a unique contact
key**. PostgreSQL can take a key-changing row lock for an email/phone update. If that
happens before acquiring another family's mutex, refresh can hold that mutex while
its new Session FK waits for the Identity row, creating a deadlock. A controlled
integration test holds the other family, waits until contact confirmation blocks,
then creates a refresh-like Session FK and releases it; both complete and the
new old-family session is revoked. Login issuance participates in the identity
mutex and contact resource locks. An OTP generation counter also prevents an
in-flight provider send from restoring a challenge invalidated by contact change.

## Notification operations and retention

The server starts a ten-second durable outbox worker with per-row leases,
SKIP LOCKED, bounded batches, exponential retry (five failed attempts), and graceful
stop after current work. Resend uses stable idempotency keys; Twilio Messaging
is at-least-once and can duplicate a generic alert after a crash. ACCEPTED means a
provider acknowledged submission, **not proven delivery**. Local acknowledgements
are labelled development-only; BLOCKED means a channel lacks delivery configuration.
Real delivery/consent and webhook evidence remain VIS-43. No live messages were
sent during implementation or tests.

Configure existing EMAIL_DELIVERY_MODE/API_KEY/FROM for email. SMS security alerts
require a separate TWILIO_MESSAGING_SERVICE_SID and account credentials; Twilio
Verify cannot send these arbitrary alerts. Recipient snapshots are erased on
provider acceptance, terminal failure, or after seven days even if configuration
never appears. Expired contact challenges are removed after one day. Security
events contain no contact/proof values and reject direct updates/deletes; parent
identity deletion is the explicit retention exception. Authentication proof digests
on Session/GoogleAuthProof must outlive all provider challenge TTLs before any
future session cleanup is introduced.

Factories assign unique test delivery scopes; the live worker selects only its
own scope. Browser tests inject local account delivery and a fake external Google
boundary, so a host's live worker cannot accidentally dispatch test notifications.
API consumers see only notification status/provider/channel, never destination or
provider response bodies. Monitoring of BLOCKED/FAILED/backlog age remains VIS-41.

## Reviewed lost-access path

There is no self-service identity merge or contact-match recovery endpoint. If all
methods are lost, open a private support case with the identity reference, claimed
incident and independently verifiable ownership evidence; never collect OTPs,
tokens or passwords. Public profile/contact knowledge is insufficient. A provider's
business-ownership evidence may support review but does not itself grant identity
or tenant access. Require an authorized reviewer and a second approver for a
privileged identity, record decision/evidence references and notify prior channels
where possible. With insufficient evidence, deny recovery and preserve the account.
An actual restoration must use a separately authorized, audited recovery procedure
that revokes prior sessions and obtains fresh ownership proof; no manual transfer
or raw SQL shortcut is exposed here. This operator workflow must be established
before accepting real recovery cases in the pilot; the UI correctly remains
unavailable until it exists.

## Verification

`npm test --workspace @visit/api`, `npm run test:foundation --workspace @visit/mobile`,
`npm run test:web --workspace @visit/mobile`, root typecheck/lint, Storybook suite,
and iOS/Android export. The browser path covers account-menu Google linking,
contact replacement with profile-outage recovery (one redemption), old-device
revocation, explicit method removal, last-method protection and Hebrew RTL.
API tests cover cross-account/session proof misuse, expiry/replay/attempts/throttle,
conflicts, forged/revoked/stale sessions, CSRF/consent, concurrent confirmation and
removal, old-contact reuse without privilege transfer, FK ownership, immutable audit,
OTP invalidation during provider send, refresh/contact lock ordering and outbox
retry/blocked/retention behavior. Native exports are bundle evidence only.

Primary provider references checked: Twilio Messages resource
https://www.twilio.com/docs/messaging/api/message-resource and Resend send-email
https://resend.com/docs/api-reference/emails/send-email. Native component APIs follow
Expo SDK 58; installed-device/live-provider acceptance remains VIS-43.
