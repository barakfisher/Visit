# Identity, provider capability and navigation

> Product revision, 2026-10-25: [pilot-product-journey.md](pilot-product-journey.md) is the current navigation contract. The original decision matrix below is historical VIS-9 evidence and is superseded where it mentions discovery, automatic provider-dashboard landing, or remembered mode overriding ordinary Home landing.

## Current navigation authority

- One identity retains customer capability; only active approved business memberships grant provider management. My Providers is a separate identity-owned saved list, never management authorization.
- Ordinary login goes to Home for all identities. Explicit validated provider link/QR or booking intent resumes that provider after authenticated, idempotent save. Global /discover, directory search and global provider-count bypass are removed; old /discover redirects Home.
- Login offers a small Register as a business / provider entry. An applicant authenticates before submitting, then sees pending/rejected application status without losing customer access.
- Home: Your time, well spent (localized), upcoming confirmed appointment if any, then compact My Providers cards or a link/QR-oriented empty state. No Explore CTA or bottom tabs.
- Drawer: Home, Account, Become a provider, Application status as applicable, approved-membership-only Switch to provider mode, Log out. Provider mode offers reverse switch and explicit allowed workspace selection. Hydration, revocation, account switching and logout must clear private state/pending link context.
- Public sharing links/QR and saved lists never join staff/owner memberships; existing-business invitations remain VIS-33. Preview/prefetch GET requests do not mutate saved lists.
- Implementation ownership: VIS-13 login entry, VIS-45 resolver/save/auth intent, VIS-46 Home/drawer, VIS-27 application/mode transitions. No implementation is claimed by this documentation update.

## Historical original decision contract

Decision contract for VIS-9, 2026-10-24. Approved scope comes from the product owner's production-backlog instructions. This document defines target behavior; implementation acceptance remains in VIS-13, VIS-23, VIS-27 and VIS-32–37.

## Identity and capabilities

Every authenticated identity can book as a customer. No customer membership or role-selection onboarding is required. Provider capability requires an ACTIVE OWNER or MANAGER membership in an APPROVED business. STAFF permissions must be explicitly authorized by each endpoint and do not implicitly grant the owner/manager dashboard.

The login screen contains branding, identity sign-in/verification, supported method choices and their recovery/help states. It has no business setup, provider/customer selector, infrastructure status or discovery CTA. Public published discovery can still be reached through its own URL; authentication is required for reservation and confirmation.

Provider approval, provider membership and business publication answer different questions. Approval permits an applicant to manage the approved business; publication permits customers to make new bookings. An approved unpublished business remains accessible to its authorized provider for setup.

## Navigation priority after successful identity verification

1. Reload the authenticated profile and memberships from the server. Do not route on a stored role flag.
2. Resume an explicitly requested, validated internal booking route or discovery route. Revalidate provider publication, service and booking ownership at the destination; a return path never grants access or preserves an expired hold.
3. Restore the last explicitly selected customer/provider mode for this identity on this device, if still permitted. The preference contains only a mode and business selector, never credentials or authorization evidence.
4. Without a usable preference, approved providers reach `/provider/dashboard`; other identities reach `/discover`. If the published directory has exactly one business, discovery may continue to its booking flow.
5. In provider mode, restore a business selection only if it is still permitted. Auto-select one permitted business. With multiple businesses and no valid selection, show a business picker before loading any private agenda. Never select a foreign tenant from a URL or old cache.

Only parsed application paths are allowed as return destinations: `/booking/<businessId>` and `/discover` with known, validated query fields. Reject absolute/scheme-relative URLs, credentials, fragments used as redirects, malformed encoding, backslashes and unknown redirect/query destinations. Resolve identifiers through API authorization/publication checks. Never use an authentication token as a navigation parameter except the one-time email verification callback, which must be consumed and removed from visible history.

Remembered mode is a convenience preference scoped to the identity. Explicit mode changes update it. Direct-booking navigation does not overwrite an existing preference. Logout clears active identity, query data, selected business and in-memory credentials; native secure credentials are removed. A non-secret identity-scoped preference may remain on the device, but must not render private data before fresh authentication.

## State and transition matrix

