# Provider role and route recovery — VIS-27

## Integrated journey

Ordinary sign-in always lands on Home, including for approved owners/managers. Explicit provider entry opens the same identity's new-business application flow; the entry explains that existing-team joining requires a private invitation and ownership requires administrator evidence. Customer sharing links only save a provider and resume booking. VIS-32 review and VIS-33 invitations remain the sources of membership, never client role selectors.

The drawer uses server account capabilities: Become a provider for eligible ordinary accounts, Application status for pending/rejected requests, and mode switch for active approved Owner/Manager membership. Pending applications and valid management memberships can coexist. Mode switching reloads the authenticated profile so a newly approved provider can enter without signing out or a full browser reload. Approval permits private setup even while unpublished; publication separately permits customer booking.

## Protected routes

The provider navigator always remains mounted so Expo Router preserves the actual nested destination on reload. Its screen layout wraps the focused screen in ProviderAccess. Blurred provider screens unmount their private contents. An initial implementation that conditionally mounted the navigator lost the nested team destination and was caught by the complete browser suite; the screen-layout boundary preserves it.

ProviderAccess waits for session hydration and a current server profile before mounting private children. It rechecks on entry and every 15 seconds while observed, and TanStack refetches on browser focus. A forbidden provider API result immediately clears private queries/mutations, clears active workspace, advances the context version and revalidates membership. Server profiles include the strongest management role per business; role downgrades also invalidate private state, even when the business remains manageable. The global customer identity and its saved providers/bookings remain intact. Expired/revoked sessions use the existing shared refresh path, and confirmed expiry removes all local authenticated state.

A requested business ID is authoritative as a selector: malformed, duplicated, revoked or foreign selectors show an access message and never fall back to the first authorized business. Without a selector, a current allowed selection or a sole allowed business can be used. Multiple businesses with no selection require explicit choice. The dashboard consumes the authorized workspace context; switching changes the URL and context together. Selecting the already active business is a no-op.

Private drafts/agenda contents remount after account/workspace/permission changes. The application form is keyed by identity/context as well. Old in-flight responses are discarded by the transport's context-version check. Network failure blocks private rendering and provides retry without logging out a valid customer. Server membership checks remain the enforcement boundary for every API call; cached client capability data grants no server authority.

## Sign-in recovery

Only bounded canonical non-secret provider destinations are accepted as return hints: `/provider/dashboard` with optional one businessId, `/provider/<businessId>` or `/provider/team/<businessId>`. Unknown params, role selectors, tokens, fragments, external origins and path traversal are rejected. These hints apply only when explicitly following a protected page's sign-in action, not ordinary login. Every resumed destination revalidates current server membership. A signed-out invitation still requires reopening its original private link after authentication; no invitation token is persisted in returnTo.

## Evidence and limits

Pure workspace-selector and auth-return contracts; transport/private-cache isolation tests; exported-web Playwright provider-access-smoke against PostgreSQL/Redis covers blocked hydration, multi-business choice, forged selector denial, workspace draft disposal, live membership revocation on protected read, retained customer identity, session revocation, same-identity OTP recovery to the protected page and logout. Existing complete suite covers ordinary provider login/Home, pending/rejected/multi-business drawer, invitations, new-business review, customer sharing and booking, contact settings, service management and Hebrew RTL.

Actual installed iOS/Android behavior remains VIS-2/VIS-43. This work does not claim device foreground/deep-link/live-provider verification. Hosted GitHub Actions billing restriction must remain separate from local test evidence. No deployments or actual external delivery performed.

### Final local evidence — 2026-10-26

171/171 API, 34/34 foundation and 55/55 Storybook tests pass. Complete exported-web Playwright suite passes, including actual local-OTP same-identity private-route recovery, live Owner→Manager downgrade, new approval activation without reload, preserved saved-provider record and post-logout denial. Typecheck/lint, API fixture/security-source compile and iOS/Android JS exports pass. The browser tests caught and drove fixes for conditional navigator mounting, selected-workspace reset and asynchronous route-interception cleanup; the final complete run passes.
