# Visit handoff — 2026-11-10, My appointments tidied and final consent in a sheet

Supersedes `2026-11-09-business-page.md` for current state. Its lessons and debt still hold unless corrected below.

## Authorization

The user's global working agreement governs. The user reviewed My appointments and the booking screen on an Android phone, accepted the recommendations and asked for past appointments behind a link; the user asked for the PR (#PR_NUMBER); merging was not asked for.

## Where things stand

My appointments has no title. Each upcoming card's summary links to its details; Reschedule and Cancel are two equal buttons under it; the change history is a text link; the status is shown only on past appointments, which load behind "View past appointments". The booking screen's bar button is "Continue", which opens the "Confirm your appointment" sheet; only the sheet's button books, and pressing it closes the sheet while the bar shows progress. A reschedule opens on the appointment's own day, with "business · date · time" under the title. A chosen time chip keeps its size. Reasoning: `docs/architecture/decisions.md`, "My appointments and final consent, tidied — 2026-11-10".

## Lessons (these will recur if forgotten)

- **A modal that stays open during a commit blocks the footer until the request ends** (on web, until the client times out). The delayed-response case in `customer-contact-smoke.ts` caught it. Anything that covers the screen during a write must close or stay escapable.
- **On web a screen left in the stack stays mounted, and an open `Modal` follows it onto the next screen.** Gate any sheet on `useIsFocused()`.
- **A row inside a chip does not wrap its text unless the `Text` has `flexShrink: 1`.** Without it a long "time · staff" label ran over the next chip in Hebrew; Storybook passed, and only the browser suite's real labels showed it. `TimeChip.stories.tsx` / `TimeChips.stories.tsx` now hit-test long labels.
- **Changing the opening date let the React compiler analyse `useBookingContactFlow` further, and its purity rule then flagged `Date.now()` in `choose`** (a press handler). It is suppressed on that line with the reason; check that a new lint error in that hook is real before rewriting around it.
- **`showBookingTime` now waits for the chips' own animations to finish before it looks for a time.** After a date change, the previous date's times fade out in place and could be matched, then vanish (the Hebrew pilot journey failed this way).
- **The axe check requires a control's visible text in its accessible name.** An `accessibilityLabel` like "View appointment details: …" on the card summary, or "10:30, Unavailable" on a chip, fails Storybook. Browser tests find the card's link by role inside the card, not by that name.
- **The browser suite needs the Compose Postgres and Redis (`docker compose up -d postgres redis`) and takes about seven minutes.**

## Debt worth knowing

- **Not run on a phone.** Only the web build was checked (browser suite screenshots at 375px in Hebrew). The sheet's Android back button and the card's ‹ chevron on a device are unverified.
- **My appointments has no heading element** for screen-reader heading navigation (accepted in the decision log).
- **`docs/architecture/phone-run.md` is referenced by the agent's memory but is not on `main`.**
