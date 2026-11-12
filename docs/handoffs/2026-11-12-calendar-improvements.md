# Visit handoff — 2026-11-12, calendar: three days, swipe, whole-day blocks, slot choices

Built on `main` after PR #66; this is PR #68. Read `2026-11-11-calendar-week.md` first; its lessons hold. Decisions: `decisions.md`, "Calendar: three days, swipe, whole-day blocks, slot choices", which replaces three choices of "The calendar screen".

## Authorization

The user's global working agreement governs. After seeing PR #66 on a phone the user asked for five changes: a day blocked whole filled in its column (no row above the grid), a three-day view, swipe between periods, a slot tap that can also block time, and one colour for every slot that cannot be tapped, the same as outside working hours. They chose that slots outside working hours are not tappable either.

## Where things stand

- **Modes are week, 3 days and day** (`CALENDAR_MODES`, `PERIOD_DAYS`; URL `mode=week|threeDays|day`). Three days start on the chosen date. The agenda API accepts `days=3`, which does not snap to Sunday.
- **A tapped slot opens a small sheet: Add appointment or Block time.** Block time opens the existing block form prefilled with the slot's date and an hour from its time (`emptyBlockForm(date, startLocal)`). The block dialog is now mounted on the calendar too (`useTimeBlockDialog` in `BusinessCalendar.hook.ts`), with the agenda's staff.
- **`slotAvailable` decides which slots are buttons**: ahead of now, inside working hours, and not on a day blocked whole. All others share `bg-slate-100`.
- **Whole-day blocks fill their column** (`AllDayBlocks` in `CalendarGrid.component.tsx`); `CalendarAllDayRow` is gone.
- **Swipe** is a Gesture Handler pan around the day headers and the scrolling grid (`Swipeable` in `BusinessCalendar.component.tsx`); the screen has its own `GestureHandlerRootView`, since the app has none at its root.

## Lessons

- **On web, a swipe that starts on a slot also fired the slot's press when the finger lifted** (the choice sheet opened for a day no longer shown). Presses are now ignored from the swipe's start until `SWIPE_TAP_GUARD_MS` after its end. Native was not tried; the guard covers it either way.
- **`react-hooks/purity` flags `Date.now()` inside handlers a hook returns**, even ones only called on events. The guard uses a ref and a timer instead of comparing timestamps.
- **Opening a second sheet straight from a first one's button is unsafe on iOS** (one modal presenting while another dismisses). The slot sheet's buttons wait `SHEET_LEAVE_MS`, exported from `FormDialog`, before opening the next sheet.
- **Add appointment opened from the slot sheet takes a moment to appear** while its options load; it is not lost.
- **A fresh worktree's `node_modules` lacked `react-native-toast-message`** (Metro served a 500); `npm install` fixed it without changing the lockfile. **`npm run typecheck` failed on stale `.expo/types/router.d.ts`** (no `/provider/calendar`) until Metro regenerated it.
- **A grid with no tappable slot failed axe (`scrollable-region-focusable`)** once closed hours stopped being buttons: a closed day's scroll area had nothing a keyboard could reach. The grid's `ScrollView` is `focusable` itself now.
- **Editing a file while a sheet is open hot-reloads the screen outside its provider** ("Provider workspace requires current authorization"); reload the page instead of reading it as a bug.
- **To check a provider screen on a second API/web pair (3002/8085):** symlink the main checkout's `.env` into the worktree root (the API reads `../../.env`; `API_PORT` set in the shell wins), point `apps/mobile/.env` at 3002, sign up a throwaway identity with `fetch(..., { credentials: 'include' })` from the page and add an ACTIVE membership; delete the identity and any blocks afterwards.

## Not verified

- **Not run on a phone.** Checked in the browser pane at 375 px against a real API and database: the three modes and their switch, swipe forward and back in week, three days and day (Hebrew), a swipe starting on a slot opening nothing, tap → choice → Block time (saved, drawn) and → Add appointment (date prefilled), a whole-day block filling its column and opening its sheet, vertical scroll still working. On a phone: swipe sideways over the grid in each mode, swipe starting on an appointment, and tap a slot then Block time (iOS: the second sheet must appear).
- **English (left-to-right) swipe direction** is covered only by `swipeStep`'s unit test.
- **`npm run test:web` was not run;** no smoke covers the calendar. `npm run test-storybook` passes (265), including the new Three Days story.

## Debt

- **No slide animation between periods:** the grid follows the finger at 40% and then the new period loads, with the loading text in between.
- **A block from a slot covers the whole business;** with several staff the form still offers "Who is unavailable", defaulting to the whole business.
- **Week columns on a phone are still about 45 px;** three days is the readable middle ground.
