# Google authorization and explicit account linking (VIS-15)

## Protocol decision before implementation

The prior GIS ID-token and native GoogleSignin ID-token paths are being retired.
No Google email match (including Gmail or Workspace) may silently attach a provider
to an existing identity. Google subject, not email, is the external identity key.

Use a **first-party server broker** for web and native:

1. The server is a confidential Google web OAuth client. It creates one-time state,
   nonce, and S256 PKCE verifier/challenge, with a fixed configured API callback.
   The client secret and Google code verifier remain server-only. Request only
   `openid email`; do not request offline access or retain Google access tokens.
2. The browser starts at Google using the authorization-code flow. Callback state
   is bound to a random HttpOnly/SameSite=Lax browser cookie. A native start first
   visits a single-use broker launch ticket in the system auth browser to establish
   that browser binding; native fetch cookies are not assumed to share browser jars.
3. The callback consumes the state once, exchanges the code with the verifier,
   verifies Google's signature and exact issuer/audience/expiry/nonce, then returns
   a short-lived opaque handoff grant. It never places a Visit session or Google
   token in a redirect URL. Error/cancellation redirects use fixed status values.
4. Web handoff redemption requires the initiating browser binding. Native adds a
   **second S256 PKCE boundary**: the app generates a verifier and sends only its
   challenge at start; the returned grant cannot be redeemed without that app
   verifier. The auth browser is external, never an embedded WebView. The native
   verifier is held in memory; process death fails closed and requires a restart.
5. A callback page previews the verified Google address. Login is confirmed there.
   Linking additionally requires explicit final Link Google consent and the same
   recently authenticated Visit identity/session that initiated the transaction.
   A fresh login family from another account cannot redeem a linking transaction.

This avoids claiming that an Android custom Google OAuth redirect or SDK ID-token
callback implements an application-controlled code+PKCE exchange. Google documents
platform restrictions on native custom redirects. Google's only OAuth redirect in
this design is the registered server callback. The broker's native return address
is separately allowlisted; a development custom scheme is not evidence of claimed
production app-link ownership. Native capability stays disabled until configured,
and production native return requires a claimed HTTPS app/universal link. Actual
Google consent/client registration and installed app-link handling remain VIS-43.
Google's web-server guide does not explicitly document every PKCE parameter; the
broker sends S256 through the standard authorization/token boundary and the installed
Google verifier library supports code verifiers. Real-client acceptance is a live
integration gate, not something adapter tests can certify.

## Transaction and account rules

State expires in ten minutes; a handoff expires in two minutes. Cancellation,
exchange failure and successful callbacks burn state. Redirects come from server
configuration, never caller-supplied return URLs. Wrong browser/app bindings cannot
redeem or burn another party's transaction. Redis failures fail closed. Throttle
start, callback and redemption, and retain a database unique authentication-proof
hash so restoring an already-redeemed Redis record cannot create a second login.

An already linked Google subject signs in to its existing identity even if Google
changes the email. An unlinked subject whose verified email is already present
returns LINK_REQUIRED without changing either account. The user must authenticate
that existing Visit account before starting explicit linking. Linking never merges
identities, moves a subject from another identity, or overwrites primary contact,
verified-contact flags, memberships or platform roles. If the Google address is
owned by another Visit identity, linking is rejected. Unique constraints and
transactional subject/email advisory locks handle concurrent attempts.

All protocol query strings, fragments, provider response bodies, Google tokens,
client secrets, verifiers, launch tickets, cookies and grants must stay out of logs
and monitoring. Application logging already strips query strings; reverse-proxy and
monitoring configuration must preserve that rule (VIS-40/41). Callback pages scrub
credentials from visible URL/router state and use no-referrer. Deploy only after
the relevant security/native/live gates.

## Primary references checked

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/openid-connect/openid-connect
- https://datatracker.ietf.org/doc/html/rfc8252
- Expo SDK 58 WebBrowser / openAuthSessionAsync documentation

This document records the protocol design first. Completion evidence and any
implementation limitations must be appended after verification, not inferred from
this design.

## Implementation checkpoint: server broker (in progress)

The code-flow server, native launch/app-PKCE boundary, signature/claim verification,
explicit recent-auth linking, durable proof table and legacy ID-token retirement
are implemented. Linking serializes with logout/rotation using the existing login
family advisory mutex and rechecks the session inside the transaction. The new
GoogleAuthProof table is global, owned by the resolved identity, and stores only a
proof digest/intent/timestamp; preserve its records at least beyond all OAuth TTLs
when introducing cleanup or unlinking. It is not a tenant authorization capability.

Legacy GOOGLE_CLIENT_IDS does not enable Google. Configuration now needs
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and exact GOOGLE_CALLBACK_URL; a native
return additionally requires GOOGLE_NATIVE_RETURN_URL. Empty placeholders keep the
feature disabled. No real Google requests or client registration were performed.

**Client migration is still pending**: replace GIS/native ID-token buttons with
broker launch/callback handling, keep native app-verifier/state in memory, scrub
handoff fragments, preview the verified address and confirm login/link explicitly.
Wire profile recovery to the returned proven identity ID. Until that work and its
browser tests are complete, VIS-15 must remain In Progress. Native/live consent
verification remains VIS-43 even after adapter and bundle tests pass.
