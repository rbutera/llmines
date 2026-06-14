# Tasks: nextauth-v5-migration

## 1. Dependencies

- [ ] 1.1 Remove `next-auth@4.24.14`; add `next-auth@5` (pin the exact latest stable `5.0.0-beta.*`). Add `jose` for RS256 signing/JWKS.
- [ ] 1.2 Run install; confirm `oauth4webapi` + `jose` resolve and the lockfile updates. Do not run pnpm in this research pass; this is the implementer's first step.

## 2. Auth.js v5 config + route handler

- [ ] 2.1 Rewrite `src/server/auth.ts` to the v5 form: `export const { handlers, auth, signIn, signOut } = NextAuth({ ... })`. Keep `session: { strategy: "jwt" }`, the Google provider (credential-gated on `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`), and the `jwt`/`session` callbacks that forward `sub`. Add `trustHost: true`. Use `next-auth/providers/google`.
- [ ] 2.2 Rewrite `src/app/api/auth/[...nextauth]/route.ts` to `import { handlers } from "@/server/auth"; export const { GET, POST } = handlers;`. Remove the v4-specific eslint-disable.
- [ ] 2.3 Replace any v4 `getServerSession(authOptions)` usage with the v5 `auth()` helper (grep the repo; none expected in the game, but confirm).
- [ ] 2.4 Confirm the client surface (`signIn`/`signOut`/`useSession` from `next-auth/react`) is unchanged so `RealAccountProvider` needs no client-call edits.

## 3. Convex-validatable token (signer + JWKS)

- [ ] 3.1 Add a single shared constants source for the Convex token: `issuer`, `audience` (= Convex `applicationID`), `alg` (`RS256`), `kid`. Used by signer, JWKS route, and `convex/auth.config.ts`.
- [ ] 3.2 Add `src/server/convex-token.ts`: a `jose` `SignJWT` signer that imports the RS256 private key from env (PKCS8) and mints a short-lived token (`sub` = Google subject, `iss`/`aud`/`exp`/`iat`, carry `email`/`name`).
- [ ] 3.3 Add `src/app/api/convex-token/route.ts`: read the server session via `auth()`; if signed in, return the signed token; else return 401 / null.
- [ ] 3.4 Add `src/app/api/auth/jwks/route.ts`: return `{ keys: [publicJwk] }` for the signing key (matching `kid`).
- [ ] 3.5 Decide and confirm the Convex provider mode (Custom JWT `jwks` URL vs OIDC discovery). If OIDC discovery, also add `/.well-known/openid-configuration`. (See design open question 1/2.)

## 4. Wire the token to Convex (account provider)

- [ ] 4.1 Add `src/game/account/useNextAuthConvexAuth.ts`: a `useAuth` hook returning `{ isLoading, isAuthenticated, fetchAccessToken }`. `fetchAccessToken({ forceRefreshToken })` calls `/api/convex-token` (bypassing cache on force-refresh) and returns the JWT or null.
- [ ] 4.2 In `src/game/account/RealAccountProvider.tsx`, replace plain `ConvexProvider` with `ConvexProviderWithAuth` (client + the `useAuth` adapter). Keep `SessionProvider` wrapping it so the adapter can read the session. Leave `RealInner`'s `useSession`/`useMutation` logic intact.
- [ ] 4.3 Confirm the `DisabledAccountProvider` (no-Convex) fallback path still renders a signed-out stub.

## 5. Convex auth config

- [ ] 5.1 Update `convex/auth.config.ts` to the chosen mode: Custom JWT (`type: "customJwt"`, `applicationID`, `issuer`, `jwks` = `https://llmines.e8n.dev/api/auth/jwks`, `algorithm: "RS256"`) OR the `{ domain, applicationID }` OIDC shape pointing at the real issuer. Remove the `https://example.com` placeholder default.
- [ ] 5.2 Verify `convex/scores.ts` (`submitScore`, `personalBest`) and `convex/users.ts` need NO change — they read `getUserIdentity()` and that contract is preserved (subject remains the Google `sub`).

## 6. Environment + external prerequisites (owner-supplied; see design.md)

- [ ] 6.1 Register Google OAuth redirect URIs: `https://llmines.e8n.dev/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google` on the Google Cloud OAuth Web client. Capture client id/secret.
- [ ] 6.2 Set Worker secrets: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and the RS256 private key (e.g. `CONVEX_TOKEN_PRIVATE_KEY`). Set `AUTH_TRUST_HOST=true` if not set via `trustHost` in config.
- [ ] 6.3 Set Convex env: `CONVEX_AUTH_ISSUER_DOMAIN=https://llmines.e8n.dev`, `CONVEX_AUTH_APPLICATION_ID=convex` (or chosen `aud`), matching the minted token claims.
- [ ] 6.4 Set the matching local `.env` values for `npm run dev` (localhost redirect URI + a dev signing key).

## 7. Tests

- [ ] 7.1 Unit: signer round-trips (sign -> verify against the JWKS public key); claims are correct (`sub`/`iss`/`aud`/`exp`).
- [ ] 7.2 Unit: the `useAuth` adapter returns null when signed out, the token when signed in, and re-fetches on `forceRefreshToken`.
- [ ] 7.3 Confirm TEST_MODE/mock unit tests (`mock-store.test.ts`, `install.test.ts`) are unaffected and pass.
- [ ] 7.4 e2e: the deterministic suite (mock path / `window.__lumines`) passes unchanged — no real auth network. Run `npm run test:e2e` (incl. production-start config).
- [ ] 7.5 Quality gates: `npm run typecheck`, `npm run lint`, `npm run test` (unit) all green.

## 8. Verification (live, real path)

- [ ] 8.1 Deploy (`npm run cf:deploy`). Probe `GET /api/auth/providers` -> Google present with correct origin URLs.
- [ ] 8.2 Probe `POST /api/auth/signin/google` (csrf + cookie, `json=true`) -> returns an `accounts.google.com/...` authorize URL, NOT `error=OAuthSignin`.
- [ ] 8.3 Complete a real browser sign-in on `llmines.e8n.dev` (requires the Google redirect URIs from 6.1). Confirm signed-in session.
- [ ] 8.4 Play to game over signed in; confirm `submitScore` resolves an authenticated identity (the score persists / appears on the leaderboard) — i.e. `getUserIdentity()` is non-null on the backend.
- [ ] 8.5 Confirm a signed-out game over does NOT submit.
- [ ] 8.6 Re-run the deployed-site strict-autoplay probe to confirm no regression from the auth change.
