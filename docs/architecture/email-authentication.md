# Passwordless email and recovery (VIS-21)

## Ownership and delivery lifecycle

Email addresses are trimmed and case-normalized. Send responses are the same for known and new addresses; sending a link never creates or activates an identity. Tokens are 256-bit opaque random values and PostgreSQL stores only their hashes. Each login challenge has explicit creation/expiry, delivery and consumption state; validity is at most 15 minutes from issuance.

A challenge becomes usable only after the delivery adapter accepts it. A known delivery failure burns the challenge; errors never include provider response bodies or credentials. Resend uses server-only credentials, a ten-second request deadline, escaped HTML plus plain text, and a stable per-challenge Idempotency-Key. It is not a durable delivery queue: a crash before confirmed delivery may require a new link. Actual sender-domain/DNS/delivery verification remains VIS-43.

Recovery means proving ownership with a fresh email link. Requesting another link supersedes earlier pending login links for that address. A 30-second cooldown, five send attempts per address/hour, ten per IP/hour and twenty verification attempts per IP/15 minutes apply. Counters increment/expire atomically; Redis failure prevents issuing or verifying a link. Failed/throttled attempts can consume quota. No password or ownership bypass is introduced.

## Single use and identity binding

Issuing and consuming challenges serializes on an email-scoped PostgreSQL transaction lock. Verification checks purpose, accepted delivery, expiry and a compare-and-set consumption update in the same transaction that verifies identity and creates the session. Concurrent link use yields one session; subsequent use is denied. A hashed proof is also unique on the session row.

A challenge issued for an existing identity stays bound to that identity and email. If the email changes or moves to another identity, that link is rejected. A previously unclaimed address that becomes attached to an identity before verification also requires a fresh link. There is no automatic merge with phone/Google accounts. Existing platform roles and memberships are preserved; ordinary email login no longer overwrites platform roles from configuration. Configured admin-email bootstrap applies only when creating a new verified identity.

`EMAIL_VERIFY` challenges cannot authenticate. Explicit linked-method/contact-change consent and recent-auth requirements remain VIS-37/VIS-15.

## Callbacks and UI

The server accepts only destination aliases `web` and `native`, never a caller-provided URL. Web links use the configured origin and `/auth/email`; native links use exactly `visit://auth/email`. Credentials are in the fragment, not the HTTP query. App-link/scheme ownership and installed native callback execution must be verified before pilot distribution in VIS-43; a successful bundle export does not establish those properties.

Opening a link only prepares the confirmation screen. It does not consume a credential or create a session, which avoids automatic consumption by previews/scanners. The user explicitly confirms sign-in. The web callback removes both fragment and legacy query credentials from Router state and browser URL before continuing; a no-referrer document policy reduces accidental disclosure of legacy URLs. New links never use query tokens. Native callback state is held in memory and the launch URL cache is cleared. Tokens are never placed in ordinary application storage or Query keys.

The email screen is Hebrew/English, with RTL Hebrew and LTR email input. It shows pending delivery, cooldown, retry and fresh-link recovery. Production UI has no raw-token input or development inbox action. If verification succeeds but loading the profile fails, retry resumes that issued session instead of replaying the one-time link. The resolved profile must match the identity proven by verification; a mismatched/stale account response cannot complete sign-in. Native session credentials still use SecureStore. Expo Go cannot receive the configured app-scheme callback: email entry is disabled there and labelled as requiring a development build.

The development inbox is bounded, ephemeral, loopback-only and development-only. Its response contains a sensitive link/token for local development; it is not a production recovery mechanism. Request logs omit query strings and raw database/provider errors remain redacted.

## Verification and remaining evidence

Run the API suite for single/concurrent use, expiry, purpose separation, pending/failed delivery, identity movement, recovery, role preservation, enumeration-resistant responses, quotas, callback allowlisting, server-only adapter behavior and inbox isolation. Client foundation tests cover callback parsing/scrubbing. Exported browser tests verify Hebrew input direction, no auto-consumption, removal from URL/history/network requests, one-time verification and profile-outage recovery. Typecheck/lint, Storybook and both native exports remain separate checks.

No live email was sent during implementation tests. VIS-43 owns verified sender/domain delivery, real mailbox behavior, native cold/warm deep links and app ownership. VIS-40/VIS-41 own staging delivery configuration and monitoring redaction checks.

References: [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email), [OWASP recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Expo Linking SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/linking/), [Router URL/hash parameters](https://docs.expo.dev/router/reference/url-parameters/).
