# Visit handoff — 2026-11-11, the business day as cards

Built on `main` after PR #58. Read `2026-11-10-business-home-today.md` first; its lessons hold.

## Authorization

The user's global working agreement governs. The user reviewed customer Home and the business home on Android and asked for seven changes; they chose one card per free gap, both a "closed" and a "blocked" look, and hiding staff capacity rather than deleting it.

## Where things stand

- **Customer Home:** cards have their padding back, removing a provider is a muted ✕ (`CloseIcon`), and the archive link sits by the "My providers" heading. Business screens stay compact.
- **Staff capacity is hidden in the app** (`STAFF_CAPACITY_SHOWN = false`): staff form, staff card, manual-booking chips. Server, column, validation and availability are unchanged; an existing value survives an edit.
- **The business home lists today as cards in time order:** appointments still to come, free time (grey, "+ Add appointment"), blocks (amber, reason) and a closed-day card. A free card opens Add appointment on today at the gap's first bookable time; a block card opens a sheet that releases it. The separate blocks section under the list is gone.
- **The block form** has four one-tap reasons (break, meeting, errands, day off); the field stays free text.

Reasoning: `docs/architecture/decisions.md`, the three sections dated 2026-11-11.

## Lessons (these will recur if forgotten)

- **Free time comes from the server (`scheduling/free-time.ts`) and only for `days=1`.** It reads busy time the way booking does: occupied intervals (buffers included) of live appointments and holds, plus blocks. Change what "busy" means in one place and not the other, and the cards will offer time that booking refuses.
- **Capacity is ignored by free time on purpose.** One appointment makes its time busy, even for a staff member with capacity 2. Revisit with the multi-staff design, not before.
- **Smokes that need two bookings in one slot set capacity in the database.** The pilot smoke sets `parallelCapacity: 2` after UI setup, because the hidden field used to do it, and the resilience suite's two-tab scenario (C3) depends on it.
- **Brand teal on `bg-slate-200` fails axe contrast (4.43:1).** Dark text on the darker grey cards.
- **Storybook renders the page LTR even in Hebrew stories.** `end-0` (CSS) and `paddingEnd` (React Native web) then resolve to opposite sides, so a corner icon can look like it overlaps text there and not in the app. Set `document.documentElement.dir = 'rtl'` before judging a layout in Storybook.
- **A worktree's `node_modules` can lag `main`.** `npm run test:web` failed to bundle until `npm install` brought in `react-native-toast-message`.

## Debt worth knowing

- **Several staff:** free cards name whose time it is, but there is no staff selector or per-staff view. The user has not decided how several staff, or one person with several customers at once, should look.
- **A running gap can show a start a few minutes in the past** until the home reads the day again (at most 15 minutes).
- **Staff is not prefilled** from a free card: choosing a service clears the staff choice on Add appointment.
- **Not run on a phone.** Checked by API unit and database tests, mobile unit tests, Storybook (with axe) and the full web browser suite.
- `apps/api` `tsconfig.test.json` reports one existing type error in `booking-operations.test.ts`, untouched here and present on `main`.
