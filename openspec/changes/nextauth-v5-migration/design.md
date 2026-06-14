# Design: nextauth-v5-migration

## Context

Auth has two layers that BOTH have to work for the leaderboard to attribute a score:

- **Browser login** (NextAuth/Auth.js + Google) — establishes who the player is.
- **Convex identity** — every Convex query/mutation that touches the leaderboard derives the
  player from `ctx.auth.getUserIdentity()`. Convex validates a JWT it receives on the connection
  against `convex/auth.config.ts` (`{ domain, applicationID }` -> OIDC discovery + JWKS, or Custom
  JWT mode with an explicit `jwks` URL). It requires a SIGNED RS256/ES256 JWT and CANNOT read an
  encrypted (JWE) or opaque token.

Current code (verified from source):

- `src/server/auth.ts` — v4 `NextAuthOptions`, `session.strategy = "jwt"`, Google provider gated
  on `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, `jwt`/`session` callbacks forwarding `sub`.
- `src/app/api/auth/[...nextauth]/route.ts` — v4 `const handler = NextAuth(authOptions); export
  { handler as GET, handler as POST }`.
- `src/game/account/RealAccountProvider.tsx` — **plain `ConvexProvider`** wrapping `SessionProvider`
  wrapping `RealInner`. `RealInner` uses `useSession()` for the client-side seam and
  `useMutation(api.scores.submitScore)`. There is no `ConvexProviderWithAuth`, so **no token ever
  reaches Convex**.
- `convex/auth.config.ts` — `{ domain: CONVEX_AUTH_ISSUER_DOMAIN ?? "https://example.com",
  applicationID: CONVEX_AUTH_APPLICATION_ID ?? "convex" }`.
- `convex/scores.ts` `submitScore` / `personalBest` — `const identity = await
  ctx.auth.getUserIdentity(); if (!identity) return null;`. Correct and unchanged; today it always
  returns null.
- Dual-mode seam: `AccountProvider.tsx` switches `MockAccountProvider` (TEST_MODE) vs
  `RealAccountProvider`. The mock + `window.__lumines.auth` test-api are entirely independent of
  the real path.

Runtime: Next.js 15 App Router (`next ^15.2.3`), React 19, deployed via `@opennextjs/cloudflare`
1.19.x to Cloudflare Workers. `wrangler.jsonc`: `compatibility_date 2025-09-23`,
`compatibility_flags ["nodejs_compat", "global_fetch_strictly_public"]`, custom domain
`llmines.e8n.dev`.

### Two root causes (both must be fixed)

1. **`OAuthSignin` on sign-in** — NextAuth v4's `openid-client` needs a Node http client that the
   Workers runtime doesn't provide; Google discovery/token exchange fails server-side. Fixed by
   Auth.js v5 (fetch-based `oauth4webapi`). Confirmed live: the compat-date bump alone did not fix
   it.
2. **`getUserIdentity()` is always null** — plain `ConvexProvider` attaches no token; and NextAuth's
   default session JWT is a symmetric JWE that Convex could not validate even if it were attached.
   Fixed by `ConvexProviderWithAuth` + a `useAuth` adapter that returns a signed RS256 JWT Convex
   trusts via its config.

## Decision: the Convex token-validation approach

Convex's hard requirements (from docs): a JWT signed **RS256 or ES256**, signature verifiable via
a **JWKS** the issuer publishes, with `iss == domain` and (if `applicationID` set) `aud ==
applicationID`. JWE / opaque tokens are rejected. `getUserIdentity()` then exposes `subject`,
`issuer`, `tokenIdentifier`, and any standard claims present (`email`, `name`, ...).

### Options considered

**Option A — Auth.js v5 + a custom-minted RS256 JWT for Convex (RECOMMENDED).**
Keep Auth.js v5 for the Google handshake + session. Add a server-side signer (`jose`
`SignJWT().setProtectedHeader({ alg: "RS256", kid }).sign(privateKey)`) that, for the current
NextAuth session, issues a short-lived RS256 token (`sub` = Google subject, `iss` = our issuer,
`aud` = the Convex applicationID, `email`/`name` carried for `getUserIdentity()`). Serve the public
key at a JWKS route. Configure Convex in **Custom JWT** mode pointing `jwks` at that route
(skips needing an OIDC discovery document). Wire `ConvexProviderWithAuth` with a `useAuth` hook
whose `fetchAccessToken` calls a token endpoint and re-fetches on `forceRefreshToken`.
- Pros: `jose` is WebCrypto-based -> runs cleanly on Workers; we fully control claims + expiry (no
  Google-ID-token 1h refresh dance); never hands Convex the JWE; depends on no experimental
  feature; smallest change to the existing, nearly-working NextAuth handshake; mock/TEST_MODE
  untouched.
- Cons: we own a private key (new Worker secret) and a JWKS route; ~3 small new server surfaces
  (signer, token endpoint, JWKS route) + the `useAuth` adapter.

**Option B — migrate to `@convex-dev/auth`, drop NextAuth entirely.**
Convex's own auth library; ships a Google provider (built on `@auth/core`), self-issues + hosts its
own JWKS (no external `auth.config.ts` issuer), OAuth terminates inside Convex HTTP actions.
- Pros: cohesive long-term; no key plumbing in our app; OAuth handshake runs in Convex's runtime,
  not on Workers.
- Cons: bigger blast radius (remove NextAuth route + SessionProvider, add Convex Auth provider,
  rewrite every session read, move Google client into Convex env, identity becomes a Convex user
  doc); Next.js App Router server/middleware support is **experimental** with an open Google-OAuth
  middleware bug (#271) and **no documented Workers guarantee**; `getUserIdentity().subject`
  changes shape (a Convex user id, not the Google sub) which ripples into existing `scores` rows.

**Option C — keep NextAuth, pass through Google's `id_token` (Convex points at Google as issuer).**
Persist Google's `id_token`/`refresh_token` in the NextAuth `jwt` callback; `fetchAccessToken`
returns the raw Google ID token; `auth.config.ts` domain = `https://accounts.google.com`,
applicationID = the Google client id.
- Pros: no signing key / JWKS to own (Google is the issuer); least crypto code.
- Cons: Google ID tokens are ~1h and refresh requires a server round-trip to Google's token
  endpoint with the refresh_token (an awkward `/api/openid/refresh`-style path); ties our Convex
  identity directly to Google's token lifecycle; community-implemented (`webdevcody/next-auth-convex`)
  rather than first-party-documented for this exact stack.

