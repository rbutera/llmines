## ADDED Requirements

### Requirement: Google sign-in works in production

A player on the deployed site (`llmines.e8n.dev`) SHALL be able to sign in with Google. Choosing sign-in MUST initiate the Google OAuth flow and, on success, return the player to the game in a signed-in session. The sign-in path MUST work behind the Cloudflare/OpenNext proxy: the Google provider MUST be registered at runtime, and callback/redirect URLs MUST resolve correctly to the deployed origin.

#### Scenario: Player signs in with Google on the live site
- **WHEN** a player on `llmines.e8n.dev` chooses sign in
- **THEN** the Google OAuth flow starts and, after consent, the player is returned signed in

#### Scenario: The Google provider is registered in production
- **WHEN** the auth providers endpoint is queried on the deployed site
- **THEN** the Google provider is present (the provider list is not empty)

#### Scenario: Callback origin resolves behind the proxy
- **WHEN** the OAuth round-trip completes behind the Cloudflare/OpenNext proxy
- **THEN** the callback resolves to the deployed origin and the session is established (no redirect-URI mismatch, no host-derivation failure)

### Requirement: Username selection after first sign-in

A player who has signed in but has no chosen username yet SHALL be prompted to select a username before play, with an auto-suggested editable default. The chosen username MUST be persisted to the account backend and surfaced in the signed-in state and the leaderboard.

#### Scenario: First-time signed-in player picks a username
- **WHEN** a player signs in for the first time and has no username
- **THEN** the username-select screen is shown with a suggested, editable username
- **AND** confirming a valid username saves it and proceeds to play

#### Scenario: Returning signed-in player skips username select
- **WHEN** a player who already chose a username signs in
- **THEN** the username-select screen is not shown and their username is displayed

### Requirement: Score submission on game over for signed-in players

When a signed-in player's game ends, the final score SHALL be submitted to the account backend exactly once. The submission MUST be authenticated (the backend MUST accept it as coming from the signed-in identity). A signed-out player's game over MUST NOT submit a score.

#### Scenario: Signed-in game over submits the score
- **WHEN** a signed-in player's game ends
- **THEN** the final score is submitted once to the backend under their identity
- **AND** it can update their personal best and appear on the leaderboard

#### Scenario: Authenticated submission is accepted by the backend
- **WHEN** the score submission reaches the account backend
- **THEN** the backend resolves the player's identity from the session (the identity is not null) and records the score

#### Scenario: Signed-out game over does not submit
- **WHEN** a signed-out player's game ends
- **THEN** no score is submitted
