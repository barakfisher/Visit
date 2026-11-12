# Login plan: Google, verified email, email code, phone

Agreed 2026-11-12. Ordered from the simplest to the most complex. Each stage is its own PR, with
`bf-security-reviewer`, the existing suites, a browser check at 375 px, a handoff and a
`decisions.md` entry. The MVP decision of 2026-11-01 (email + password first, email trusted
without proof, phone hidden) is replaced stage by stage; each stage records what it changes.

## Starting point

Most of the code already exists and was tested only against local fakes:

- **Google:** the server-side code broker (code + PKCE, signature checks, explicit linking) is
  built ([google-authentication.md](google-authentication.md)). It is off because no Google
  OAuth client is registered.
- **Email:** link sign-in and a six-digit code for verifying or changing the email in Account
  exist ([email-authentication.md](email-authentication.md),
  [account-security.md](account-security.md)). Delivery is the local inbox; Resend is not
  configured.
- **Phone:** SMS OTP through Twilio Verify, with limits and replay protection, is built
  ([phone-authentication.md](phone-authentication.md)). `SMS_DELIVERY_MODE=disabled`.
- **Two phones on an identity:** `phone` (sign-in, needs a code) and `contactPhone` (unverified,
  typed on the profile).

## Stages

1. **Google in the browser.** Register an OAuth web client in Google Cloud (free, no domain;
   `http://localhost:3000/api/auth/google/callback` is allowed for development). Fill
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` in the local `.env` only.
   Done when a real Google account signs up, signs in, and links to an existing account from
   Account; an existing email without linking answers "link required" and changes nothing.
   **Status 2026-11-12:** configured locally; a real Google account was linked to an existing
   account from the browser. See the decision log.
2. **Real email verification.** Needs an owned domain, a Resend account and DNS records;
   `EMAIL_DELIVERY_MODE=resend`. Ask accounts whose email was accepted without proof to verify it
   with the existing code. Adds password reset, which needs real delivery.
3. **Email one-time code sign-in.** A new six-digit code sign-in, built on the account-verification
   code. Open decision: replace the link or offer both.
4. **Phone verification and SMS OTP sign-in.** Twilio account, cost per SMS, geo/fraud
   (SMS pumping) limits, Israeli sender rules. Verifying `contactPhone` moves it into `phone`
   through the contact-challenge protocol; then the phone button appears on the login screen.
5. **Google on the phone itself.** A development build (not Expo Go) and a claimed HTTPS app
   link, which depends on the domain and the app's store identity. Last.

## Non-goals for now

Account merging by matching email, self-service recovery when every method is lost, and Apple
sign-in.