### Recommendation

**Option A.** It is the least invasive given a Google/NextAuth handshake that only fails because of
v4's Node-http dependency (which v5 removes), it is provably Workers-compatible (`oauth4webapi` +
`jose` are both fetch/WebCrypto), it directly kills both root causes, and it leaves the
TEST_MODE/mock seam and the existing `scores`/`users` Convex contracts (which key off the Google
`sub`) intact. Option B is the better end-state if we later want auth fully owned by Convex, but its
experimental App-Router/Workers surface and the `subject`-shape change make it the wrong first move.
Capture B/C here; do not implement them.

## Architecture (Option A)

```
Browser
  signIn("google")  --(Auth.js v5, oauth4webapi/fetch)-->  Google  -->  callback  -->  Auth.js JWE session cookie
  RealAccountProvider:
    <ConvexProviderWithAuth useAuth={useNextAuthConvexAuth}>
       useAuth.fetchAccessToken()  --GET /api/convex-token-->  server reads NextAuth session,
                                                               jose SignJWT(RS256) -> token
       (token attached to every Convex op)
Convex
  auth.config.ts (Custom JWT: jwks = https://llmines.e8n.dev/api/auth/jwks, algorithm RS256,
                  issuer = https://llmines.e8n.dev, applicationID = "convex")
  submitScore/personalBest: ctx.auth.getUserIdentity() now resolves -> subject = Google sub
```

New/changed files (indicative paths; implementer may adjust to repo conventions):

- `src/server/auth.ts` — v5 `export const { handlers, auth, signIn, signOut } = NextAuth({...})`,
  `trustHost: true`, Google provider, `jwt`/`session` callbacks preserved.
- `src/app/api/auth/[...nextauth]/route.ts` — `import { handlers } from "@/server/auth"; export const
  { GET, POST } = handlers;`.
- `src/server/convex-token.ts` (new) — `jose` RS256 signer (private key from env, `kid`, claims).
- `src/app/api/convex-token/route.ts` (new) — reads the server session via `auth()`; returns the
  signed token (or 401 when signed out).
- `src/app/api/auth/jwks/route.ts` (new) — returns `{ keys: [publicJwk] }`.
- `src/game/account/useNextAuthConvexAuth.ts` (new) — the `useAuth` adapter
  (`{ isLoading, isAuthenticated, fetchAccessToken }`) calling `/api/convex-token`.
- `src/game/account/RealAccountProvider.tsx` — `ConvexProvider` -> `ConvexProviderWithAuth` (keep
  `SessionProvider` outside it so the adapter can read the session).
- `convex/auth.config.ts` — Custom JWT provider config (issuer/jwks/applicationID/algorithm).

## Edge / runtime considerations

- Auth.js v5 core (`oauth4webapi` + `jose`) is fetch/WebCrypto -> Workers-native; no `openid-client`,
  no Node http. This is the fix for defect 1.
- `trustHost: true` (or `AUTH_TRUST_HOST=true`) is required: Workers/OpenNext is not auto-trusted,
  so Auth.js must trust the forwarded host to build callback URLs. (Live probe already shows
  origin-derived callback URLs are correct, so this should be a no-op in practice, but set it
  explicitly rather than rely on incidental behaviour.)
- Keep `nodejs_compat`; `jose` imports the PKCS8 private key via WebCrypto. Store the key as a
  Worker secret, never inline.
