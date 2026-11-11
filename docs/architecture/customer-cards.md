# Saved customers and an invite to the app — design (not built)

Reasoning and rejected alternatives: `decisions.md`, "Saved customers and an invite to the app", 2026-11-11. This file is the build brief.

## Problem

A business re-types the same walk-in's name and phone on every Add appointment, and has no way to bring that walk-in into the app. If it could, the walk-in who later registers would appear twice: once as the business's guest, once as an app customer.

## Scope

- **Customer card** (new table, tenant-scoped): business, name, phone (E.164), optional email, optional linked identity, created/updated. Unique per (business, phone) for unlinked cards, and per (business, identity) for linked ones. A booking references its card (`Booking.customerCardId`, nullable at first); `customerId` and contact snapshots are unchanged and stay immutable.
- **Add appointment sheet:**
  - The customer field searches this business's cards by name or phone. Each suggestion shows the name plus phone (or email for a card without one). Picking one fills the phone and email and books on that card.
  - With no pick, the business types the name and phone of a new customer. A typed phone that matches a card offers that card instead.
  - **"Save customer details"** (default on) creates the card for a new customer. Off keeps today's behaviour: a booking with snapshots only.
  - **"Send an invite to the app"** (default off) is enabled only while save is on, or for a picked card that is not linked. After the save, the success view offers "Send invite on WhatsApp" (SMS as fallback), which opens the business's phone with a prefilled message and the link.
- **Invite link:** single-use, hashed token, expires after `CUSTOMER_INVITE_TTL_DAYS` (14). Creating a new one revokes the previous.
  - Opening it shows only the business's name. The person signs in or registers, then confirms "This is me". That links the card to them.
  - If they already have a card at that business, the claimed card merges into it.
- **App customers:** their first own booking at a business creates a linked card. A migration backfills cards from existing bookings, by (business, phone) for guests and (business, identity) for app customers.
- **Customer reads:** list, upcoming, history, details, cancel and reschedule use one shared ownership scope, "my bookings, or bookings of a card linked to me", replacing the seven `customerId = identity` filters.
- **Booking details (business):** shows "Linked to the app" or "Not linked". The business can create a new invite link, or unlink a linked card. Unlinking removes the card's bookings from that person's app; their own bookings stay theirs.

## Non-goals

- A customers screen (list, edit, delete, per-customer history).
- Editing a card's details.
- The server sending SMS or email invites, and any delivery status beyond "link created".
- Linking by verified phone. It comes with SMS verification (VIS-43), as an offer the person confirms.
- Merging two cards on the business's side.
- Searching or listing app accounts that have not booked at this business.

## Acceptance criteria

1. **Search is tenant-scoped.** Typing two or more letters of a name, or digits of a phone, suggests only this business's cards. A card of another business, or an app account with no booking here, never appears. Only OWNER/MANAGER can search.
2. **Picking a card fills the contacts.** The phone and email fill in, the booking stores that card and the usual immutable snapshots, and no phone is typed.
3. **No duplicate cards.** Saving a new customer whose phone already belongs to a card in that business offers that card instead of creating a second one.
4. **Save off keeps today's behaviour.** The booking has snapshots and no card.
5. **The invite needs a card.** The invite box is disabled while save is off. A saved card with the invite on yields a link. The WhatsApp/SMS button opens a prefilled message containing it. The UI says "link created", never "sent".
6. **Opening the invite.** The link shows only the business name before confirmation. A confirmed claim links the card. A second use, an expired link, or a revoked link fails with a clear message and links nothing.
7. **After linking, the person sees the card's bookings.** Upcoming and past bookings appear in their app, and cancel/reschedule follow the business policy. A different signed-in person still cannot read them (403/404).
8. **Merge on claim.** A claim by someone who already has a card at that business leaves one card with all the bookings.
9. **An app customer's own booking creates a linked card,** and that card is suggested to the business afterwards.
10. **Unlinking takes the card's bookings out of that person's app,** with no change to snapshots, audit or the business's agenda.
11. **The backfill** creates one card per (business, phone) for guests and per (business, identity) for app customers. Running it twice changes nothing.
12. **States and accessibility.**
    - Search: loading, no results ("New customer") and a failed search with retry.
    - Invite page: loading, success, expired or used, and signed-out (sign-in first, then the return to the claim).
    - The sheet stays usable if search fails: typing a new customer by hand still works.
    - All copy is in Hebrew and English, RTL included.
13. **Security review.** `bf-security-reviewer` checks the token, claim, merge and unlink, and the changed ownership scope, before merge.
