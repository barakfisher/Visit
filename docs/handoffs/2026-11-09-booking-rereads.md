# Visit handoff — 2026-11-09, booking screen reads on events

Supersedes `2026-11-08-live-updates.md` for current state. Its decisions, lessons and debt still hold unless corrected below.

## Authorization

The user's global working agreement governs. The user approved building this slice and asked for it to come before the notification centre. The user then asked for a PR; merging was not part of that grant.

## Where things stand

The booking screen no longer polls slots or contact readiness, and it has no stream either: it reads on events. The reasoning and the rejected signal are in `docs/architecture/decisions.md`, "Booking screen reads on events — 2026-11-09". SSE stays as it was for the agenda and the customer's appointments.

Polling that remains: `ProviderAccess` (15 s, a security decision of its own), `ProviderApplication` and `AccountMethods`. `AccountMethods` appears on the booking screen when a verified contact is missing, so that screen can still poll in that one state.

## What a device run has and has not shown

Android, in Expo Go over Tailscale against a local API:
- Verified: the app bundles from this branch and starts on the phone, and it connects to the API.
- Not verified, by the user's choice: the booking screen itself. The API log for that run shows no availability reads and the database shows no bookings, so none of these ran: an untouched screen making no reads, choosing a slot taken elsewhere, the return from the background and from another screen, keeping the list with no network, and a refusal at confirm. The return is the one part with no automated test, so check it first.

iOS has not been run, because this Mac has no Xcode.

To run a phone here: `EXPO_PUBLIC_API_URL` must be an address the phone can reach. With `localhost`, the app starts and then shows "couldn't load your account", because `localhost` on the phone is the phone. A Metro meant for a phone does not work in a browser, because the API accepts only the one origin in `WEB_APP_URL`.

## Lessons (these will recur if forgotten)

- **Removing a poll removes what it was hiding.** The 15-second default `staleTime` meant a return to the screen would have shown a cached list and read nothing. The web suite also had a scenario that passed only because of the timer. Search for what depends on a timer before removing it.
- **A worktree's `node_modules` can be older than the lockfile.** This one had no `@fastify/sse`, so the API would not start. `npm ci` and `prisma generate` were needed first. Neither shows in `git status`.

## Debt worth knowing

- **There is no way to see how often customers lose a slot at the final step.** That number is what would justify adding a signal, and nothing records it.
- **The return to the screen and to the app is run by no automated test.** On web, TanStack's own window-focus refetch would read as well, so a web test would pass without `useScreenReturn`. Only a device run shows it, so a change to that hook needs one.
- **Accepted small gaps on the booking screen.** Contact details verified on another device show only on returning to the screen, and Confirm stays off until then. Provider details are not re-read on a return, as before; refreshing them silently during a move would also refresh the revision that protects the customer from overwriting a change. Confirm is active while the read from choosing a slot is in flight, and the commit refuses if the time is gone.
