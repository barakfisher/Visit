# Visit handoff — 2026-11-19, login plan stage 2 agreed (plan only)

Built on `main` after PR #76. Plan: [login-plan-stage-2.md](../architecture/login-plan-stage-2.md). Decisions: `decisions.md`, "Login plan stage 2 scope". No code changed.

## Authorization

The user's global working agreement governs. The user agreed the scope, the three slices and six design choices one question at a time. Building slice 1 needs the user's go-ahead in a new session.

## Where things stand

- Email delivery through Resend works locally (previous handoff). Nothing of stage 2's remaining work is built.
- **Next: slice 1**, sign-up proves the email with a six-digit code before the account exists, same answer for registered addresses. Then slice 2 (reset with a code), slice 3 (change or set the password).
- The 14 local password accounts stay verified with `unprovenEmail` set; they are not migrated.

## Lessons

- **The six-digit account code does not clear `PasswordCredential.unprovenEmail`.** An owner who verifies with the code and later signs in with an email link loses their own password (`email-login.ts` deletes a password whose `unprovenEmail` is the proven address). Slice 1 fixes it; until then, do not rely on the code to make a trusted account safe.
- **An account trusted at sign-up cannot verify its email with the code** (`account-methods.ts`, `alreadyVerified` answers `METHOD_UNAVAILABLE`). Harmless while those accounts stay verified.
- **Email links do not suit the phone yet.** `visit://` links from mail apps are unreliable and Expo Go cannot open them; a reset or sign-in link on the phone needs Universal/App Links on the hosted domain (stage 5). Codes work everywhere.
- **Once sign-up needs a code, made-up addresses cannot create accounts while `EMAIL_DELIVERY_MODE=resend`.** Use real addresses (`+` aliases) or `local-inbox` with the development code helper slice 1 adds.

## Not verified

- The table of verified-email dependencies was measured by reading code and the latest booking trigger, not by running each flow with an unverified account.

## Debt

- `requireVerifiedEmail` is still accepted while email delivery is off (slice 1 closes it). Locally one business has it on.
- Unchanged from earlier handoffs: tests read `.env` for the database; shell-exported provider keys reach tests.
