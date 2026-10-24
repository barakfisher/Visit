# Phone verification and abuse controls (VIS-19)

## Protocol and boundaries

`POST /api/auth/otp/send` normalizes an explicit international number to E.164 (spaces, parentheses and hyphens are removed; no default country is guessed). Verification accepts that number and exactly six digits. Successful verification records `Identity.phoneVerifiedAt`; legacy phone values are not silently considered verified.

Live SMS uses the server-only Twilio Verify adapter. Development/test delivery uses cryptographically random codes and nonce-bound HMAC verification values in Redis. The only plaintext local code is in the development inbox key; its HTTP endpoint requires development mode, local-inbox mode, loopback access, an unexpired challenge and remaining attempts. It is unavailable in production. No SMS was sent during implementation/tests.

Twilio credentials and service/account SID formats are validated on startup. Configure the live Verify service for six-digit codes and ten-minute validity, and verify those settings during VIS-43. Application expiry is bounded independently: local challenges last five minutes; Twilio challenges last at most ten minutes from provider creation, including resends. The adapter uses the exact Verification SID, not an unbound phone check, and checks the returned SID and approved status. Requests have a ten-second transport deadline. Malformed/network/provider failures are generic and fail closed; provider rate limits return 429.

## Limits and concurrency

| Control | Limit |
| --- | --- |
| Resend cooldown | 30 seconds per phone |
| Send per phone | 5 per 10 minutes |
| Send per IP | 10 per hour |
| Verify per phone | 8 per 5 minutes |
| Verify per IP | 30 per 15 minutes |
| Attempts per challenge | 5, retained when Twilio resends the same SID |
| Owned operation lease | 30 seconds; shared by sends/checks for that phone |

Counters increment/expire atomically. Phone/IP key suffixes are hashes, not anonymous data. The operation lease prevents concurrent checks from reaching the provider together; compare-owner cleanup cannot delete a replacement lease. Final save/consumption also checks ownership, generation and expiry. Worker stalls or lease loss cannot complete unchecked authentication. Operation failure may consume a quota or cooldown; it never bypasses one.

Successful approval consumes the Redis challenge/inbox and creates a replay tombstone. In the same PostgreSQL transaction that marks the phone verified, the application creates the session with a unique hashed authentication proof. For Twilio that proof binds the service and Verification SID. Redis rollback/lost replay keys or repeated approved provider responses therefore cannot create another session for that proof. Session/proof retention must outlast provider verification/replay validity; future cleanup must preserve this invariant.

A crash after provider approval or Redis consumption can result in no session; the user must request another code. This is fail-closed behavior, not an exactly-once delivery guarantee. Redis loss can discard abuse counters; provider-side fraud/rate controls and Redis durability remain staging/operations checks. Session-family security is specified in `session-security.md`.

## Logging and verification

Request logs omit query strings; error logs retain only a category and recognized Prisma error code. Raw Prisma error logging is disabled because it can print query/input values. Logging helpers are covered by tests with synthetic phone/code/secret markers. VIS-41 still owns redacted external monitoring, metrics and alert delivery; this is not observability sign-off.

`npm test --workspace @visit/api` covers canonicalization, hashed local challenges, cooldown, phone/IP quotas, exhaustion, expiry, concurrent verification, original SID/deadline retention, Redis/provider errors, lost operation ownership, duplicate provider approval after replay-key loss, strict provider SID binding, production mode/credential rejection and redacted logs. The exported browser suite exercises local OTP login and the complete booking/session journeys.

Live SMS delivery, account-specific Verify settings, geo/fraud controls and native OTP autofill remain VIS-43. The UI exposes no configured SMS capability when server delivery is disabled.

Primary provider references: [Verification lifecycle](https://www.twilio.com/docs/verify/api/verification), [Verification Check](https://www.twilio.com/docs/verify/api/verification-check), [retry guidance](https://www.twilio.com/docs/verify/developer-best-practices).
