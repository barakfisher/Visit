# Visit handoff — 2026-11-10, the business home shows today

Built on `main` after PR #57. Read `2026-11-10-add-appointment-screen.md` for #57's state; its lessons hold, except where this changes where Close lands.

## Authorization

The user's global working agreement governs. The user reviewed the business home on Android and listed eight changes; they chose a folded "Ended today" row over hiding ended appointments, and today's home with a saved-date notice over returning to the saved day.

## Where things stand

- The business home (`/provider/dashboard`) shows today only, in the business's timezone: no date field, day/week switch or period navigation. The API still serves `days=7`.
- Appointments still to come are listed first, folded to time, customer and service; a tap opens staff, contact, call/WhatsApp, the manual tag, lifecycle actions and change history in place.
- Appointments that ended today sit behind a folded "Ended today (n)" row. Cancelled appointments are not shown.
- One compact summary strip counts the whole day. Concurrent capacity and the "Daily agenda" heading are gone. Block time sits beside Share.
- After saving a manual appointment, Close lands on today's home with "Appointment saved for {date}."; a new form always starts today.

Reasoning: `docs/architecture/decisions.md`, "The business home shows today — 2026-11-10".

## Lessons (these will recur if forgotten)

- **"Mark no-show" exists only after an appointment ends, and the home is the only screen that offers it.** Anything that hides ended appointments from the home removes the business's only way to record a no-show.
- **Browser smokes reach another day by fixing the page's clock** (`scripts/agenda-day.ts`, `page.clock.setFixedTime`) before opening the home. The clock stays fixed for that page, including later navigations, so a page used for other flows afterwards runs on that day. Pick an instant inside the business's day: Israeli businesses use `T00:05:00+02:00` (00:05 or 01:05 local) for "nothing has ended yet".
- **The client decides upcoming versus ended by its own clock; the server decides whether "Mark no-show" is allowed by real time.** With a fixed browser clock on a future day, a card can sit under "Ended today" while the server still refuses a no-show for it.
- **`SmoothReveal` inside another `SmoothReveal` cuts the inner content off at its first measured height.** The "Ended today" list therefore fades in (`itemArrives`) instead of measuring, and `unfoldAgendaCard` in the smokes fails when any clipping ancestor hides an unfolded card's details. A details element that exists in the DOM is not proof it is seen.
- **An `accessibilityLabel` on a button whose text contains direction-isolated times fails axe's label-content-name-mismatch.** Let the card's text be its name.

## Debt worth knowing

- **No screen shows another day's appointments.** A calendar screen is the natural next step; until then a business sees tomorrow's appointments only tomorrow.
- **Not run on a phone.** Checked by unit tests, the Storybook card stories and the web browser suite only. The fold animation is `SmoothReveal`; on web it is the same component the booking screen uses.
- The summary counts ended appointments while the list shows only what is left, so "Appointments today: 5" can sit above two cards. Deliberate; revisit if it confuses.
