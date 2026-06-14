## MODIFIED Requirements

### Requirement: Google sign-in works in production

A player on the deployed site (`llmines.e8n.dev`) SHALL be able to sign in with Google. Choosing sign-in MUST initiate the Google OAuth flow and, on success, return the player to the game in a signed-in session. The sign-in path MUST work on the Cloudflare Workers (OpenNext) runtime: the auth library used MUST drive Google OIDC discovery and token exchange over the Web `fetch` API (not a Node `http`/`https` client), so that constructing the Google authorization URL does not fail server-side. The Google provider MUST be registered at runtime, and callback/redirect URLs MUST resolve correctly to the deployed origin (the host MUST be trusted behind the proxy).

#### Scenario: Player signs in with Google on the live site
- **WHEN** a player on `llmines.e8n.dev` chooses sign in
- **THEN** the Google OAuth flow starts and, after consent, the player is returned signed in

#### Scenario: Authorization URL is built on the Workers runtime without failing
- **WHEN** sign-in is initiated on the deployed Worker
- **THEN** the server returns a Google authorization URL (`accounts.google.com/...`)
- **AND** it does NOT return an `OAuthSignin` error from a failed Node-http discovery/token-exchange

#### Scenario: The Google provider is registered in production
- **WHEN** the auth providers endpoint is queried on the deployed site
- **THEN** the Google provider is present (the provider list is not empty)

#### Scenario: Callback origin resolves behind the proxy
- **WHEN** the OAuth round-trip completes behind the Cloudflare/OpenNext proxy
- **THEN** the callback resolves to the deployed origin and the session is established (no redirect-URI mismatch, no host-derivation failure)

### Requirement: Score submission on game over for signed-in players

When a signed-in player's game ends, the final score SHALL be submitted to the account backend exactly once. The submission MUST be authenticated end-to-end: the Convex backend MUST resolve the player's identity from the request (the identity MUST NOT be null) and record the score under that identity. A signed-out player's game over MUST NOT submit a score.

#### Scenario: Signed-in game over submits the score
- **WHEN** a signed-in player's game ends
- **THEN** the final score is submitted once to the backend under their identity
- **AND** it can update their personal best and appear on the leaderboard

#### Scenario: Authenticated submission is accepted by the backend
- **WHEN** the score submission reaches the Convex backend
- **THEN** the backend resolves the player's identity from the validated token (the identity is not null) and records the score

#### Scenario: Signed-out game over does not submit
- **WHEN** a signed-out player's game ends
- **THEN** no score is submitted

## ADDED Requirements

### Requirement: Convex receives a verifiable identity token

The frontend MUST attach to Convex requests a token that Convex can validate, so that `ctx.auth.getUserIdentity()` resolves to the signed-in player server-side. The token MUST be a SIGNED JWT (RS256 or ES256) whose signature Convex can verify against a published JWKS, with issuer and audience claims matching the Convex auth configuration. The application MUST NOT hand Convex the auth library's default session cookie when that cookie is an encrypted (JWE) or otherwise opaque token, because Convex cannot validate it. The Convex auth configuration MUST point at the real issuer/JWKS (no placeholder issuer).

#### Scenario: Signed-in Convex requests carry a validatable token
- **WHEN** a signed-in player triggers a Convex query or mutation
- **THEN** the request carries a signed JWT whose signature Convex verifies against the configured JWKS
- **AND** `ctx.auth.getUserIdentity()` resolves to a non-null identity whose subject is the player's stable Google subject

#### Scenario: Token is refreshed when Convex asks for a fresh one
- **WHEN** Convex requests a fresh token (force-refresh)
- **THEN** the auth adapter mints/fetches a new token rather than returning a stale cached one

#### Scenario: Signed-out Convex requests carry no identity
- **WHEN** a signed-out player triggers a Convex query or mutation
- **THEN** no token is attached and `ctx.auth.getUserIdentity()` is null

### Requirement: Deterministic test-mode account path is preserved

The migration MUST NOT alter the deterministic TEST_MODE / mock account path. In `NEXT_PUBLIC_TEST_MODE`, the in-memory mock backend MUST continue to back auth and scores with no network access, and the `window.__lumines` test-api MUST continue to drive a deterministic mock identity. The component-facing `useAuth` / `useScores` seam MUST remain unchanged so the same UI components consume either backend.

#### Scenario: Test mode still uses the mock backend
- **WHEN** the app runs with `NEXT_PUBLIC_TEST_MODE` enabled
- **THEN** the mock account provider backs auth and scores with no real network calls
- **AND** the `window.__lumines` test-api drives the mock identity exactly as before

#### Scenario: The deterministic e2e suite still passes
- **WHEN** the deterministic end-to-end suite runs against the test-mode build
- **THEN** it passes without contacting the real NextAuth/Convex backends
