# Visit handoff — 2026-11-10, whole-card links, sheets that move, and a paged history screen

Supersedes `2026-11-10-appointments-consent.md` for current state. Its lessons and debt still hold unless corrected below.

## Authorization

The user's global working agreement governs. The user reviewed My appointments and the business page twice on an Android phone, chose each option below (chevron by the title, whole card tappable, server paging with infinite scroll), approved the history screen's scope and acceptance criteria, and asked for the PR; merging was not asked for.

## Where things stand

- Every upcoming and past appointment card, and the business page's next-appointment card, is one link to the details (`CardLink`). The date is a sentence ("on … at …"), the chevron sits by the title, and Reschedule / Cancel sit above the link, not inside it.
- The change history moved off the upcoming cards to the appointment's details screen.
- Cancelling asks in a bottom sheet (`CancellationPrompt`, mounted once in the root layout) on every platform; `window.confirm` and `Alert.alert` are gone.
- Every `FormDialog` slides in and out, and a backdrop tap closes it. The booking screen's service and date picker is a `FormDialog` now.
- Past appointments are on `/appointments/history`, 20 at a time from `GET /v1/me/bookings/history` (cursor, newest first, upcoming left out by the server, `?businessId=` filter), loaded as the list nears its end.
- My appointments lost its Home link and halved its padding. The locked-card notes are one line. The business page's "Book an appointment" tile has a subtitle.

Reasoning: `docs/architecture/decisions.md`, "My appointments, second pass, and sheets that move — 2026-11-10".

## Lessons (these will recur if forgotten)

- **Never unmount on a Reanimated `withTiming` callback alone.** In one browser-suite run the cancel sheet's exit callback never arrived and its transparent backdrop stayed over the whole app, blocking every tap. `FormDialog` unmounts on a timer of the animation's length, and its backdrop stops taking taps the moment it starts closing.
- **A sheet now stays on the page about 300 ms after it closes.** A test that checks it is gone, or that focus has returned, must wait (`waitFor`, `waitFor({ state: 'detached' })`), and a page-wide locator by name can match the leaving sheet's button too: `answerCancellation` waits for `cancellation-prompt-backdrop` to detach for that reason.
- **The axe contrast check runs while a dialog is still arriving.** A panel that fades in fails it; `FormDialog` moves its panel and fades only the backdrop.
- **`CardLink` content must sit in `CardLink.Passive`, or a tap on text never reaches the link** (text takes pointer events on web). The stories check this with `elementFromPoint`, not with a click, because user-event refuses to click `pointer-events: none`.
- **Storybook does not set `dir` on the document**, so a Hebrew story renders its rows left to right. To judge RTL layout there, set `document.documentElement.dir = 'rtl'`; the app's root sets it.
- **The browser suite fails at random places when the machine is overloaded** (load ~20 on 10 cores, memory exhausted by other sessions): four runs timed out in four unrelated spots, then a quiet run passed 61/61. Check `uptime` before reading a 30-second timeout as a regression, and do not run the API suite beside it.

## Debt worth knowing

- **Not run on a phone.** The sheet's slide on Android, the back button on the cancellation sheet, and a tap on an empty part of a card are unverified on a device.
- **`GET /v1/me/bookings` is no longer used by the app** (the history screen pages through `/v1/me/bookings/history`); API tests still exercise it. Remove it or keep it deliberately.
- **Past cards show the status in the brand colour for every outcome,** including Cancelled and No-show. A tone per status was not asked for.
- **The business page's next-appointment card still uses plain Reschedule / Cancel buttons,** unlike the icon-and-word pair on My appointments.
