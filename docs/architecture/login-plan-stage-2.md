# Login plan stage 2: verified sign-up, password reset and change

Agreed with the user 2026-11-19. Plan only; nothing here is built yet. Part of
[login-plan.md](login-plan.md) stage 2; decisions in `decisions.md`, "Login plan stage 2 scope" (PR #78).

## Problem

Password sign-up marks the email verified without proof (the MVP decision of 2026-11-01). Whoever
signs up first with an address holds it in Visit, receives its mail and blocks the real owner
(`409 EMAIL_TAKEN`). There is no way to recover a forgotten password or to change one.

## What depends on a verified email today (measured read-only on `main` @ c08f86f)

| Flow | Where | Without a verified email |
|---|---|---|
| Booking at a business with `requireVerifiedEmail` | `customer-contact.utils.ts`, the booking trigger | Customer must verify inline (exists). With email delivery off, nobody can: the business is unbookable, the same trap as the verified phone (decision of 2026-11-03). |
| Booking snapshot | booking trigger, `customerEmail` | Not captured: the agenda and customer cards show no email |
| Team invitation by email | `business-access.ts` `checkInvite` | `403 INVITATION_RECIPIENT` |
| Administrator promotion | `admin-role.ts` | Refused unless a phone is verified |
| Provider review notification | `provider-review.ts` | In the app only |
| Security alerts | `account-security.ts` `previousSecurityChannels` | No email channel |
| Usable sign-in methods | `account-security.ts`, `account-methods.ts` | 0 for a password-only account (a password is not a method) |

Not affected: password sign-in, the provider application, sessions.

Two latent bugs in the six-digit account code:

1. Verifying the account's own email with the code does not clear `PasswordCredential.unprovenEmail`.
   A later email-link sign-in by the same owner then deletes their own password and ends their
   sessions (`email-login.ts`, "the real owner wins"). **Fixed in slice 1.**
2. An account whose email was trusted at sign-up cannot verify it with the code
   (`alreadyVerified` answers `METHOD_UNAVAILABLE`). Moot while those accounts stay verified (below).

Local data: 14 password accounts, all with `unprovenEmail = email`.

## Scope

1. A new account exists only after its email is proven with a six-digit code.
2. Password reset with a six-digit code.
3. Changing or setting the password from Account.

## Non-goals

- **Re-verifying the existing trusted accounts.** They are test accounts, not real users, and stay
  verified (the user's call). Production starts empty, so no unproven account exists there.
  `unprovenEmail` stays on them, so "the real owner wins" still protects their addresses.
- A reset link in the email: to be discussed at stage 5, when the domain hosts the API and
  Universal Links / App Links exist.
- Email one-time code sign-in (stage 3), account merging, password strength beyond length, and
  making tests hermetic.

## Slice 1: sign-up proves the email first

*Built (decisions.md, "Verified sign-up"). The code step is on the same screen, wrong codes also count per address over a day, and the `requireVerifiedEmail` rule below was dropped: `env.ts` never lets email delivery be off.*

- `POST /v1/auth/password/sign-up` validates name, email and password, then stores a pending
  sign-up (name, email, scrypt hash, HMAC of a six-digit code, 10-minute expiry, 5 attempts,
  delivery state) and sends the code. It always answers `202` with a pending id and a cooldown.
  **An address that already has an account gets an email "you already have an account: sign in or
  reset your password" instead of a code, with the same answer and limits,** so sign-up no longer
  reveals which addresses are registered. `EMAIL_TAKEN` is no longer returned by sign-up.
- `POST /v1/auth/password/sign-up/verify` with the pending id and code creates the identity with
  `emailVerifiedAt` set, the password credential with no `unprovenEmail`, and the session, in one
  transaction under the email lock. The pending row is consumed atomically. If the address was
  taken meanwhile, the answer says to sign in (after proof, so it reveals nothing to a stranger).
- Limits: existing 10 sign-ups per IP per hour; per address a 30-second cooldown and 5 sends per
  hour; verification 20 attempts per IP per 15 minutes. Redis unavailable: `503`, nothing sent.
  Pending rows are removed a day after expiry. A new code for the same address supersedes the old.
- Email delivery unavailable: sign-up answers `503 METHOD_NOT_CONFIGURED`. Locally, `local-inbox`
  plus a loopback-only development helper shows the code (like `/__dev/account/contact-code`).
- ~~`requireVerifiedEmail` follows the verified-phone rule: `409 VERIFIED_EMAIL_UNAVAILABLE` from the
  policy save while email delivery is unavailable, and the editor switch reads capabilities.~~ Dropped
  when built: email delivery cannot be off (`env.ts`), so the rule could never run.
- Code verification of the account's own address clears `unprovenEmail` (bug 1).
- UI: the sign-up form leads to a code screen ("we sent a code to …", resend with cooldown, change
  the address). Emails in the user's locale, Hebrew and English.

## Slice 2: password reset

- "Forgot password?" on the login screen → email → code → new password → signed in.
- `POST /v1/auth/password/reset` always answers the same. A known address with an account gets a
  code bound to that identity, address and security version; **an unknown address gets nothing**
  (no bounces). Same code rules and limits as slice 1.
- `POST /v1/auth/password/reset/verify` with the code and the new password, under the identity
  lock: sets or replaces the password (**an account without a password, e.g. Google or email link
  only, gets one**), sets `emailVerifiedAt` if missing, clears `unprovenEmail`, ends every session,
  writes a security event, alerts the verified channels, and **signs in on this device** with a
  new session.
- A wrong code returns to the code screen without losing the typed password.

## Slice 3: change or set the password

- Account → sign-in methods shows a "Password" row (set / not set) with Change or Set.
- Change needs the current password or a sign-in within the last 5 minutes, like other method
  changes. Failed current passwords count like failed sign-ins. Other sessions end, a security
  event is written and the verified channels are alerted; this device stays signed in.
- The password signs in with the email, so it does not count as a separate usable method, and
  removing the email still removes it (unchanged).

## Acceptance criteria (every slice)

- **Empty:** no pending sign-up or reset leaves anything behind; an abandoned one expires.
- **Loading:** send and verify buttons show progress and are disabled while a request runs.
- **Error:** wrong code, expired code, too many attempts (start over), delivery failure, rate limit
  and `503` each have a localized message; nothing is half-written.
- **Permission denied:** an expired or reused pending id, a code for another address or identity,
  and a reset after the email changed are all refused the same way.
- Same answer and comparable timing for known and unknown addresses at sign-up and reset.
- Tests never send real mail (local inbox injected; the `env.ts` guard from PR #75 stays).
- Each PR: API suite, browser suite (`password-sign-in-smoke.ts` updated), typecheck, a browser
  check at 375 px in Hebrew RTL, `bf-security-reviewer`, a handoff and a `decisions.md` entry.
