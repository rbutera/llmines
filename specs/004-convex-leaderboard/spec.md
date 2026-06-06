# Feature Specification: Accounts, High Scores & Global Leaderboard

**Feature Branch**: `004-convex-leaderboard`

**Created**: 2026-06-05

**Status**: Draft

**Input**: User description: "Add accounts, persistent high scores, and a global leaderboard. Auth: NextAuth Google SSO. Persistence: Convex. Signed-in users' runs persist; personal best updates only when beaten; global top-10 leaderboard. Unauthenticated users can play but aren't saved."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in and out with Google (Priority: P1)

A player signs in with their Google account to get a persistent identity, sees their name
(and avatar when available) in the UI, and can sign out again. This is the foundation for
saving scores and appearing on the leaderboard.

**Why this priority**: Accounts are the prerequisite for everything else — without a
signed-in identity there is nothing to attribute scores to. It is the MVP slice.

**Independent Test**: Sign in; the UI shows the user's name and a sign-out control. Sign
out; the UI returns to the signed-out state with a sign-in control.

**Acceptance Scenarios**:

1. **Given** a signed-out player, **When** they sign in with Google, **Then** the UI shows
   their display name (and avatar if provided) and a sign-out control.
2. **Given** a signed-in player, **When** they sign out, **Then** the UI returns to the
   signed-out state and a sign-in control is available.

---

### User Story 2 - Save high scores & personal best (Priority: P2)

When a signed-in player finishes a game, their final score is saved and their personal
best is kept — updating only when they beat it. The player can see their personal best.

**Why this priority**: This is the core retention value (persistent progress). Depends on
US1 (identity) but is independently testable once signed in.

**Independent Test**: While signed in, finish a game with a chosen score; the personal
best shows that score. Finish a lower-scoring game; the personal best is unchanged. Finish
a higher-scoring game; the personal best increases.

**Acceptance Scenarios**:

1. **Given** a signed-in player with no prior score, **When** a game ends with score N,
   **Then** the score is persisted and the personal best becomes N.
2. **Given** a signed-in player with personal best N, **When** a later game ends with score
   M ≤ N, **Then** the personal best remains N.
3. **Given** a signed-in player with personal best N, **When** a later game ends with score
   M > N, **Then** the personal best becomes M.
4. **Given** any score submission, **When** it is recorded, **Then** it is attributed to the
   player derived from the authenticated session on the server — never to a
   client-supplied identifier.

---

### User Story 3 - Global top-10 leaderboard (Priority: P3)

Players see a global leaderboard of the top 10 across all users, in-app, and it reflects a
newly submitted qualifying score.

**Why this priority**: Social/competitive payoff. Builds on US2 (saved scores) and is the
last layer of value.

**Independent Test**: Read the leaderboard; it shows up to 10 ranked entries. Submit a new
qualifying high score; the leaderboard updates to include it in rank order.

**Acceptance Scenarios**:

1. **Given** saved scores exist, **When** the leaderboard is displayed, **Then** it shows at
   most 10 entries ordered from highest to lowest.
2. **Given** the leaderboard is displayed, **When** a signed-in player submits a score that
   qualifies for the top 10, **Then** the leaderboard reflects it (one row per entry).

---

### User Story 4 - Unauthenticated play is allowed but not saved (Priority: P2)

A player who is not signed in can still play the full game. Their scores are not saved or
added to the leaderboard, and they are prompted to sign in to save.

**Why this priority**: Preserves the existing open-play experience and enforces the
"signed-in-only persistence" rule — a behavioural guard that must hold alongside US2.

**Independent Test**: While signed out, finish a game; no personal best is recorded, the
score does not appear on the leaderboard, and a prompt to sign in to save is shown.

**Acceptance Scenarios**:

1. **Given** a signed-out player, **When** they play and the game ends, **Then** no score is
   persisted, nothing is added to the leaderboard, and they are prompted to sign in to save.
2. **Given** a signed-out player, **When** they are in the game, **Then** full gameplay
   works exactly as before.

---

### Edge Cases

- **Score equal to personal best**: personal best updates only when strictly beaten (equal
  does not update).
- **High score that doesn't crack the top 10**: personal best still updates; the player may
  not appear on the leaderboard.
- **Fewer than 10 total players**: the leaderboard shows however many exist.
- **Leaderboard ties**: equal scores are ordered deterministically (e.g. earliest achieved
  first), so rendering is stable.
- **Sign in / out mid-game**: gameplay is unaffected; only end-of-game persistence depends
  on the signed-in state at game over.
- **Signed-out game over, then sign in**: the prior (signed-out) run is not retroactively
  saved.
- **Same player, multiple runs**: the leaderboard ranks each player by their best (one row
  per player), not one row per run.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to sign in with Google and sign out; the signed-in state
  MUST be reflected in the UI (display name, avatar when available, and a sign-out control;
  a sign-in control when signed out).
- **FR-002**: On game over, if the player is signed in, the run's final score MUST be
  persisted and the player's personal best MUST update only when the new score strictly
  exceeds the prior best.
