## ADDED Requirements

### Requirement: Base square score

Each distinct square cleared in a pass SHALL score a base value of **40 points**. The pass score SHALL be `squares_in_pass x 40 x multiplier`, where `squares_in_pass` is the count of distinct snapshot squares actually cleared this pass (excluding any flood-filled chain extras). Scoring SHALL be banked at pass completion. All scoring SHALL be integer-only (no floats enter the score). This replaces the prior `deletedCount x distinctSquares` rule.

#### Scenario: One square scores 40

- **WHEN** a pass clears exactly one distinct square with no combo active
- **THEN** the score increases by 40

#### Scenario: Three squares with no multiplier

- **WHEN** a pass clears exactly three distinct squares with no combo active
- **THEN** the score increases by `3 x 40 = 120` (no 4+ multiplier applies)

### Requirement: Single-pass and cross-pass combo multiplier

A single pass clearing **4 or more squares** SHALL apply a multiplier to that pass. Consecutive qualifying passes (each clearing >= 4 squares) SHALL escalate the multiplier on the deterministic curve **4, 8, 12, 16** (capped at 16). Any pass clearing fewer than 4 squares SHALL reset the multiplier to x1. The consecutive-qualifying-pass count SHALL be tracked as `combo` in the game state and SHALL count qualifying passes, not squares.

#### Scenario: Four squares trigger the first multiplier

- **WHEN** a pass clears exactly four distinct squares with no prior combo
- **THEN** the score increases by `4 x 40 x 4`

#### Scenario: Combo escalates across consecutive qualifying passes

- **WHEN** consecutive passes each clear >= 4 squares
- **THEN** the multiplier follows 4, then 8, then 12, then 16, and stays capped at 16 thereafter

#### Scenario: A sub-4 pass resets the combo

- **WHEN** a pass clearing >= 4 squares is followed by a pass clearing fewer than 4 squares
- **THEN** the combo resets to x1, and a subsequent >= 4 pass starts the curve again at 4

### Requirement: Soft-drop scoring

Soft-dropping the active piece SHALL award **+1 point per row** the piece descends under soft drop.

#### Scenario: Soft drop awards per row

- **WHEN** the player soft-drops a piece N rows
- **THEN** the score increases by N

### Requirement: Board-state bonuses

The system SHALL award a **single-colour bonus** (default 1,000) when the settled field is reduced to a single colour, and a larger **all-clear bonus** (default 10,000) when the board is emptied of all locked cells. Both values SHALL be configurable constants. Bonuses SHALL be checked on the settled grid after a pass completes.

#### Scenario: Single-colour bonus

- **WHEN** a pass leaves the settled field containing cells of only one colour
- **THEN** the single-colour bonus (default 1,000) is added to the score

#### Scenario: All-clear bonus

- **WHEN** a pass leaves the board with no locked cells
- **THEN** the all-clear bonus (default 10,000) is added to the score

### Requirement: Combo exposed via the test seam

The `combo` counter SHALL be exposed on the public `window.__lumines.state()` projection so the eval can assert the multiplier curve. This addition SHALL be additive: existing `state()` fields SHALL be unchanged.

#### Scenario: combo readable from state

- **WHEN** consecutive qualifying passes occur and `window.__lumines.state()` is read
- **THEN** the projection includes a `combo` count reflecting consecutive qualifying passes
