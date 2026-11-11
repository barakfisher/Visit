# Visit handoff — 2026-11-11, the calendar: week and day (slice 1 of 3)

Built on `main` after PR #64. Read `2026-11-11-add-appointment-fixes.md` first; its lessons hold. Decisions: `decisions.md`, "The calendar screen".

## Authorization

The user's global working agreement governs. The user asked for a Google-Calendar-style calendar in the footer and agreed three slices: (1) this one, (2) an appointment details screen at `/provider/appointment/[id]`, (3) a "schedule" list view as a third mode on the same screen. They chose: a tap on an appointment opens its details, a tap on an empty slot opens Add appointment, and the day view is a mode of the calendar (the home stays today only).

## Where things stand

- **The business footer has Calendar** between Home and Add appointment. `/provider/calendar?date=&mode=week|day`; the period lives in the URL.
- **The agenda API returns `hours`** for every read (`openHours`, `apps/api/src/scheduling/open-hours.ts`): each day's opening windows in local `HH:mm`. Same "closed" as the home's day cards.
- **Layout is pure and tested:** `CalendarGrid.ts` (periods, local segments, grid hours, overlap lanes, slots) and `CalendarColumns.ts` (columns from one agenda read). The screen is `BusinessCalendar.component.tsx` + `CalendarGrid.component.tsx`; stories in `CalendarGrid.stories.tsx`.
- **A tapped appointment opens the home's card in a sheet** until slice 2 builds the details screen; replace that `FormDialog` in `BusinessCalendar.component.tsx`.
- **Add appointment opens over the calendar too** (`useManualBooking` is mounted there; the footer no longer sends the calendar back home first).

## Lessons

- **Add appointment's draft time is kept only while a free slot matches it.** An empty-slot tap sets `localDate` and `localTime`; the time becomes the choice once a service is picked and that slot is free. The chip list still opens on its first page, so the chosen 15:00 may not be among the chips shown, though "Selected time: 15:00" is.
- **A padding's side on the gutter misaligned the day headers in RTL Storybook** (CSS and React Native Web resolve `paddingStart` differently there). The headers use a spacer `View` as wide as the hours column instead.
- **To see a provider screen on a second local API/web pair** (here 3002/8085, so the user's 3000/8081 stay up), the browser needs a session cookie set by the API itself: `document.cookie` cannot replace an httpOnly `visit_session`. Signing up a throwaway identity with `fetch(..., { credentials: 'include' })` from the page and adding a membership worked; delete the rows afterwards.
- **Seeding a confirmed booking by hand needs the staff member's capacity to allow overlaps** (`VISIT_BOOKING_CAPACITY`), and `source: 'MANUAL'` is refused outside the manual-booking path (`VISIT_MANUAL_BOOKING_AUTHORIZATION`).
- **Independent QA (`bf-qa`) found no blockers;** its four bugs are fixed: the footer's Add appointment opened on the viewed (possibly past) date, cancelling from the sheet could close it, a slot carried a leftover staff member, and a slot already started was tappable.

## Not verified

- **Not run on a phone.** Checked in the browser pane at 375 px and desktop against a real API and database (week, day, arrows, Today, appointment sheet, block, empty slot to Add appointment with date and time), in Storybook with axe, and by unit and API database tests. On Android: open Calendar, tap a day header, tap an appointment, tap an empty slot tomorrow and pick a service.
- **The exported-web browser suite (`npm run test:web`) was not run;** no smoke covers the calendar yet.
- **Untested by automation:** the loading and error states, the Today button's visibility, the footer's active tab, English layout and a DST day on the mobile side. Cancelling from the calendar's sheet after the fix was not tried by hand.
- **Live updates** use the existing agenda stream (the query key starts `['provider', businessId, 'agenda']`); not exercised by hand here.

## Debt

- **Week columns on a phone are about 45 px:** overlapping appointments show a letter or two. Day mode is the readable view; slice 3's list may suit phones better.
- **The header (month, range, arrows, week/day switch) takes about a quarter of a phone screen.**
- **No horizontal swipe between weeks** and no scroll to the current hour on open.
- **Several staff are drawn in one column per day**, side by side when they overlap; no per-staff view.
