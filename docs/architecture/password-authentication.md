# Email and password sign-in (MVP)

Decided 2026-11-01 for the MVP; see the decision log. It replaces, for now, the "no password" rule in [email-authentication.md](email-authentication.md). Email-link, phone and Google sign-in stay implemented.

## Behaviour

- **Sign up** (`POST /v1/auth/password/sign-up`): name, email and a password of 8 to 128 characters. It creates an ordinary `USER` identity, marks the email verified, stores the password credential and signs the person in. Customers and providers sign up the same way; a provider then applies for a business and an administrator approves it.
- **Sign in** (`POST /v1/auth/password/sign-in`): email and password. A wrong password, an unknown email and an account without a password all answer `401 INVALID_CREDENTIALS`, and an unknown email still costs one hash comparison, so neither the message nor the timing tells them apart.
- **Existing email:** sign-up answers `409 EMAIL_TAKEN` and never changes or enters the existing account, whichever method created it. This does reveal that the address is registered, which the MVP accepts.
- **Limits** (Redis, `visit:password:limit:*`): every sign-in attempt counts against the IP (30 per 15 minutes). Only failed passwords count against an address: 10 per 15 minutes from one IP and 100 per hour overall, so a stranger cannot lock the owner out by trying their email, and correct sign-ins never add up. Sign-up: 10 per IP per hour. If Redis is unavailable, both refuse with `503` instead of skipping the limits.
- **Storage:** `PasswordCredential` holds an scrypt hash (N=2^15, r=8, p=1, 16-byte salt, self-describing `scrypt$N$r$p$salt$key`), kept out of `Identity` so ordinary identity reads never carry it. `unprovenEmail` records the address accepted without proof.
- **Login screen:** email and password come first, then a link to sign up, Google, and the provider entry. Phone sign-in appears only when SMS delivery is configured; email-link sign-in stays at `/auth/email` but is not linked from the login screen.

## The trusted email and its risk

The address is not proven. It is marked verified so every flow that needs a verified email works (booking contact rules, team invitations by email, administrator promotion, review notifications). The consequence: someone who signs up first with another person's address holds that address in Visit and receives Visit's mail about it. (Accepting a team invitation also needs the invitation link, which goes to the address.)

Two rules limit that:

- **The real owner wins.** When someone proves the address through the email-link flow, a password whose `unprovenEmail` is that address is deleted and every existing session of the account ends. Whoever registered it without proof can no longer sign in.
- **The password goes with the email.** Removing the email from the account deletes the password, so a later email cannot bring an old password back.

Before the MVP ends: re-verify accounts whose `PasswordCredential.unprovenEmail` still equals `Identity.email`, add password reset and change (which need real email delivery), and list the password as its own sign-in method in Account.

## Creating test accounts locally

Run the API and app as usual (`npm run dev:api`, `npm run dev:mobile`) and open `http://localhost:8081`.

1. **Customer:** Create account → name, email, password. You land on Home.
2. **Provider applicant:** Sign out → "Have a business? Register as a provider" → "Sign in to apply" → "Don't have an account? Create one". After sign-up you return to the business application; submit it.
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

- `apps/api/test/password-login.test.ts`: hashing, sign-up writes, existing-email and simultaneous sign-ups, validation before writes, one error for every sign-in failure, failure-only throttling that cannot lock out the owner, the real owner's email link ending the unproven password, Redis outage, HTTP routes and cookie.
- `apps/api/test/account-methods.test.ts`: removing the email removes the password.
- `apps/mobile/scripts/password-sign-in-smoke.ts` (in `npm run test:web`): sign-up, sign-out, wrong and correct password, Enter to submit, duplicate email, the provider path back to the application, and the placeholder colour.
