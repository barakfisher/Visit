# Identity-only login — VIS-13

## Navigation and availability

Ordinary sign-in returns to Home for customers and providers alike. Provider approval/membership is checked server-side when entering management. The small login link opens `/register/provider`, explains the single identity and approval process, and authenticates before continuing to the existing account application/status surface. VIS-27 owns the full application/mode integration; VIS-46 owns the Home and drawer replacement.

`safeAuthReturnTo` is shared by Expo and the API. Only Home, provider registration and canonical booking routes with known validated service/date/reschedule fields are accepted. Legacy `/discover` hints normalize to Home. Navigation hints never grant access and contain no credentials. VIS-45 will add provider share-link intent and identity-owned saves.

Unconfigured Google/SMS remain visibly disabled. Expo Go cannot receive the app-scheme email callback and labels that limitation. Existing Google code/PKCE and email fragment scrubbing remain intact. Google cancellation retains only validated navigation intent; native process death drops in-memory Google proofs/verifiers and requires restarting authentication. Email links include a validated non-secret return hint in the query and the credential in the fragment, allowing confirmation in a new tab without credential persistence in browser storage.

## OTP and recovery

The phone controller prevents same-turn duplicate submissions and renders server-provided resend/expiry deadlines. Client clocks are advisory: the server continues to enforce expiry, replay protection and throttling. Resetting the phone form retains cooldown conservatively. OTP input retains one-time-code autofill metadata and numeric keyboard configuration.

After successful proof redemption, each method retains the issued result in memory before fetching the profile. Profile-load retry cannot redeem the proof a second time. Expected identity checks prevent activating an unrelated profile. Phone completion also guards against completion after unmount. Native tokens use the existing SecureStore path; web sessions use HttpOnly cookies.

## Reproduction and limits

- `npm run typecheck` and `npm run lint`.
- `npm test --workspace @visit/api`: 128 tests, including email return-hint validation and existing auth/session/tenant/booking protections.
- `npm run test:foundation --workspace @visit/mobile`: 22 tests including strict return-path parsing.
- `npm run test-storybook --workspace @visit/mobile`: 47 stories, including six phone login states and accessibility checks.
- `npm run test:web --workspace @visit/mobile`: real API factory/PostgreSQL/Redis with local SMS/email inbox and synthetic Google exchange. Covers ordinary Home routing, provider entry through phone/email/Google, email callback in a new tab, phone expiry/cooldown/server throttling, double activation, profile recovery, Google cancellation intent, plus existing booking/concurrency/tenant regressions.
- Expo iOS/Android bundle export checks compilation only. Actual device boot, keyboard/autofill, callback handling and real Google/SMS/email delivery still require VIS-2/VIS-43 evidence. VIS-13 remains In Review until required native acceptance is recorded.

Run API and browser integration suites sequentially to avoid shared-database contention. An initial simultaneous run produced a 500 in an existing hold-expiry API assertion; all 128 passed on the isolated rerun. The initial failure cause is not established. This is not evidence of production stress stability (VIS-17).

A concurrent Storybook run also failed four existing AvailabilityState stories with a transform syntax error; the sequential rerun passed all 47. Its cause is not established. Final typecheck/lint, foundation tests, browser suite and sequential Storybook run all passed. Bundle exports succeeded for both native platforms; they do not substitute for device execution.