- **FR-003**: The player's personal best MUST be displayed to them.
- **FR-004**: Each score MUST be attributed to the player derived from the authenticated
  session **on the server**; a client-supplied user identifier MUST never be trusted.
- **FR-005**: A global leaderboard of the top 10 across all players MUST be readable and
  displayed in-app (start and/or game-over), ordered highest-to-lowest, one row per entry.
- **FR-006**: After a signed-in player submits a qualifying score, the leaderboard MUST
  reflect it.
- **FR-007**: Unauthenticated players MUST be able to play the full game; their scores MUST
  NOT be persisted or added to the leaderboard, and they MUST be prompted to sign in to
  save.
- **FR-008**: The standard (non-test-only) UI MUST expose stable DOM hooks for automation:
  `signin`, `signout`, `user-name`, `personal-best`, `leaderboard`, and `leaderboard-row`
  (one per entry).
- **FR-009**: In test mode only (gated behind the existing test flag, exactly like the
  current `seed`/`spawn`/`tick` hooks, never shipped in a normal build), the app MUST expose
  deterministic hooks to drive auth and the score-submit path: mock sign-in with an identity
  (`{ name, subject }`, where `subject` is the server-derived player id), mock sign-out, and
  a deterministic end-game-with-score that runs the **real** game-over/submit path (saving
  when signed in, not saving when signed out).
- **FR-010**: The same UI and persistence logic MUST run unchanged against both a
  deterministic mock backend (automated tests) and a real backend (normal use) — selected by
  an injectable client seam, not by code rewrites.
- **FR-011**: All existing behaviour and polish (gameplay, sweep, scoring, controls, and
  features 001/002/003) MUST continue to work unchanged.

### Key Entities *(include if feature involves data)*

- **Player identity**: The authenticated account, identified by a stable server-derived
  subject id; carries a display name and optional avatar. Never supplied/trusted from the
  client for writes.
- **Score submission**: A completed run's final score, attributed to a player identity at a
  point in time.
- **Personal best**: The highest score recorded for a player; increases only when beaten.
- **Leaderboard entry**: A player's best score plus display name, ranked globally; the top
  10 are shown, one row per player.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A player can sign in and see their identity in the UI, and sign out back to
  the signed-out state — 100% of the time.
- **SC-002**: Across repeated signed-in games with chosen scores, the personal best equals
  the maximum score ever submitted by that player and never decreases (updates only when
  strictly beaten).
- **SC-003**: The leaderboard shows at most 10 entries, ordered highest-to-lowest, and
  reflects a newly submitted qualifying score.
- **SC-004**: A signed-out player can complete a full game with 0 of their scores persisted
  or shown on the leaderboard, and is shown a prompt to sign in to save.
- **SC-005**: A score is always attributed to the server-derived authenticated player; a
  client cannot cause a score to be written as a different player (verifiable by a
  server-side test that mocks identity).
- **SC-006**: The automated suite runs fully offline against a deterministic mock — no real
  sign-in round-trip and no live backend — and the identical code path operates against the
  real backend.
- **SC-007**: No regression — existing gameplay and features 001/002/003 continue to pass.

## Constraints *(pinned by stakeholder)*

These are fixed decisions from the request, recorded here because they bound the solution
(not free choices for planning):

- **Auth**: NextAuth (the create-t3-app auth layer) with **Google SSO** only.
- **Persistence**: **Convex** is the single backend for high scores and the leaderboard —
  no other database.
- **Security gate (review)**: per-user writes (`submitScore`) MUST derive the user from the
  authenticated identity server-side (`ctx.auth`), never a client-passed `userId`.
- **Dual-mode / never touch real Convex during this work**: build and test entirely against
  a deterministic mock. Do NOT run `convex dev`, `convex deploy`, or `convex login` (no
  network/provisioning). Commit `convex/_generated/` so the app typechecks without codegen
  against a deployment. Server functions are tested with an in-memory backend
  (`convex-test`) using mocked identity; the React/client layer uses an injectable provider
  seam so the same code runs against the mock (eval) and a real client (final pass). A
  real-Convex production pass happens later, only on the top-2 cells. Full strategy:
  [[convex-eval-strategy]].

## Assumptions

- The leaderboard ranks each player by their **personal best** (one row per player), top 10,
  descending; ties are broken deterministically (earliest achieved first).
- Personal best updates only when the new score is **strictly greater** than the prior best.
- The leaderboard is shown on both the start and game-over screens; the personal best is
  shown to the signed-in player (e.g. on start/game-over).
- A signed-out run is never retroactively saved after a later sign-in.
- Display name is always shown when signed in; the avatar is shown when the identity
  provides one.
- Unauthenticated game over shows a clear "sign in to save" prompt; gameplay itself is
  unchanged for signed-out players.
- The test-mode hooks live under the existing `window.__lumines` test seam and are absent
  from production builds, exactly like the current deterministic game hooks.
