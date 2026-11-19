# Visit handoff — 2026-11-19, sending domain and tests that cannot send (PR #75)

Built on `main` after PR #74. Decisions: `decisions.md`, "Tests never take outbound providers from .env". Login plan stage 2 has started.

## Authorization

The user's global working agreement governs. The user asked what Google on the phone needs, chose to wait for a domain, bought `my-visit.xyz`, and set up Resend themselves with guidance. They chose to fix the test exposure before putting a key in `.env`, and chose the `env.ts` guard over a `package.json`-only change.

## Where things stand

- **Domain:** `my-visit.xyz` at Spaceship (DNS is edited there). `my-vizit.xyz` was bought by mistake and is not used.
- **Resend:** `mail.my-visit.xyz` verified, region eu-west-1, click and open tracking off (tracking would rewrite sign-in links through Resend). DNS: DKIM TXT `resend._domainkey.mail`, CNAMEs `rsend.mail` and `send.mail`, DMARC `p=none` at `_dmarc`.
- **Live locally (after PR #75, recorded in PR #76):** the main checkout's `.env` has `EMAIL_DELIVERY_MODE=resend`, a sending-only Resend key restricted to `mail.my-visit.xyz`, and `EMAIL_FROM="Visit <login@mail.my-visit.xyz>"`. A real sign-in link from `/auth/email` reached the user's inbox and signed them in. `/__dev/mailbox` now answers 404, by design. Next: agree the scope of the rest of stage 2 (see login-plan.md).
- **Guard:** under Node's test runner, `env.ts` ignores email and SMS provider settings from `.env`.
- Google on the phone still waits for a hosted API on the domain (login plan stage 5).

## Lessons

- **`npm test` in `apps/api` reads the developer's `.env`** (`../../.env` from the working directory). Anything there configures tests, unless a test sets it explicitly.
- **With `EMAIL_DELIVERY_MODE=resend`, made-up addresses get real mail.** Manual testing in the browser with fake addresses would bounce and hurt the new domain's reputation; use real addresses or switch back to `local-inbox`.
- **The local `visit` database lagged `main`.** PR #72's migration was missing, which failed 76 tests and hung two (`publication`, `screen-flows`) for hours. Run `npx prisma migrate status` before trusting a red suite; `--test-timeout=120000` stops a hang.
- **Merging to `main` needs the admin bypass.** The "main" ruleset restricts updates to admins, so `gh pr merge` reports BLOCKED even with green CI and no conflicts; `--admin` (with the user's approval) merges. Repository auto-merge is off.
- **Updating the main checkout restarts the running API.** `tsx watch` sees the changed files; after a merge that changes `schema.prisma`, run `npx prisma generate` in `apps/api` there and apply migrations, or the API fails on missing columns.
- **A duplicated key in `.env` silently takes the last value.** The first real key went in below the old `local-inbox` lines; it worked only because the new lines came last. Replace lines, don't append.
- **`manual-booking.test.ts` creates a fixed phone (`+12025550123`)**; a run that dies before cleanup leaves the row and the test then fails on `Identity_phone_key` until the row is removed.
- **dotenv now loads into a separate object**, so `DOTENV_CONFIG_QUIET`/`DOTENV_CONFIG_DEBUG` from the shell no longer affect it, and its log line counts the file's keys, not the applied ones.

## Not verified

- **Checked:** API suite 414/415 with every request to Resend intercepted and `EMAIL_DELIVERY_MODE=resend`: 0 provider calls. The one failure is the `manual-booking` fixed phone above (local data, unrelated). New `environment-file.test.ts` (4 cases, synthetic `.env` in a temp dir) red before the change, green after. `--test-isolation=none` detection checked by hand (`--test` in `execArgv`). API typecheck clean. `bf-security-reviewer`: no vulnerabilities; precedence nit fixed (`Object.hasOwn`).
- **Checked after merge:** one real sign-in email delivered and the link signed the user in (manual, user's own address). Full API suite 470/470 before merging PR #75.
- **Not checked:** whether the email landed in the inbox or spam; delivery to other providers (only the user's own address).

## Debt

- Shell-exported provider keys still reach tests (see decision). Tests still read `.env` for the database and everything else, against the global rule; `prisma.config.ts` loads it too. A hermetic-tests task would give tests explicit configuration.
- The leftover `+12025550123` identity was removed from the local `visit` database (with the user's approval); the fixed phone remains a trap for any crashed run.
