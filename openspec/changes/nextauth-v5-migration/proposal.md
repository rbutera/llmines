# Proposal: nextauth-v5-migration

## Why

"Login with Google" is broken in production. Two distinct defects sit in the auth path, and
fixing one without the other still leaves the leaderboard unable to attribute a score:

1. **Sign-in never reaches Google.** NextAuth v4 (`4.24.14`) drives Google OIDC discovery + token
   exchange through `openid-client`, which uses Node's `http`/`https` client. The Cloudflare
   Workers runtime (OpenNext) does not give `openid-client` a working Node http client even at the
   current `compatibility_date` (`2025-09-23`). `POST /api/auth/signin/google` throws server-side
   and returns `error=OAuthSignin` before ever redirecting to `accounts.google.com`. The
   compat-date bump that already shipped did NOT fix it (verified live, see
   `skins-ux-auth/notes-auth-diagnostic.md`). Auth.js v5 replaced `openid-client` with the
   fetch-based `oauth4webapi` and is edge/Workers-native; this is the real fix.

2. **Even after sign-in, Convex sees no authenticated user.** `RealAccountProvider` wraps the app
   in a plain `ConvexProvider`, which attaches NO auth token to Convex requests. The NextAuth
   `SessionProvider` next to it does nothing for Convex. So `submitScore` /`personalBest` call
   `ctx.auth.getUserIdentity()` and always get `null` — the mutation is a silent no-op for every
   player. Wiring a token in is not enough by itself: NextAuth's default session JWT is an
   ENCRYPTED JWE (symmetric `dir` / `A256CBC-HS512`, keyed off `AUTH_SECRET`), and Convex can only
   validate a SIGNED RS256/ES256 JWT against a published JWKS. The session cookie can never be
   handed to Convex.

So the fix is: migrate NextAuth v4 -> v5 (Auth.js) to make the Google handshake work on Workers,
AND give Convex a token it can actually validate by minting a separate RS256 JWT (jose) and
serving a JWKS, wired through `ConvexProviderWithAuth`.

## What Changes

- **BREAKING: NextAuth v4 -> v5 (Auth.js).** Replace the v4 `authOptions` + default-export route
  handler with the v5 `NextAuth(config)` form returning `{ handlers, auth, signIn, signOut }`.
  `src/server/auth.ts` becomes the v5 config; `app/api/auth/[...nextauth]/route.ts` becomes
  `export const { GET, POST } = handlers`. Set `trustHost: true` (Workers is not auto-trusted).
  Keep `session: { strategy: "jwt" }`, Google provider, the `sub`/`email`/`name` forwarding, and
  the same `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` / `AUTH_SECRET` env names (already v5
  conventions). Client surface (`signIn`/`signOut`/`useSession` from `next-auth/react`) is
  unchanged, so `RealAccountProvider`'s sign-in/out calls stay as-is.
- **Mint a Convex-validatable token.** Add a server-side signer that issues an RS256 JWT (via
  `jose`) for the signed-in user (`sub` = stable Google subject, `iss`/`aud` matching Convex
  config, short `exp`), exposed at a Next.js endpoint. Publish the matching public key at a JWKS
  route. The private key is a new Worker secret.
- **Wire the token to Convex.** Replace the plain `ConvexProvider` in `RealAccountProvider` with
  `ConvexProviderWithAuth` plus a NextAuth-backed `useAuth` adapter
  (`{ isLoading, isAuthenticated, fetchAccessToken }`) that fetches the minted JWT and re-fetches
  on `forceRefreshToken`. Point `convex/auth.config.ts` at the new issuer/JWKS (Custom JWT mode,
  `algorithm: "RS256"`), replacing the `https://example.com` placeholder.
- **TEST_MODE / mock path untouched.** The dual-mode seam lives in `AccountProvider.tsx`
  (`TEST_MODE ? MockAccountProvider : RealAccountProvider`). Only `RealAccountProvider` and the
  server/route/Convex files change. `window.__lumines.auth` and the deterministic e2e suite keep
  driving the mock; no real network in tests.

## Non-goals

- Username selection UX, leaderboard view, score-on-game-over wiring — those already exist
  (`skins-ux-auth` account-auth spec) and are not changed here beyond making the underlying
  identity actually resolve.
- Email/password or any non-Google provider.
- Replacing the leaderboard data model or Convex schema.
- Database session strategy / a Convex adapter for Auth.js (JWT session is retained; no split
  edge/node config is needed for a Google-only, no-DB-adapter setup).

## Capabilities

### Modified Capabilities
- `account-auth`: the existing requirements ("Google sign-in works in production", "Score
  submission on game over for signed-in players") are RE-SPECIFIED to additionally require that
  the auth library is edge/Workers-native and that Convex receives a signed, JWKS-verifiable token
  so the authenticated identity actually resolves server-side. New requirement added for the
  Convex token bridge.

## Impact

- Rewrites: `src/server/auth.ts` (v4 `authOptions` -> v5 `NextAuth()` config),
  `src/app/api/auth/[...nextauth]/route.ts` (default-export handler -> `{ GET, POST } = handlers`),
  `src/game/account/RealAccountProvider.tsx` (`ConvexProvider` -> `ConvexProviderWithAuth` + a
  `useAuth` adapter), `convex/auth.config.ts` (placeholder issuer -> Custom JWT issuer/JWKS).
- Adds: a token-signing helper + token endpoint + JWKS route (paths in design.md), `jose` to
  dependencies, an RS256 private-key Worker secret + matching JWKS public key.
- Removes: `next-auth@4.24.14` (replaced by `next-auth@5`); the v4-specific eslint-disable in the
  route file.
- Untouched: `MockAccountProvider`, `mock-store.ts`, `AccountProvider.tsx` selector, `types.ts`,
  the `window.__lumines` test-api seam, `convex/scores.ts` / `convex/users.ts` logic (they read
  `getUserIdentity()` — that contract is preserved, the identity just stops being null).
- Env: see design.md "External prerequisites" — Google console redirect URIs, Worker secrets
  (`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, the new signing key), Convex env vars.
- Verification: live probe against `llmines.e8n.dev` (authorize URL returned, real sign-in,
  authenticated `submitScore` resolves an identity); unit + e2e gates (mock path) stay green.
