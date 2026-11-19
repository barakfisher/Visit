# Visit handoff — 2026-11-19, verified sign-up (login stage 2, slice 1) (PR #PR_NUMBER)

Built on `main` after PR #77. Plan: [login-plan-stage-2.md](../architecture/login-plan-stage-2.md), slice 1. Decisions: `decisions.md`, "Verified sign-up".

## Authorization

The user's global working agreement governs. The user chose slice 1 as the next step and answered two questions: the code step on the same screen, and dropping the `requireVerifiedEmail` rule that could never run. Commit and PR wait for the user's go-ahead.

## Where things stand

- **New password accounts exist only after a six-digit email code.** `POST /v1/auth/password/sign-up` stores a `PendingSignUp` and answers `202 { signUp, expiresInSeconds, resendAfterSeconds }` for every address; `POST /v1/auth/password/sign-up/verify` creates the identity (email verified), the password (no `unprovenEmail`) and the session. Sign-up no longer returns `EMAIL_TAKEN`; verify does, only after a right code for an address registered meanwhile.
- **Limits** (`SIGN_UP_LIMIT`, `SIGN_UP_CODE`, `SIGN_UP_VERIFY_LIMIT` in `password-login.ts`): 10 sign-ups per IP per hour; per address a 30-second cooldown, 5 sends per hour and 15 wrong codes per day; 5 guesses per code; 20 code checks per IP per 15 minutes.
- **Email:** `accountDelivery.signUp` sends the code, or "you already have an account" for a registered address, in Hebrew unless the app sent `locale: 'en'`. The new account's `preferredLocale` is not set from it.
- **Development:** `POST /__dev/sign-up-code { signUp }` returns `{ code, existingAccount }` under `NODE_ENV=development`, `local-inbox` and a loopback address. The browser smoke reads the handle from the sign-up response and asks this route.
- **App:** the sign-up screen turns into the code step (`PasswordSignIn.component.tsx`, `usePasswordSignIn`); the handle is never in the URL or storage. Messages map in `src/lib/PasswordSignUp.ts`.
- **Bug fixed:** proving an address with the account code clears `unprovenEmail` (`account-methods.ts`).
- **Next:** slice 2, password reset with a code. The "already have an account" email does not mention a reset yet; add it when slice 2 ships.

## Lessons

- **The plan named a rule that could not run.** `env.ts` refuses `EMAIL_DELIVERY_MODE` other than `local-inbox` or `resend`-with-key, so "email delivery unavailable" never happens; measuring the configuration before building saved a dead branch. `capabilities.email` in `/api/auth/capabilities` is still a hard-coded `true` for the same reason.
- **Per-code attempt limits are not a guessing limit when codes can be reissued.** The reviewer's arithmetic (5 guesses × 5 codes an hour, forever) is why there is a daily per-address count. Slice 2's reset codes need the same daily count.
- **Lock order:** verify reads the pending row's address without a lock, then takes the address lock, then `FOR UPDATE` on the row — the same order as start (address lock, then rows). Reversing it deadlocks a resend against a verify.
- **A per-address cooldown trips tests that sign up the same address twice in a row.** The API tests remove the Redis cooldown key (`clearCooldown`); the browser smoke uses a second, pre-created registered address.
- **The worktree used database `visit_signup`** (Redis db 5). Browser checks ran on 127.0.0.1 ports 3009 (API, `NODE_ENV=development`) and 8089 (web); the web dev server needs `NODE_PATH=./node_modules` in a worktree, as `npm run start` sets.

## Not verified

- **Checked:**
  - **API:** full suite 504/504, typecheck clean. Tests cover: the daily cap at send and at verify, another sign-up's code refused, and the cleanup of rows a day past expiry. Mutation checks: removing the `unprovenEmail` fix fails the new account-methods subtest; removing the daily cap fails its test.
  - **Mobile:** tsc and lint clean, 242/242 unit tests, Storybook 278/278 (8 new `PasswordSignIn` stories).
  - **Browser pane, 375 px, Hebrew RTL, local inbox:** form → code step; a wrong code shows "הקוד שגוי"; the right code signs in to home with one session and a verified email; a registered address gets the same code step, its account unchanged and a row without password or code; "use a different email" returns to the filled form.
  - **`bf-qa`:** no blocker; its gaps were the cleanup, a code used with another sign-up's handle, and the cap only checked when sending (all three now tested and fixed). Left as debt below: the hook has no tests, and a daily cap shows "wait a few minutes".
  - **`bf-security-reviewer`:** no Critical or High. The Medium (no long-term guessing cap) is fixed and tested; a race on the unique email now answers `EMAIL_TAKEN` instead of 500.
- **Not checked:**
  - `test:web` (runs only against the shared `visit_test`): the updated `password-sign-in-smoke.ts` was typechecked, not run. CI runs it.
  - Real Resend delivery of the two new emails, and timing equality between a registered and a new address with real delivery.
  - Native iOS/Android and English layout of the code step; the countdown and resend cooldown in the browser (stories cover the states).
  - No hook tests for `usePasswordSignIn` (resend, change email, expiry); its states were checked in the browser and in stories only.

## Debt

- **The per-address budgets are shared** (accepted, decisions.md): a stranger can keep an address from password sign-up for an hour, or a day after 15 wrong codes. Email link and Google still work.
- **`/__dev/*` routes trust `request.ip` being loopback.** A non-production deploy behind a same-host reverse proxy without `TRUSTED_PROXY_CIDRS`, with `NODE_ENV` left at its `development` default, would expose sign-up codes (and `/__dev/mailbox` sign-in links). Production is safe: `env.ts` refuses `local-inbox` there. Registering these routes only in development and refusing `X-Forwarded-For` would close it.
- **After the daily wrong-code cap the app says "wait a few minutes"** (every 429 maps to `password.rateLimited`), though the block lasts a day.
- **A unique-key race during verify answers `EMAIL_TAKEN` without using up the pending row** (the transaction rolled back); harmless, since the code was right.
- **A failed delivery also cancels the previous working code** (the supersede commits first); the person waits out the 30-second cooldown.
- Unchanged from earlier handoffs: `requireBusinessMembership` does not filter `deletedAt`; tests read `.env` for the database. `apps/api` `tsconfig.test.json` reports an error in `booking-operations.test.ts:141`, a file this PR does not touch (that config is not run in CI).
