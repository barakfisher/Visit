# Visit handoff — 2026-11-12, calendar: loading in place, neighbouring periods

Built on `main` after PR #68. Read `2026-11-12-calendar-improvements.md` first; its lessons hold. Decisions: `decisions.md`, "Calendar: loading in place, neighbouring periods".

## Authorization

The user's global working agreement governs. After PR #68 the user asked for three changes: draw the calendar empty with a loader instead of the loading text, prefetch neighbouring periods, and remove the empty-period note. They chose to prefetch one period on each side (day, three days or week), not two weeks.

## Where things stand

- **Loading draws the grid.** `status: 'loading'` now renders the period's day headers and a plain grid (`CalendarTimeGrid`'s `status` prop) with a floating loader (`calendar-loading`). The hook keeps the last loaded grid span (`shownGrid`) for the next period while it loads.
- **Neighbours are prefetched** in `BusinessCalendar.hook.ts` after the current period loads: `neighbourStarts(from, mode)`, same query key, `CALENDAR_PREFETCH_FRESH_MS`.
- **`calendar.emptyWeek`, `calendar.emptyDay` and `view.empty` are gone.** `calendar.closedDay` stays.

## Lessons

- **The second API/web pair also needs `WEB_APP_URL=http://localhost:8085`** when starting the API on 3002; without it CORS allows only 8081 and the page's sign-up `fetch` fails with "Failed to fetch". (The recipe in `2026-11-12-calendar-improvements.md` missed this.)
- **To see the loading state against a local API, pause the API process** (`kill -STOP`, then `kill -CONT`): it answers too fast to catch otherwise, and wrapping `window.fetch` in the page does nothing, since the app keeps its own reference. Keep the pause short; at 20 s the app's account request timed out and the screen showed the account error until a reload.

## Not verified

- **Checked in the browser pane at 375 px against a real API and database:** a week loads and prefetches the week before and after (`date=2026-11-01`, `2026-11-15`); the next week opens with its appointments and no loader; a mode switch (not prefetched) draws the new dates on a plain grid with no tappable slot and the floating loader, at the same grid position before and after; a day with no appointments shows no note; a swipe to the next day opens it without a loader and without opening a slot.
- **Not run on a phone.**
- **`npm run test:web` was not run.**

## Debt

- **The grid still jumps when two periods' hour spans differ** (a period with a late appointment widens the grid when it arrives). Prefetching hides this for neighbours; a jump to a far date can still show it.
