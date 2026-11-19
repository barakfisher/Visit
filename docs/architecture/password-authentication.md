# Email and password sign-in (MVP)

Decided 2026-11-01 for the MVP; see the decision log. Being replaced slice by slice by [login-plan-stage-2.md](login-plan-stage-2.md): **sign-up proves the email with a code (slice 1) is built**; reset and change are not. It replaces, for now, the "no password" rule in [email-authentication.md](email-authentication.md). Email-link, phone and Google sign-in stay implemented.

## Behaviour

- **Sign up** (`POST /v1/auth/password/sign-up`): name, email, a password of 8 to 128 characters and the app's language. It creates no account: it stores a `PendingSignUp` (name, address, scrypt hash, HMAC of a six-digit code, 10 minutes, 5 attempts) and emails the code, then answers `202` with an opaque `pendingId` and `resendAfterSeconds: 30`. `POST .../sign-up/verify` with the pending id and the code creates the identity with a verified email, the password with no `unprovenEmail`, and a session, in one transaction under the address lock. `POST .../sign-up/resend` puts a new code on the same pending sign-up. Customers and providers sign up the same way; a provider then applies for a business and an administrator approves it.
- **A registered address** gets the same `202`, the same limits and an email "you already have an account: sign in as usual" (no link) in its owner's language. Its pending row holds no password and no code, so verification always fails. Sign-up no longer reveals which addresses exist; `EMAIL_TAKEN` is gone. If the address is taken while a code is pending, the right code answers `409 ACCOUNT_EXISTS` ("sign in").
- **Sign-up errors** (all localized in the app): `SIGN_UP_CODE_INVALID` (try again), `SIGN_UP_TOO_MANY_ATTEMPTS` and `SIGN_UP_EXPIRED` (start over; an unknown, reused, superseded or expired pending id all answer `SIGN_UP_EXPIRED`), `EMAIL_DELIVERY_FAILED`, `METHOD_NOT_CONFIGURED` when email delivery is unavailable, `429`, `503`.
- **Sign in** (`POST /v1/auth/password/sign-in`): email and password. A wrong password, an unknown email and an account without a password all answer `401 INVALID_CREDENTIALS`, and an unknown email still costs one hash comparison, so neither the message nor the timing tells them apart.
- **Limits** (Redis, `visit:password:limit:*`): every sign-in attempt counts against the IP (30 per 15 minutes). Only failed passwords count against an address: 10 per 15 minutes from one IP and 100 per hour overall, so a stranger cannot lock the owner out by trying their email, and correct sign-ins never add up. Sign-up: 10 sends per IP per hour (sign-up and resend together); per address, whoever asks, 30 seconds between sends and 5 per hour; verification 20 per IP per 15 minutes, and 20 wrong codes per address per day across resends and IPs. If Redis is unavailable, every route refuses with `503` instead of skipping the limits, and nothing is sent. Pending sign-ups are deleted a day after they expire (the security notification worker's cleanup); a new sign-up for the address supersedes the old one.
- **Storage:** `PasswordCredential` holds an scrypt hash (N=2^15, r=8, p=1, 16-byte salt, self-describing `scrypt$N$r$p$salt$key`), kept out of `Identity` so ordinary identity reads never carry it. `unprovenEmail` records the address an MVP account accepted without proof; it is null for verified sign-ups and is cleared when the account proves its email with the six-digit account code.
- **Login screen:** email and password come first, then a link to sign up, Google, and the provider entry. Phone sign-in appears only when SMS delivery is configured; email-link sign-in stays at `/auth/email` but is not linked from the login screen.

## The trusted email of MVP accounts and its risk

This applies only to accounts created before slice 1 (locally, 14 test accounts; production starts empty). Their address is not proven. It is marked verified so every flow that needs a verified email works (booking contact rules, team invitations by email, administrator promotion, review notifications). The consequence: someone who signs up first with another person's address holds that address in Visit and receives Visit's mail about it. (Accepting a team invitation also needs the invitation link, which goes to the address.)

Two rules limit that:

- **The real owner wins.** When someone proves the address through the email-link flow, a password whose `unprovenEmail` is that address is deleted and every existing session of the account ends. Whoever registered it without proof can no longer sign in.
- **The password goes with the email.** Removing the email from the account deletes the password, so a later email cannot bring an old password back.

Still to do (stage 2 slices 2 and 3): password reset and change, and the password row in Account. The existing trusted accounts are not re-verified (decisions.md, "Login plan stage 2 scope").

## Creating test accounts locally

Run the API and app as usual (`npm run dev:api`, `npm run dev:mobile`) and open `http://localhost:8081`.

1. **Customer:** Create account → name, email, password → the code screen. With `EMAIL_DELIVERY_MODE=local-inbox`, a development build shows **Load local development contact code** (the loopback helper `POST /__dev/auth/sign-up-code`); with `resend`, use a real address (a `+` alias). Enter the code and you land on Home.
2. **Provider applicant:** Sign out → "Have a business? Register as a provider" → "Sign in to apply" → "Don't have an account? Create one". After sign-up and the code you return to the business application; submit it.
3. **Administrator** (once): sign up a third account, then find its ID and promote it from `apps/api`:

   ```sh
   docker exec visit-postgres-1 psql -U visit -d visit -c "SELECT id FROM \"Identity\" WHERE email = 'admin@example.test'"
   ../../node_modules/.bin/tsx scripts/promote-admin.ts --identity ID --operator "local testing" --reason "local test administrator" --confirm
   ```

   Promotion signs the administrator out; sign in again.
4. **Approve:** as the administrator, Account → application review → approve with a reason. The provider can now switch to provider mode with the switch in the header, set up the business and publish it.

## Independent review

A security review of the change found no blocker and three issues, all fixed before merge with tests: an unproven password surviving the real owner's email-link sign-in, a lock-out by trying someone's address, and a removed email leaving its password to be revived. It also flagged that a failed decoy hash could be cached; it is now retried. Remaining notes, accepted for the MVP: Account shows the unproven email as verified, notifications go to unproven addresses, and passwords are checked for length only.

## Verification

- `apps/api/test/password-sign-up.test.ts`: nothing exists before the code, the verified account and proven password after it, a registered address answered alike and left unchanged, wrong/exhausted/expired/unknown/foreign codes, supersede and resend, the taken-meanwhile answer, simultaneous verification, IP, address and verification limits, validation before writes, Redis outage, missing and failing delivery, the Hebrew/English emails without links, HTTP routes and the loopback development helper.
- `apps/api/test/password-login.test.ts`: hashing, one error for every sign-in failure, failure-only throttling that cannot lock out the owner, the real owner's email link ending an MVP account's unproven password, Redis outage, the sign-in route and cookie.
- `apps/api/test/account-methods.test.ts`: removing the email removes the password; proving the account's own address with the code clears `unprovenEmail`, so a later email link keeps the password.
- `apps/mobile/scripts/password-sign-in-smoke.ts` (in `npm run test:web`, with a local sign-up inbox injected): sign-up with the code screen (change address keeps the form, resend waits, a wrong code is refused, nothing exists before the right code), sign-out, wrong and correct password, Enter to submit, a registered address that looks the same and stays unchanged, the provider path back to the application, and the placeholder colour.