| Authoritative state / event | Customer experience | Provider experience / recovery | Required state handling |
| --- | --- | --- | --- |
| Anonymous; ordinary launch | Login or public published discovery at its own route | Protected provider route redirects to login | Clear private cached data; no role inferred from route |
| Anonymous; booking deep link | Preview public provider, authenticate before acquiring a hold | None | Keep only validated return context; no pre-auth reservation |
| Session hydration in progress | Loading shell for protected content | Loading shell; no stale agenda flash | Do not treat an unresolved session as anonymous or authorized |
| Verified identity; no provider membership/application | Discover/book; account offers Become a provider | Application entry after login | No forced customer onboarding or role selection |
| New-business application submitted / pending | Normal customer access and application status | Setup/provider tools remain locked | Pending membership is not a provider capability |
| Application rejected | Normal customer access, reason/status and allowed reapply action | No provider access from that application | Preserve unrelated approved memberships |
| Approved membership; business unpublished | Normal customer access | Dashboard setup checklist and publish blockers | Show unpublished separately from approval; no public booking |
| One approved provider business | Customer mode is available in account menu | Dashboard auto-selects that permitted business | Server validates membership on every operation |
| Multiple approved provider businesses | Normal customer access | Valid remembered selection or explicit business picker | Do not query agenda until a permitted business is selected |
| Explicit switch to customer mode | Discover and own bookings | Provider capability remains available in account | Cancel old private requests and remove provider-scoped data |
| Explicit switch to provider mode | Own consumer bookings remain server-owned | Refetch membership, select business, open dashboard | Clear incompatible consumer/provider transient selections |
| Business switch | Own consumer records stay identity-scoped | Load only the newly authorized business | Cancel in-flight old-tenant queries, remove old private cache and form/hold state |
| Membership removed/revoked or business approval withdrawn | Customer access remains if session valid | Refetch; choose another permitted business or return to account/customer mode | Clear revoked tenant state immediately; never retry a denied write as another tenant |
| Business unpublished after being active | Existing booking details/actions remain governed by policy | Authorized provider retains setup/agenda access | Block new public holds; clear stale public availability; preserve existing bookings |
| Session expired/revoked or refresh replay detected | Reauthenticate; preserve safe navigation intent only | Same | Clear private queries, active role/business and credentials; show no cached protected content |
| Profile/network temporarily unavailable | Retryable state; do not claim logout | Do not authorize new protected operations from stale flags | Distinguish network failure from 401 and 403 |
| Mutation forbidden (403) | Preserve legitimate customer data | Refresh memberships and recover permitted selection | Do not mislabel every 403 as expired login |
| Logout | Public/login state | No private provider content | Revoke session server-side and clear client credentials/cache |

## Account menu and server contracts

- Authenticated customers see their profile/contact settings, bookings and Become a provider when appropriate. Existing applications expose status rather than duplicate submissions.
- Approved providers see Switch to provider view / Switch to customer view and their permitted business picker. An administrator review capability is separate from provider capability and is never inferred from `is_provider`.
- Global identity/session records are not tenant-owned. A client business ID selects a tenant; membership, role, approval and operation-specific permissions authorize it.
- Server profile projection must distinguish identity, active capabilities, memberships, application status and review status. Publication/readiness is a separate business field. Verified contact timestamps establish ownership; client booleans cannot satisfy booking requirements.
- Existing `/api/auth/me` provides approved owner/manager capability and business summaries; `/v1/me` provides memberships and application summaries. VIS-23/VIS-27 must normalize these into a versioned profile contract before adding persisted mode switching. Do not infer rejection or pending state from a missing approved-membership summary.
- Query keys for private data include identity and business. Switching identity clears all private queries. Switching business cancels old requests and clears all business-private keys, not just a single `['business', id]` namespace. Mutations retain explicit business identity and never rebind a pending request to a new selection.

## Authentication, linking and dependency failure policy

- Passwordless email remains selected. Google authorization code + PKCE is required by VIS-15. Link a Google subject only after recent authentication to the target account, explicit consent and proof of Google ownership. Matching email, including Gmail or Workspace, never silently merges accounts.
- Twilio Verify owns live phone challenge delivery/checks. Redis challenges are for isolated development/test delivery. Both paths require documented expiry, throttling and application-side replay/concurrent-verification protection. PostgreSQL stores verified identities and sessions; raw production OTP storage is not required.
- Web session credentials remain Secure/HttpOnly cookies in deployed environments with explicit SameSite/CSRF policy. Native credentials use SecureStore. Zustand exposes UI/session summaries, not browser-readable web session tokens.
- PostgreSQL is authoritative for bookings. Redis is a required live dependency for current rate-limit/reservation routes, which fail closed when unavailable. `/health/live` reports process liveness; `/health/ready` returns 200 only with a usable database, acceptable migration state and Redis, otherwise 503. Readiness must never be described as database-only.

## Acceptance handoff and evidence

VIS-9 delivers these decisions and the transition contract. It does not certify that all destination screens or protocol changes are implemented. VIS-13 owns identity-only login UI; VIS-27 owns mode switching/protected navigation and stale-cache recovery; VIS-23 owns sessions/profile authorization; VIS-32/33 own applications/invitations; VIS-34 owns publication; VIS-36/37 own contact and account management.

Required web journeys include no-membership, pending/rejected, approved unpublished, one/multiple memberships, both explicit mode changes, direct booking, business switching while requests are pending, removed membership, refresh/revocation, denied writes and network retry. Verify API authorization and stored records alongside visible routes. Device-specific hydration, secure storage, deep links and accessibility require separate iOS/Android manual smoke evidence. Language/RTL policy is decided in VIS-31.
