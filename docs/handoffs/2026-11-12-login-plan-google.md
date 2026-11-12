# Visit handoff — 2026-11-12, login plan and Google sign-in in the browser

Built on `main` after PR #69. Documentation only; no code changed, so `VERSION` is untouched. Decisions: `decisions.md`, "Login plan and Google sign-in in the browser".

## Authorization

The user's global working agreement governs. The user asked for a plan for phone, email, Google and one-time-code sign-in, ordered from the simplest, asked for it to be written down as the login plan, and asked to start with Google. They created the Google OAuth client and filled `.env` themselves.

## Where things stand

- [login-plan.md](../architecture/login-plan.md) holds the five stages. Stage 1 (Google in the browser) is configured locally; stages 2 to 5 have not started.
- Google Cloud: an OAuth web client in **Testing** mode. Only the test users listed under Audience can sign in. Redirect URI: `http://localhost:3000/api/auth/google/callback`.
- The three `GOOGLE_*` values are in the main checkout's untracked `/Users/a/projects/Visit/.env`. A worktree API reads `../../.env` relative to `apps/api`, so it needs that file symlinked into the worktree root.
- `/api/auth/capabilities` reports `google: true`, `googleNative: false`.

## Lessons

- **`tsx watch` does not reread `.env`.** After changing it, restart `dev:api`, or touch `apps/api/src/server.ts` so the watcher restarts the process.
- **All three Google values or none.** A partial set stops the API at startup (env validation), on purpose.
- **The login route is `/auth/login`,** not `/login` (404).

## Not verified

- **Checked:** the button on the login screen; Google's consent page for "Visit" opened with this client and callback, with no redirect error; a real Google account is linked to an existing account (Account lists email + Google, with a `LINKED` event). The user did the Google sign-in themselves.
- **Not checked:** a brand-new account created by Google, and signing out then back in with Google alone. To check: sign out, Continue with Google with the linked address (should land on Home of the same account), then with a test-user address that Visit doesn't know (should create a new account).
- **Not on the phone.** Google is disabled in Expo Go by design; see the plan's stage 5.
- No automated suite was run; no code changed.

## Debt

- Before anyone outside the test-user list can use Google, the OAuth app needs publishing and Google's verification of the consent screen, which needs a domain and a privacy policy URL.