- No split edge/node config: JWT session, Google-only, no DB adapter -> single `auth.ts` is correct.
- Cookie prefix changes v4 `next-auth.*` -> v5 `authjs.*`; existing sessions are invalidated on
  cutover (acceptable — no users are signed in yet, sign-in is currently broken).

## Migration steps (summary; ordered detail in tasks.md)

1. Swap dependency `next-auth@4.24.14` -> `next-auth@5`; add `jose`.
2. Rewrite `src/server/auth.ts` to the v5 config form; rewrite the route handler.
3. Add the signer + `/api/convex-token` + `/api/auth/jwks`.
4. Add the `useAuth` adapter; switch `RealAccountProvider` to `ConvexProviderWithAuth`.
5. Update `convex/auth.config.ts` to Custom JWT mode.
6. Update env (Worker secrets + Convex env); register Google redirect URIs.
7. Run unit + e2e (mock path) gates; deploy; live-probe the real path.

## External prerequisites (owner must supply — NOT code)

These are required for an end-to-end real sign-in and cannot be done from the repo:

1. **Google Cloud OAuth Web client** (existing or new) with these **Authorized redirect URIs**:
   - `https://llmines.e8n.dev/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`
   Provides the **client id** and **client secret**.
2. **Cloudflare Worker secrets** (`wrangler secret put ...`, or the deploy keeps vars via
   `--keep-vars`):
   - `AUTH_SECRET` — random 32+ byte secret (session JWE key derivation).
   - `AUTH_GOOGLE_ID` — the Google OAuth client id.
   - `AUTH_GOOGLE_SECRET` — the Google OAuth client secret.
   - the **RS256 private key** for the Convex-token signer (e.g. `CONVEX_TOKEN_PRIVATE_KEY`, PKCS8
     PEM). The matching public key is baked into the JWKS route. (If `trustHost` is set in config,
     `AUTH_TRUST_HOST` is optional; otherwise set `AUTH_TRUST_HOST=true`.)
3. **Convex deployment env** (`npx convex env set ...`):
   - `CONVEX_AUTH_ISSUER_DOMAIN` = `https://llmines.e8n.dev` (the issuer; matches the minted token
     `iss` and the JWKS host). If using Custom JWT mode with an explicit `jwks` URL, this is the
     issuer value the config points at.
   - `CONVEX_AUTH_APPLICATION_ID` = `convex` (or the chosen `aud`; must equal the minted token
     `aud`).

## Risks / rollback

- **Risk: v5 beta surface.** Auth.js v5 ships under `5.0.0-beta.*` (long-running, production-used).
  Pin an exact version; the client surface (`signIn`/`signOut`/`useSession`) is stable and matches
  what `RealAccountProvider` already calls.
- **Risk: cookie/session invalidation on cutover.** Acceptable — sign-in is currently broken, no
  live sessions to preserve.
- **Risk: token signer mismatch** (token `iss`/`aud`/`alg`/`kid` not matching `auth.config.ts` or
  the JWKS). Mitigation: a single source of constants shared by signer + JWKS route + Convex
  config; verify with the live probe (signed-in `submitScore` resolves an identity).
- **Risk: TEST_MODE regression.** Mitigation: only `RealAccountProvider`/server/Convex files change;
  `AccountProvider.tsx`, `MockAccountProvider`, `mock-store.ts`, and the `window.__lumines` seam are
  out of scope. Unit + e2e (mock) gates must stay green as the guard.
- **Rollback:** revert the branch (single PR). No data migration occurs; the `scores`/`users`
  schema and existing rows are untouched (subject remains the Google `sub`). The Convex env vars
  and Worker secrets are additive/idempotent and can be left in place on a revert.

## Open questions

1. **Convex provider mode: Custom JWT vs OIDC discovery.** Recommendation is Custom JWT (explicit
   `jwks` URL, no `.well-known/openid-configuration` needed). If we'd rather keep the existing
   `{ domain, applicationID }` OIDC shape, we'd also need to serve
   `/.well-known/openid-configuration`. Pick one before implementing `auth.config.ts`.
2. **Confirm Convex `1.40.0` supports the Custom JWT provider** (`type: "customJwt"`). The docs
   describe it for current Convex; verify the installed version exposes it, else fall back to OIDC
   discovery mode (option 1's alternative).
3. **Exact v5 version to pin** (latest stable `5.0.0-beta.*` at implementation time).
4. **Token lifetime / refresh cadence** for the minted Convex token (e.g. 1h `exp`, re-mint on
   `forceRefreshToken`). Confirm the value; the `useAuth` hook must honour `forceRefreshToken`.
5. **Reuse `AUTH_SECRET`-derived key vs a dedicated RS256 keypair** for the Convex token. Design
   assumes a dedicated RS256 keypair (Convex needs asymmetric); confirm the env var name with the
   owner so it matches the Worker secret they set.
6. **Whether to also evaluate Option B (`@convex-dev/auth`) as a fast-follow** once Workers support
   matures — not in scope here, but worth a tracking note.
