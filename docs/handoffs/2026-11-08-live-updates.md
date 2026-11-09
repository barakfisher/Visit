# Visit handoff — 2026-11-08, live updates over SSE

Supersedes `2026-11-03-manual-run.md` for current state. Its decisions, lessons and debt still hold unless corrected below.

## Authorization

The user's global working agreement governs. The user asked for QA and then a PR on this work; merging was not part of that grant.

## Where things stand

The agenda and the customer's appointments no longer poll. The server sends a signal with no data, and the client re-reads through its ordinary authorized GET. Decisions are in `docs/architecture/decisions.md` under "Live agenda over SSE, without polling — 2026-11-08" and "Running on a device — 2026-11-08".

The next item, in the order the user set: **booking slot availability**, which still polls every 2 seconds (and `contact-readiness` every 10). The user wants to avoid polling wherever possible, but agreed to discuss this one before building it. Other `refetchInterval`s remain: `ProviderAccess` (15 s, a security decision of its own), `ProviderApplication` and `AccountMethods`.

## What a device run has and has not shown

Android, in Expo Go against a local API:
- Verified: streams open, a cancel from a browser updates "my appointments" about 0.33 s later without touching the phone, and a return from the background shows the change. Session refresh and reconnect happened without a sign-out.
- Not verified: the agenda open on a phone against an outside cancel, Wi-Fi to cellular and back, idle beyond about 80 s, a full 15-minute stream end. The user chose to test these edge cases later. The foreground re-read was added after that run, so it has not been seen on a device.

iOS has not been run at all, and this Mac has no Xcode. Also run by no test: 6+ visible tabs on purpose (the web suite reached it by accident) and takeover when a real tab hides, because Playwright pages always count as visible.

## Lessons (these will recur if forgotten)

- **Passing web, Storybook and the types say nothing about a device.** The first Android run crashed twice on code long on `main`: `accessibilityRole="status"`, and `Intl.PluralRules`, which Hermes does not have. A screen not opened on a device is unverified there. Metro receives a device's JS errors, but a native red box may only be visible on the device, so ask for a screenshot.
- **Test web on `localhost` or HTTPS, never a LAN address.** Over plain HTTP on `192.168.x.x` the browser has no `crypto.randomUUID`, so `expo-crypto` throws and booking fails before any request, showing "couldn't verify the booking outcome". That message also appears when nothing was sent. Web Locks are missing there too.
- **To run a phone and a browser against one API,** use two Metro servers: one on the LAN address for the phone, and one on `localhost` with `EXPO_PUBLIC_API_URL=http://localhost:<api port>` and `WEB_APP_URL` set to that Metro. The two share one local database. `.env` is dotenv syntax, not shell: `EMAIL_FROM=Visit <login@localhost>` breaks `. .env`.
- **Other sessions share Redis db 1 and Postgres.** The web suite's OTP limit failed twice while other work ran on them, and passed alone. Run the suites one at a time. The extra counts were never traced to a source.

## Debt worth knowing

All is in the decision log. The ones most likely to bite:
- **Refresh replay can sign out a user with two windows open.** The security review considers it understated; the entry says how to measure it and what to reopen.
- **With no polling, some failures are silent,** and there is no "not live" state. One phone may fill its own stream cap by switching networks (inferred).
- **There is no rate limit on booking writes,** so a cancel-and-rebook loop can still drive agenda re-reads.
- **Signals use real Redis in tests; the 15-minute bound and signalling on the customer reschedule route and the manual recovery path have no test.** The API test environment still imports `env.ts`, which runs dotenv; this predates the slice.
