# Notifications

Status: agreed with the user on 2026-11-08, not built. The reasons are in decisions.md, "Notification centre".

## The notification centre

- A bell in the header opens a notifications page. It sits next to the mode switch, or in its place for someone without one.
- A coloured circle on the bell shows the number of unread notifications. With none unread there is no circle.
- **One inbox per person.** The same list and count in customer and business mode. Each notification names the business it belongs to. Opening a business notification switches to business mode and to the relevant screen.
- Sources for the first version: system messages, such as "your application was approved" with its "continue setup" action, which replaces the Home card; and booking status changes.
- Booking status changes reach the customer and the business's active owners and managers. `BookingEvent` is the source: a database trigger records every booking insert and update, with actor, old and new status and times, so no call site has to remember to notify.

Assumptions stated to the user, open to change:

- The person who made a change gets no notification about it (`actorIdentityId`).
- Notified: confirmed, cancelled, rescheduled, completed, no-show. Not notified: `HELD` and `EXPIRED`, which are internal steps of booking.
- Opening the page marks everything read; new items stay highlighted until the person leaves it.
- Text is built when read, not stored, so it follows the current language.
- Staff get nothing, because a staff member is not linked to an account.

## What the centre does not solve

The bell only works while someone has the app open. Each item below waits for delivery channels: email, WhatsApp, SMS, push and possibly Telegram.

| Gap | Consequence today | What closes it |
|---|---|---|
| **No real-time reach.** The count updates only inside the app. | An appointment cancelled an hour before it starts goes unseen by someone not looking at the app. | Push, or a message channel, for changes close to the appointment. |
| **People without an account.** A manual appointment's customer has contact details but no identity, so no inbox. | The customer learns of nothing that happens to their appointment. | Email, SMS or WhatsApp to the booking's contact snapshot. That contact is unverified, so sending to it needs its own decision. |
| **Staff.** A staff member is not linked to an account. | The person actually serving the appointment is not told; only owners and managers are. | Linking staff to accounts, a separate decision. |
| **Free-text messages** between a user and a business. | The centre carries system messages only. | A messaging feature of its own: consent, blocking, spam limits, privacy, and which business may contact whom. |

## Before adding a channel

Questions to answer then, written here so they are not rediscovered:

- **The centre stays the record.** One notification row per recipient, and each channel is a delivery attempt of that row, so an inbox entry exists whatever delivery does. `ProviderReviewNotification` already has this shape for email (queue, lease, retries, status) and is the pattern to follow or generalise.
- **Preferences:** per person and per channel, and which kinds may be silenced. Whether a customer can silence a cancellation is a product decision.
- **Consent and law:** transactional messages against marketing, opt-out, and what each channel's rules demand. Needs a real check before sending to customers.
- **Who pays:** SMS and WhatsApp cost per message. Decide whether the platform or the business carries it, and any limit.
- **Timing:** batching and quiet hours, so a busy business's managers are not woken by every booking.
- **Provider constraints:** WhatsApp needs pre-approved templates, push needs device tokens and native builds, Telegram needs the person to start a bot first.
- **Existing placeholders:** the appointment details page shows disabled SMS and WhatsApp icons and a note that no message was sent. `BookingNotification` records intent only. Both should change when real delivery exists.
- **Email first:** `EMAIL_DELIVERY_MODE`, `EMAIL_API_KEY` and a Resend transport exist already and send application decisions, so email is the cheapest first channel once a provider key is configured.
