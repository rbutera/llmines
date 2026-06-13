## ADDED Requirements

### Requirement: Per-game random seed

Each new game SHALL be seeded with a fresh random seed derived from a cryptographic source
(`crypto.getRandomValues`), falling back to a time-derived value where crypto is unavailable. The
controller's restart path SHALL NOT pass a fixed seed; a no-argument restart SHALL produce a fresh
random seed. A run remains fully deterministic given its seed.

#### Scenario: Two fresh games differ

- **WHEN** two games are created without an explicit seed
- **THEN** their seeds differ (with overwhelming probability) and their piece sequences differ

#### Scenario: Restart reseeds randomly

- **WHEN** the controller is restarted with no seed argument
- **THEN** the new game uses a fresh random seed, not seed 1

#### Scenario: Explicit seed reproduces a run

- **WHEN** two games are created with the same explicit seed and driven through identical inputs
- **THEN** their resulting states are identical (the determinism contract holds)

### Requirement: Seed surfaced in state

The game seed SHALL be stored on the game state and surfaced in the render-state projection and the
public test projection, so the HUD/game-over screen can display it and tests can assert
reproducibility.

#### Scenario: Render-state exposes the seed

- **WHEN** the render-state is projected
- **THEN** it carries the current game's `seed`

#### Scenario: Game-over screen can show the seed

- **WHEN** the game ends
- **THEN** the seed is available for display so the run can be reproduced

### Requirement: Replay record

The controller SHALL record, for every run, a replay record of `{ schemaVersion, seed, inputs }`
where each input is `{ t, action }` with `t` the milliseconds since game start and `action` the
player input. The record SHALL be exposed on game over for download/inspection.

#### Scenario: Inputs are recorded in order with timestamps

- **WHEN** the player performs a sequence of moves, rotations, and drops
- **THEN** the replay record's `inputs` list contains each action in order, each tagged with a
  monotonically non-decreasing `t`

#### Scenario: The record captures the seed

- **WHEN** a run begins
- **THEN** the replay record's `seed` equals the game's seed, so seed + inputs reproduces the run

#### Scenario: Replay is exposable on game over

- **WHEN** the game ends
- **THEN** the replay record can be exported as JSON (e.g. a downloadable file via the dev seam or a
  game-over affordance)

### Requirement: Pass-completion clear telemetry

The core SHALL emit a record-only pass-completion event when a sweep pass completes at the right
edge, carrying a monotonic `id`, the `squares` cleared this pass, the `comboMultiplier` actually
applied, and `groupErases` (per erased group: its cell coordinates and whether a chain flood fired).
The controller SHALL pass this through to the render-state. The event SHALL be record-only — it SHALL
NOT affect deletion, scoring, or timing.

#### Scenario: Pass completion emits truthful clear data

- **WHEN** a pass clears 4 squares with a ×2 streak multiplier applied across two erased groups, one
  of which had a chain (the `STREAK_CURVE = [1,2,3,4]` value, since the big-clear package already
  contains the ×4 — there is no ×8)
- **THEN** the emitted event carries `squares: 4`, `comboMultiplier: 2`, and a `groupErases` list of
  two entries with the correct cell coordinates and `hadChain` flags

#### Scenario: Monotonic id fires once per pass

- **WHEN** a pass completes
- **THEN** the event `id` is greater than the previous, and a consumer keying off `id` reacts exactly
  once

#### Scenario: No pass completion carries the prior event unchanged

- **WHEN** the sweep advances without completing a pass
- **THEN** the pass-completion event is unchanged (same `id`) so no consumer re-fires

### Requirement: Lock telemetry

The core SHALL emit a record-only lock event whenever a piece locks, carrying a monotonic `id` and a
`cause` of `gravity`, `soft`, or `hard`. The controller SHALL pass this through to the render-state.
The event SHALL be record-only and SHALL NOT affect determinism.

#### Scenario: Gravity lock reports the gravity cause

- **WHEN** a piece locks because gravity could not descend it further
- **THEN** the lock event has `cause: "gravity"` and a bumped `id`

#### Scenario: Soft-drop lock reports the soft cause

- **WHEN** a piece locks at the end of a soft drop
- **THEN** the lock event has `cause: "soft"`

#### Scenario: Hard-drop lock reports the hard cause

- **WHEN** a piece locks from a hard drop
- **THEN** the lock event has `cause: "hard"`
