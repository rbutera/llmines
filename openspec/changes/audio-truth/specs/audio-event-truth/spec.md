## ADDED Requirements

### Requirement: Clear events are derived from real pass telemetry, never score deltas

The `AudioEventDeriver` SHALL derive a `lineClear` event only from the controller's
pass-completion telemetry (a monotonic-id pass record carrying the real `squares` count
and `comboMultiplier`), and SHALL NOT infer clears, square counts, or combo values from
any change in `score`. The score-delta derivation path MUST be removed entirely; no
fallback that estimates clears from score may remain.

#### Scenario: A real clear fires one truthful lineClear event

- **WHEN** the controller completes a sweep pass that erased squares and the pass record's
  monotonic id advances, reporting `squares = 3` and `comboMultiplier = 1`
- **THEN** the deriver emits exactly one `lineClear` event with `squares = 3` and
  `combo = 0` (the streak-minus-one offset), and no event keyed off the score change

#### Scenario: A non-clear score event fires no lineClear

- **WHEN** the player banks a soft-drop bonus (or a board bonus) that raises `score` but
  the pass-completion id does NOT advance
- **THEN** the deriver emits no `lineClear` event

#### Scenario: A multiplied pass is not inflated

- **WHEN** a pass erases 4 squares under a ×4 streak (score rising by 640 or more) and the
  pass record reports `squares = 4`, `comboMultiplier = 4`
- **THEN** the deriver emits a single `lineClear` with `squares = 4` and `combo = 3`, never
  a square count derived from the 640-point score delta

### Requirement: Lock events fire on every settle with a cause

The deriver SHALL emit one `lock` event for every piece settle — gravity-lock, soft-drop
lock, and hard-drop lock alike — derived from the controller's per-settle lock telemetry
(a monotonic id plus a cause), not solely from the hard-drop slam id. Each `lock` event
SHALL carry the settle cause so downstream routing can scale the lock sound.

#### Scenario: A gravity lock is audible

- **WHEN** a piece settles by gravity (no hard drop) and the lock telemetry id advances
  with cause `gravity`
- **THEN** the deriver emits a `lock` event with `cause = "gravity"`

#### Scenario: A hard drop locks with its cause

- **WHEN** a piece is hard-dropped and the lock telemetry id advances with cause `hard`
- **THEN** the deriver emits a `lock` event with `cause = "hard"`

#### Scenario: One lock event per settle

- **WHEN** a single settle occurs
- **THEN** the deriver emits exactly one `lock` event for it (no duplicate from a separate
  hard-drop and spawn detection path)

### Requirement: Chain, move, rotate, and soft-drop events stay render-truthful

The deriver SHALL continue to emit `chain` from the monotonic `lastChainClear.id` (size =
the cleared component length), and `move` / `rotate` / `softDrop` from the existing
render-only signals (active column change, cells-matrix change, `softDropPulses` counter).
These derivations MUST remain free of any score inference.

#### Scenario: Chain fires once per flood

- **WHEN** a chain flood completes and `lastChainClear.id` advances with a cleared
  component of N cells
- **THEN** the deriver emits one `chain` event with `size = N`

#### Scenario: Move and rotate are disambiguated without a score read

- **WHEN** the active piece changes column with no rotation between two render states
- **THEN** the deriver emits a `move` event and no `rotate` event, using only the active
  piece projection

### Requirement: Telemetry access is isolated behind an adapter for compatibility

All access to the new pass and lock telemetry fields SHALL go through a single adapter so
the field names are defined in exactly one place. When those telemetry fields are absent
from a render state (the controller change not yet merged), the adapter SHALL report
"no pass" and "no lock" for that frame so the deriver emits no `lineClear` or `lock` —
remaining silent rather than reintroducing any lying score-based path.

#### Scenario: Missing telemetry degrades to silence, not inference

- **WHEN** the deriver receives a render state that lacks the pass-completion and lock
  telemetry fields
- **THEN** it emits no `lineClear` and no `lock` events, and never falls back to estimating
  clears from the score delta
