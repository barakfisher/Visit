# Visit handoff — 2026-11-11, saved customers and invite (design only)

Built on `main` after PR #59. PR #61. Nothing is implemented; it records an agreed design.

## Where things stand

- The user's item 8 from the business-forms review (save the customer, invite them to the app) has an agreed design. The build brief is `docs/architecture/customer-cards.md` (scope, non-goals, acceptance criteria); the reasoning is the "Saved customers and an invite to the app" section in `decisions.md`.
- Builds on the business-forms work (PR #60, `2026-11-11-business-forms.md`): Add appointment is a sheet and has no exception reason. The build assumes that sheet, not the removed `/provider/[businessId]/add` screen.

## Lessons

- **The database already refuses the obvious link.** A CHECK keeps `customerId` null on `MANUAL` bookings, and three triggers forbid changing `customerId`. The design links through a customer card instead of rewriting `customerId`; do not relax those guards to "just set customerId on claim".
- **Customer ownership is seven separate `customerId = identity` filters** (bookings, upcoming, history, details, lifecycle, reschedule, screen flows). Replace them with one shared scope, or one forgotten place will hide linked bookings or leak them.
- **A typed phone proves nothing, and no identity has a verified phone yet** (local DB: 0 of 75; SMS off). Linking happens only when the person opens the invite or, later, verifies the phone.
- **"No customer directory" (VIS-38) is about app accounts, not the business's own customers.** Searching a business's own cards by name is fine for owners and managers; searching app accounts is not.

## Debt

- Until a walk-in opens the invite, registering on their own makes them two cards at that business; there is no business-side merge.
- Invite delivery status is unknowable (sent from the owner's phone); revisit server-sent SMS with VIS-43.
