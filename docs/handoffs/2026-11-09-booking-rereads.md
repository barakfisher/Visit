# Visit handoff — 2026-11-09, booking screen reads on events

Supersedes `2026-11-09-notification-centre.md` for current state; read that one for the notification centre itself. Its decisions, lessons and debt, and those it carries from `2026-11-08-live-updates.md`, still hold unless corrected below.

## Authorization

The user's global working agreement governs. The user approved building this slice and asked for it to come before the notification centre. The user then asked for a PR; merging was not part of that grant.

## Where things stand

The booking screen no longer polls slots or contact readiness, and it has no stream either: it reads on events. The reasoning and the rejected signal are in `docs/architecture/decisions.md`, "Booking screen reads on events — 2026-11-09". SSE stays as it was for the agenda and the customer's appointments.

Polling that remains: `ProviderAccess` (15 s, a security decision of its own), `ProviderApplication` and `AccountMethods`. `AccountMethods` appears on the booking screen when a verified contact is missing, so that screen can still poll in that one state.

## What a device run has and has not shown

Android, in Expo Go over Tailscale, on 2026-11-09, from `main` at the merge of PR #48. The phone and the browser customer each had their own API process on one database, so each logged request belongs to one client. The customers booked Dana Studio; the times below are that business's local time.

| Check | Result | Evidence |
| --- | --- | --- |
| An untouched screen makes no reads | Passed | No phone request of any kind from 12:27:07 to 12:32:20, while 11:00 was taken and stayed on screen. |
| Return from the background | Passed | 12:32:20: `availability` and `contact-readiness`, with no provider read and no `POST /api/me/providers`, so the screen did not remount. 11:00 left the list. |
| Return from another screen | Passed | Notifications opened at 12:34:46. On return at 12:35:00: `availability` and `contact-readiness`, with no provider read. 11:30 left the list. |
| Choosing a slot taken elsewhere | Passed | 12:00 was taken at 12:38:35. Choosing it made one `availability` read at 12:38:55 and no commit. A screenshot shows "השעה הזו אינה פנויה עוד" and 12:00 gone. |
| A slot taken while the review is open | Passed | 15:00 was taken at 12:54:57. Confirm at 12:55:26: `POST /api/bookings/commit` 409, the attempt `REJECTED`, no new booking, then re-reads. A screenshot shows the same message and 15:00 gone. |
| No network keeps the list | Reported, weaker evidence | The user reports the list stayed after choosing a slot in airplane mode with Wi-Fi off. The API log is silent from 12:48:59 to 12:50:14, which fits but cannot prove it. There is no screenshot. |

The 409's code is not in the log, which records no response bodies. The message on screen appears only for `SLOT_TAKEN` or `SLOT_LOCKED`, and `apps/api/test/availability.test.ts` asserts `SLOT_TAKEN` on this path.

Not explained: the first bundle in this run logged `Cannot find native module 'ExpoCrypto'`, and the routes importing it, including `booking/[providerId]`, were reported as missing a default export. After a reload it never recurred, and the same module generated the idempotency keys for the phone's bookings. A first load showing it is worth a reload before suspecting the code.

iOS has not been run, because this Mac has no Xcode.

To run a phone here: `EXPO_PUBLIC_API_URL` must be an address the phone can reach. With `localhost`, the app starts and then shows "couldn't load your account", because `localhost` on the phone is the phone. A Metro meant for a phone does not work in a browser, because the API accepts only the one origin in `WEB_APP_URL`.

## Lessons (these will recur if forgotten)

- **Removing a poll removes what it was hiding.** The 15-second default `staleTime` meant a return to the screen would have shown a cached list and read nothing. The web suite also had a scenario that passed only because of the timer. Search for what depends on a timer before removing it.
- **A worktree's `node_modules` can be older than the lockfile.** This one had no `@fastify/sse`, so the API would not start. `npm ci` and `prisma generate` were needed first. Neither shows in `git status`.
- **A passing look on the phone can come from the wrong path, so read the log's shape.** A first "the slot disappeared" was a fresh entry to the screen: the in-app "חזרה לדף הבית" link had been used instead of Android's home gesture. A return reads `availability` and `contact-readiness`; a fresh entry also reads the provider and posts `/api/me/providers`.
- **Any return refreshes the list, which is the feature and also ruins the test.** Opening notifications or leaving the app before choosing removes the taken slot, so "choosing a taken slot" cannot run. The person on the phone chooses or holds still until told.
- **A fresh entry resets the date to today, and the request log shows neither date nor client.** One attempt at a refusal booked today's 14:30 while the other customer had taken 14:30 on the test date. It succeeded correctly. Have the phone's date confirmed before taking a slot, and give each client its own API when a run needs to tell them apart.
- **Airplane mode does not mean offline.** Wi-Fi can stay on with the airplane icon showing, and a booking "made offline" went through normally. Check that the Wi-Fi and VPN icons are gone.

## Debt worth knowing

- **There is no way to see how often customers lose a slot at the final step.** That number is what would justify adding a signal, and nothing records it.
- **The return to the screen and to the app is run by no automated test.** On web, TanStack's own window-focus refetch would read as well, so a web test would pass without `useScreenReturn`. Only a device run shows it, so a change to that hook needs one.
- **The refusal message and a slot leaving the list make the booking screen jump.** Seen on Android during this run. The user wants these smooth: a toast or snackbar for the message, and an animated change for the list. Nothing has been changed yet.
- **Accepted small gaps on the booking screen.** Contact details verified on another device show only on returning to the screen, and Confirm stays off until then. Provider details are not re-read on a return, as before; refreshing them silently during a move would also refresh the revision that protects the customer from overwriting a change. Confirm is active while the read from choosing a slot is in flight, and the commit refuses if the time is gone.
