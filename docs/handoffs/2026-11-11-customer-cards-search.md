# Visit handoff — 2026-11-11, customer cards and search (PR A of two)

PR #PRNUM, built on `main` after PR #61. Read `2026-11-11-customer-cards-design.md` first; the build brief and per-criterion status are in `docs/architecture/customer-cards.md`.

## Where things stand

- **Customer cards exist.** `CustomerCard` (migration `20261111130000_customer_cards`) and `Booking.customerCardId`. Migration `20261111130100_customer_cards_backfill` filed every existing booking that was ever confirmed: one card per (business, phone) for walk-ins, per (business, account) for app customers. On the local data: 14 + 14 cards, and only the 2 expired holds have no card.
- **An app customer's confirmed booking files itself** on a card linked to them (`attachOwnBookingCard`, at `/v1/bookings/:id/confirm`).
- **Customer reads and actions go through one scope**, `customerOwnedBookingWhere` / `lockCustomerOwnedBooking` (`security/booking-ownership.ts`): "bookings I made, or business-entered bookings of a card linked to me". Holds and attempts deliberately do not (decisions.md, "Customer cards and search, built").
- **The Add appointment sheet** searches this business's cards as the name is typed, offers the card a typed phone belongs to, and saves a new customer by default ("Save customer details"). A picked card fills the contacts.
- **Not built (PR B):** the invite link and page, claim, merge on claim, "linked" status and unlink on the business's booking details. Until then nothing links a typed card to an account; the tests link one directly in the database.

## Lessons

- **Existing fixtures hard-delete their business in `finally`.** A new table with a `RESTRICT` key to `Business` fails five unrelated suites in cleanup, and the run then hangs instead of ending. Cards cascade on purge.
- **Updating `customerCardId` passes every Booking trigger**, including on finished bookings: the guards compare only status, times, staff, `customerId` and the contact snapshot, and the revision (and so the audit event) moves only with those. A merge in PR B can move bookings between cards the same way.
- **The manual-booking idempotency fingerprint covers the whole input**, so a request that adds `customerCardId` after a `CUSTOMER_CARD_EXISTS` refusal is a different attempt. That is why the duplicate check runs before the attempt is registered.
- **The customer's lists used to return the whole booking row.** That was harmless while they held only the person's own bookings. Through a card they now hold bookings the business entered, so `/v1/me/bookings`, `/active` and `/history` return named fields (`customerAppointment`). Any new customer-facing read must do the same.
- **A released hold ends `CANCELLED`, the same as a cancelled appointment.** "Was ever an appointment" means "has a `BookingEvent`", which is what the customer lists check too.
- **Phones shown in Hebrew go through `isolateLtr`**, not `writingDirection: 'ltr'`. The style puts the number at the left edge of an RTL sheet.
- **`tsc -p tsconfig.test.json` reports one error in `test/booking-operations.test.ts`** on `main` too. It is older than this PR.

## Debt

- **Manual bookings across businesses already conflict under load, before this PR.** Twenty-four simultaneous manual bookings in four businesses (six each, separate staff and days): 7 succeed and 17 get `409` after the Serializable retries. `main` and this branch give the same numbers, with or without saving a card. The API test files also fail this way when run without `--test-concurrency=2`, on `main` too. Cards are not the cause, but card writes in PR B (claim, merge) run in the same transactions.

- **A linked person gets no live updates or notifications for a card's business-entered bookings.** Live signals and the notification trigger use `Booking.customerId`, which stays null on manual bookings. Worth closing in PR B, where linking becomes real.
- **The search matches by substring with `ILIKE`**, unindexed beyond `businessId`. That is fine for one business's customers; a business with tens of thousands of cards would want a trigram index.
- **For PR B:** `lockCustomerOwnedBooking` locks the card, then the booking. A merge or unlink must lock in the same order, or the two can deadlock. An unlinked card must have a name and phone (CHECK), so unlinking an app customer's own card (often email only) needs a rule. Under it, their own bookings stay theirs through `customerId`.
- **Two simultaneous saves of one new phone:** one books, the other gets the offer with `CUSTOMER_CARD_EXISTS`, and that attempt is spent. The sheet starts a new attempt when the business picks the card.
