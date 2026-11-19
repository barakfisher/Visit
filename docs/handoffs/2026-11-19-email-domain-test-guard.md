# Visit handoff — 2026-11-19, sending domain and tests that cannot send (PR #TBD)

Built on `main` after PR #73. Decisions: `decisions.md`, "Tests never take outbound providers from .env". Login plan stage 2 has started.

## Authorization

The user's global working agreement governs. The user asked what Google on the phone needs, chose to wait for a domain, bought `my-visit.xyz`, and set up Resend themselves with guidance. They chose to fix the test exposure before putting a key in `.env`, and chose the `env.ts` guard over a `package.json`-only change.

## Where things stand

- **Domain:** `my-visit.xyz` at Spaceship (DNS is edited there). `my-vizit.xyz` was bought by mistake and is not used.
- **Resend:** `mail.my-visit.xyz` verified, region eu-west-1, click and open tracking off (tracking would rewrite sign-in links through Resend). DNS: DKIM TXT `resend._domainkey.mail`, CNAMEs `rsend.mail` and `send.mail`, DMARC `p=none` at `_dmarc`.
- **Not yet done:** no API key exists in `.env`; `EMAIL_DELIVERY_MODE` is still `local-inbox`. Next step: a sending-only key restricted to `mail.my-visit.xyz`, `EMAIL_FROM="Visit <login@mail.my-visit.xyz>"`, restart `dev:api`, send one real sign-in email to the user's own address.
- **Guard:** under Node's test runner, `env.ts` ignores email and SMS provider settings from `.env`.
- Google on the phone still waits for a hosted API on the domain (login plan stage 5).

## Lessons

- **`npm test` in `apps/api` reads the developer's `.env`** (`../../.env` from the working directory). Anything there configures tests, unless a test sets it explicitly.
- **With `EMAIL_DELIVERY_MODE=resend`, made-up addresses get real mail.** Manual testing in the browser with fake addresses would bounce and hurt the new domain's reputation; use real addresses or switch back to `local-inbox`.
- **The local `visit` database lagged `main`.** PR #72's migration was missing, which failed 76 tests and hung two (`publication`, `screen-flows`) for hours. Run `npx prisma migrate status` before trusting a red suite; `--test-timeout=120000` stops a hang.
- **`manual-booking.test.ts` creates a fixed phone (`+12025550123`)**; a run that dies before cleanup leaves the row and the test then fails on `Identity_phone_key` until the row is removed.
- **dotenv now loads into a separate object**, so `DOTENV_CONFIG_QUIET`/`DOTENV_CONFIG_DEBUG` from the shell no longer affect it, and its log line counts the file's keys, not the applied ones.

## Not verified

- **Checked:** API suite 414/415 with every request to Resend intercepted and `EMAIL_DELIVERY_MODE=resend`: 0 provider calls. The one failure is the `manual-booking` fixed phone above (local data, unrelated). New `environment-file.test.ts` (4 cases, synthetic `.env` in a temp dir) red before the change, green after. `--test-isolation=none` detection checked by hand (`--test` in `execArgv`). API typecheck clean. `bf-security-reviewer`: no vulnerabilities; precedence nit fixed (`Object.hasOwn`).
- **Not checked:** a real email through Resend (no key yet); deliverability (inbox vs spam).

## Debt

- Shell-exported provider keys still reach tests (see decision). Tests still read `.env` for the database and everything else, against the global rule; `prisma.config.ts` loads it too. A hermetic-tests task would give tests explicit configuration.
- The leftover `+12025550123` identity in the local `visit` database was not removed.
