# Visit handoff — 2026-11-10, Add appointment is its own screen

Built on `main` after PR #54, beside PR #55 (still open when this branch was cut). Read `2026-11-10-past-outcomes.md` for #55's state; its lessons and debt hold.

## Authorization

The user's global working agreement governs. The user reported that the business footer's Add appointment showed the form and the agenda together with Home marked, and chose a separate screen over a sheet.

## Where things stand

- `/provider/[businessId]/add` holds the manual appointment form. The footer marks Add appointment there; the agenda no longer renders the form.
- A new form opened from the agenda starts on the agenda's day; from Account or Team access, on today. A form in progress keeps its own day.
- Close returns to the agenda, and after a save to the saved appointment's day.

Reasoning: `docs/architecture/decisions.md`, "Add appointment is its own screen — 2026-11-10".

## Lessons (these will recur if forgotten)

- **Business screens unmount when they lose focus (`ProviderAccess`), and the agenda clears its draft on unmount.** To land the agenda on a day from another screen, write the agenda draft (`agendaDraftScope`) after leaving it and before returning; a `date` parameter on `dismissTo` is not reliably applied to the screen already in the stack.
- **A module the node unit tests import must not reach `src/lib/api.ts`,** which pulls in React Native and fails to transform under `tsx`. That is why `openManualBooking` lives in `ManualBookingEntry.ts`.
- **The manual form shows no fields while its options fail to load.** A browser check of a field value belongs after the retry.

## Debt worth knowing

- **Not run on a phone.** Checked by unit tests and the web browser suite only.
- **PR #55 and this branch both touch `VERSION`, `decisions.md` and `ProviderAgenda.types.ts`.** Whichever merges second needs its `VERSION` recomputed from `origin/main` and a small rebase.
- The smoke now opens the form from the agenda, not from Account; opening from Account (today's date) is covered by reasoning, not a browser check.
