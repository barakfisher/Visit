# Visit handoff — 2026-11-10, ended appointments count as attended, and past cards open their changes

Supersedes `2026-11-10-appointments-cards-history.md` for current state. Its lessons and debt still hold unless corrected below.

## Authorization

The user's global working agreement governs. The user reviewed the history screen on Android and chose: attended by default with no-shows recorded by the business, computed by the server at read time; no filter banner; "שינויים בתור"; a card tap that opens the changes. The Cancel button's original danger style was the user's call too.

## Where things stand

- An appointment in CONFIRMED status whose end has passed reads as COMPLETED in every API response that shows a status (`presentedStatus` in `apps/api/src/repositories/AppointmentOutcome.utils.ts`). The stored row stays CONFIRMED until the business records a no-show. The agenda sends `canMarkNoShow` per row, and "Mark completed" is gone from the app.
- Past appointment cards are buttons that open their change history in place. They no longer link to the details screen.
- The filtered history has a subtitle under its title and no banner.
- The booking calendar's month steps are arrows.
- The card's Cancel button is back to the danger colour at semibold.
- Saved-business cards on Home show a chevron instead of "קביעת תור". The `home.book` string is gone, and the retention smoke opens the card by its first enabled button.

Reasoning: `docs/architecture/decisions.md`, "Ended appointments count as attended, and past cards open their changes — 2026-11-10".

## Lessons (these will recur if forgotten)

- **The stored `Booking.status` is not what people see.** An ended appointment stays CONFIRMED in the table and reads as COMPLETED. A new read, a report or a count that uses the column directly will show "Scheduled" for the past or count attendance wrong. Go through `presentedStatus`. The agenda's revenue summary already counts CONFIRMED and COMPLETED together, so it is unaffected.
- **axe's `label-content-name-mismatch` fails a button whose `accessibilityLabel` is a comma-joined summary of its visible text.** The visible text must appear in the name as is. Let the content be the name instead.

## Debt worth knowing

- **Not run on a phone, and the web smoke scripts were not run.** `appointment-lifecycle-smoke.ts` was updated for the new rule but not executed.
- **There is no time limit on recording a no-show.** A business can still mark one weeks later. Decide whether that window should close.
- **Between an appointment's start and end, the history shows it as "Scheduled".** It appears there once it has started, and reads as completed only once it has ended.
- **`appointment-lifecycle.md` still describes marking Completed as a business action.** Update it with the next lifecycle change.
- **My appointments (not the history) still has its filter banner with "Show all appointments".** The user asked only about the history screen.
