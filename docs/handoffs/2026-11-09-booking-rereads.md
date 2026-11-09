# Visit handoff — 2026-11-09, booking screen reads on events

Supersedes `2026-11-09-notification-centre.md` for current state; read that one for the notification centre itself. Its decisions, lessons and debt, and those it carries from `2026-11-08-live-updates.md`, still hold unless corrected below.

## Authorization

The user's global working agreement governs. The user approved building this slice and asked for it to come before the notification centre. The user then asked for a PR; merging was not part of that grant.

## Where things stand

The booking screen no longer polls slots or contact readiness, and it has no stream either: it reads on events. The reasoning and the rejected signal are in `docs/architecture/decisions.md`, "Booking screen reads on events — 2026-11-09". SSE stays as it was for the agenda and the customer's appointments.

Polling that remains: `ProviderAccess` (15 s, a security decision of its own), `ProviderApplication` and `AccountMethods`. `AccountMethods` appears on the booking screen when a verified contact is missing, so that screen can still poll in that one state.

The booking screen moves gradually when a time is refused or leaves the list. On web at phone width, with the list scrolled to its end, a sampled run shortened the page by 252 px in steps of at most 37 px a frame and left Confirm in place. **Android, where the jump was seen, and right-to-left glide on a device were not checked before this merged, by the user's choice**, and neither was the reduce-motion setting. An attempt on the phone reported a connection problem whose error was never seen: at that moment the phone had open connections to the API and Metro, and the API log showed no failed request after the normal 401 and refresh. Check the booking screen on Android first; if it looks wrong, this is the suspect. "The time is gone" is a toast (`isPassingBookingRefusal`); a cutoff, a contact requirement and an uncertain result stay in the bottom bar, because they must still be there when the customer looks. Times glide with Reanimated in `TimeChips`, and `SmoothHeight` carries the height of the grid, the review card and the bottom bar over time. The reasoning is in `docs/architecture/decisions.md`, "A smooth booking screen — 2026-11-09".

## What a device run has and has not shown

Android, in Expo Go over Tailscale against a local API:
- Verified: the app bundles from this branch and starts on the phone, and it connects to the API.
- Not verified, by the user's choice: the booking screen itself. The API log for that run shows no availability reads and the database shows no bookings, so none of these ran: an untouched screen making no reads, choosing a slot taken elsewhere, the return from the background and from another screen, keeping the list with no network, and a refusal at confirm. The return is the one part with no automated test, so check it first.

iOS has not been run, because this Mac has no Xcode.

To run a phone here: `EXPO_PUBLIC_API_URL` must be an address the phone can reach. With `localhost`, the app starts and then shows "couldn't load your account", because `localhost` on the phone is the phone. A Metro meant for a phone does not work in a browser, because the API accepts only the one origin in `WEB_APP_URL`.

## Lessons (these will recur if forgotten)

- **Removing a poll removes what it was hiding.** The 15-second default `staleTime` meant a return to the screen would have shown a cached list and read nothing. The web suite also had a scenario that passed only because of the timer. Search for what depends on a timer before removing it.
- **A message moved out of the layout does not end the jump by itself.** The time leaving the selection also removes the review card, which shortens the page and throws a scrolled customer upward. Look for everything a state change removes, not only what the report names.
- **A worktree's `node_modules` can be older than the lockfile.** This one had no `@fastify/sse`, so the API would not start. `npm ci` and `prisma generate` were needed first. Neither shows in `git status`.

## Debt worth knowing

- **PR #49 was open when this merged, and it says the jump is unchanged.** Its line "The refusal message and a slot leaving the list make the booking screen jump … Nothing has been changed yet" is out of date from here on. Delete that line when #49 merges.
- **`test:web` failed once in three runs on a step this change does not touch.** `provider-agenda-smoke.ts:60` timed out waiting for the "Business settings" button, and the next run on the same code passed. The cause was not looked into.
- **There is no one-click way to run on a phone.** The run panel's scripts all use the `.env` address, `localhost`, which a phone cannot reach. The Metro that works sets `EXPO_PUBLIC_API_URL` and `REACT_NATIVE_PACKAGER_HOSTNAME` to the Mac's Tailscale address and uses its own port. The user decided not to add a script for now.
- **There is no way to see how often customers lose a slot at the final step.** That number is what would justify adding a signal, and nothing records it.
- **The return to the screen and to the app is run by no automated test.** On web, TanStack's own window-focus refetch would read as well, so a web test would pass without `useScreenReturn`. Only a device run shows it, so a change to that hook needs one.
- **Accepted small gaps on the booking screen.** Contact details verified on another device show only on returning to the screen, and Confirm stays off until then. Provider details are not re-read on a return, as before; refreshing them silently during a move would also refresh the revision that protects the customer from overwriting a change. Confirm is active while the read from choosing a slot is in flight, and the commit refuses if the time is gone.
