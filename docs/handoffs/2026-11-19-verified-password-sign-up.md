# Visit handoff — 2026-11-19, login plan stage 2 slice 1 (verified password sign-up) (PR #TBD)

Built on `main` after PR #78 and merged with PR #77. Plan: [login-plan-stage-2.md](../architecture/login-plan-stage-2.md), slice 1. Decisions: `decisions.md`, "Verified password sign-up".

## Authorization

The user's global working agreement governs. A parent session asked for slice 1 as one PR, with the PR opened only on the user's request. The user approved the acceptance criteria and answered four questions:
- **Resend wait:** 30 seconds, and it only disables the button.
- **Resend:** works by pending id.
- **"Already have an account" email:** no link.
- **Email language:** the owner's stored language, else the app's.
- **Bug 2:** fix it in this PR too (after the security review showed bug 1's fix did not reach the MVP accounts).

## Where things stand

- **New sign-ups:**
  - A password sign-up creates nothing until the emailed six-digit code is right.
  - The account is then created with a verified email, a password without `unprovenEmail`, and the app's language.
  - A registered address gets the same answer and a "you already have an account" email.
  - `EMAIL_TAKEN` is gone from the API and the app.
- **Code screen:** shows the address on its own line, "Send again" with a 30-second countdown, "Change email address" (the form keeps its fields) and, in development builds, a button that loads the local code. Reloading the page in the browser returns to the form; the pending id lives only in memory.
- **Account code:** proving the account's email with the six-digit account code clears `unprovenEmail` (bug 1 of the plan), and an MVP account can now prove its own trusted address with it (bug 2).
- **`requireVerifiedEmail`:** the policy save refuses it while email delivery is unavailable. `/api/auth/capabilities` reports `email` from the account delivery; it used to always say `true`.
- **Next:** slice 2 (password reset with a code). Slice 2 should add a "forgot your password?" line to the "already have an account" email (`sign-up-delivery.ts`, `signUpEmail`).

## Lessons

- **Bugs 1 and 2 had to be fixed together.** Fixing bug 1 alone (clearing `unprovenEmail` on code proof) never reached the 14 MVP accounts' own address: bug 2 (`alreadyVerified`) refused the code for an address already marked verified. `bf-security-reviewer` caught it; the user chose to fix bug 2 in this PR. An MVP owner can now enter their own address under Account → sign-in methods, prove it with the code, and keep their password through a later email link. A proven address is still refused (`METHOD_UNAVAILABLE`), and the security event is `LINKED`, not `REPLACED`. There is no one-tap "verify this email" button; the owner types the address. Because whoever reads the code may not hold the account, this case sends its own warning email (`purpose: 'confirm-own'` in `account-delivery.ts`); a second security pass asked for it.
- **A registered address must get a pending row too**, or resend, attempt counts and expiry would behave differently and reveal it. Its row holds no password and no code, and a database `CHECK` enforces that.
- **Test runs share the development database's `_prisma_migrations`.** The migration was renamed to `20261120130000_pending_sign_up` so it sorts after PR #77's. The local `visit` and `visit_test` databases had it under the old name and were updated by hand (`UPDATE _prisma_migrations SET migration_name = ...`). A database that ran this branch before the rename needs the same update.
- **The browser suite reads sign-up codes from an injected local inbox** (`web-smoke.mts` passes `signUpInbox` to `password-sign-in-smoke.ts`). Repeating a sign-up for one address within 30 seconds needs the cooldown key cleared; the smoke does that.
- **Never edit a smoke script while `test:web` runs.** It exports the web bundle first, so a mid-run text change fails on strings the old bundle lacks.
- **The worktree's `.env` is a symlink to the main checkout's**, which holds a live Resend key. The browser check ran the API with `EMAIL_DELIVERY_MODE=local-inbox`, overridden in `.claude/launch.json` (`api-signup-check`, port 3007; web on 8087).

## Not verified

- **Checked:**
  - API suite: 504/504 on the final branch (after merging `main` and fixing bug 2) (`password-sign-up.test.ts` 11 tests; the bug 1 test in `account-methods.test.ts` failed before the fix).
  - Browser suite (`npm run test:web`, including the updated `password-sign-in-smoke.ts`): passed (exit 0) when run alone. One earlier run failed in `manual-booking-smoke.ts:76` (an alert counted on the Add appointment form) while the API suite ran at the same time; that code is untouched here and PR #77's CI passed it, so it is treated as load flakiness, not fixed.
  - Mobile foundation tests: 241/241.
  - Typecheck: clean. The API test typecheck has only the known `booking-operations.test.ts:141`.
- **Browser check:** the browser pane at 375px in Hebrew RTL.
  - Form → code screen → a wrong code gave the Hebrew error, with the countdown running → the local code → Home.
  - The database row: verified, `preferredLocale` `he`, no `unprovenEmail`.
  - The pending row of an abandoned sign-up stayed unconsumed, as it should until it expires.
- **Security review:** `bf-security-reviewer` found nothing high or medium.
  - **Fixed:** F1, a long-term guess budget per address. Wrong codes are now capped at 20 per address per day.
  - **Accepted and logged:** F2, superseding someone's pending sign-up; F3, separate email budgets for sign-up and the email link.
  - **Debt:** Q2, the dev helper's gating.
- **Not checked:**
  - Native iOS and Android.
  - English layout of the code screen (covered by the smoke at 390px).
  - Real Resend delivery of the two new emails; tests inject a fake transport.
  - Timing parity between registered and new addresses against real Resend.

## Debt

- **Development helpers trust `NODE_ENV=development` and a loopback IP**, and `NODE_ENV` defaults to `development` (`env.ts`). A deploy behind a proxy on the same host without `TRUSTED_PROXY_CIDRS` would expose the helpers: the new `/__dev/auth/sign-up-code`, and the existing `/__dev/mailbox` and `/__dev/account/contact-code`. Raised by `bf-security-reviewer`.
- **The "you already have an account" email** goes out up to 5 times an hour per address at a stranger's request (the same limits as codes).
- **Pending sign-ups are cleaned by the security notification worker**, which runs only inside the API server.
- Unchanged from earlier handoffs: tests read `.env` for the database, and shell-exported provider keys reach tests.
