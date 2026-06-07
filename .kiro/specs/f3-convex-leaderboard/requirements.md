# Requirements — F3: Convex + NextAuth + global leaderboard

## Introduction

Add accounts (NextAuth, Google SSO), persistent high scores, and a global
top-10 leaderboard (Convex). The app must run against BOTH a deterministic MOCK
(automated eval, `NEXT_PUBLIC_TEST_MODE=1`) AND a real Convex deployment (later
pass) with no code rewrite, via an injectable data/auth seam. We build and test
ONLY against the mock; we never run `convex dev/deploy/login` (no network, no
provisioning). Per-user writes derive the user from the server-side identity,
never a client-passed id.

## Requirements

### Requirement 1 — Authentication
**User Story:** As a player, I want to sign in with Google and sign out, so my
runs can be saved under my identity.

#### Acceptance Criteria
1. WHEN unauthenticated THEN a `signin` control SHALL be shown and the player MAY
   still play; scores are NOT saved (a prompt to sign in is shown).
2. WHEN signed in THEN the UI SHALL show the user's name via `user-name` and a
   `signout` control; `signin` is hidden.
3. WHEN the player signs out THEN the app SHALL return to the unauthenticated
   state (`signin` available again).

### Requirement 2 — High-score persistence (server-derived identity)
**User Story:** As a signed-in player, I want my best score saved, so I can track
my personal best.

#### Acceptance Criteria
1. WHEN a signed-in player's game ends THEN the run's score SHALL be submitted to
   Convex; the player's personal best SHALL update ONLY when beaten.
2. WHEN the player is signed out and a game ends THEN NOTHING SHALL be written.
3. WHEN `submitScore` runs THEN it SHALL derive the user from the authenticated
   identity server-side (`ctx.auth.getUserIdentity()`), never trusting a
   client-passed user id.
4. WHEN signed in THEN the UI SHALL show the player's personal best via
   `personal-best`.

### Requirement 3 — Global leaderboard
**User Story:** As a player, I want to see the global top-10, so I can compare.

#### Acceptance Criteria
1. WHEN the leaderboard is shown THEN it SHALL render the top-10 across all users
   read from Convex, in a `leaderboard` container with one `leaderboard-row` per
   entry.
2. WHEN a qualifying high score is submitted THEN the leaderboard SHALL reflect
   the new score after the game.
3. WHEN an unauthenticated user plays THEN they SHALL NOT appear in the
   leaderboard.

### Requirement 4 — Dual-mode seam (mock + real, no rewrite)
**User Story:** As a maintainer, I want one codebase that runs against a mock and
a real Convex client, so eval and production share the same logic.

#### Acceptance Criteria
1. WHEN built THEN `convex/_generated/` SHALL be committed so the app typechecks
   without running codegen against a deployment.
2. WHEN running the real `schema.ts` + functions (`submitScore`, `topN`,
   personal-best) THEN they SHALL be testable in-memory via `convex-test` with
   identity mocked through `t.withIdentity(...)`.
3. WHEN in `NEXT_PUBLIC_TEST_MODE` THEN the React components SHALL run against a
   deterministic mock data/auth layer injected at the provider level; in normal
   use the SAME components SHALL run against a real `ConvexReactClient` +
   NextAuth with no rewrite.
4. WHEN building/testing THEN NO `convex dev/deploy/login` SHALL be run.

### Requirement 5 — Test seam (TEST_MODE window.__lumines)
**User Story:** As a black-box test harness, I want deterministic auth + submit
hooks, so I can drive auth and scoring without OAuth or a live backend.

#### Acceptance Criteria
1. WHEN `window.__lumines.auth.signIn({ name, subject })` is called THEN the app
   SHALL mock-authenticate as that identity; `subject` is the server-derived id,
   never a client-trusted arg. `user-name` and `signout` reflect it.
2. WHEN `window.__lumines.auth.signOut()` is called THEN the app SHALL return to
   unauthenticated (`signin` available).
3. WHEN `window.__lumines.endGame(score)` is called THEN it SHALL deterministically
   end the current game with that exact final score via the REAL game-over path:
   when signed in it submits to the mock backend and refreshes `personal-best` +
   `leaderboard`; when signed out nothing is written.

### Requirement 6 — No regression
1. Existing core/unit tests, the F1/F2/F4 behaviour, and all prior E2E SHALL stay
   green; `SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_TEST_MODE=1 pnpm build` SHALL pass.

## Out of scope
Friends, profiles, social, real-time multiplayer, anti-cheat beyond basic
server-side acceptance, email/password or non-Google providers.
