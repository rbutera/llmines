## ADDED Requirements

### Requirement: Faithful base square scoring

A pass clearing 1 to 3 distinct squares SHALL score 40 points per square (40 / 80 / 120). Only
distinct completed 2×2 squares cleared this pass SHALL be counted; flood-fill chain extras SHALL NOT
be counted. Scoring SHALL be integer-only.

#### Scenario: One square scores 40

- **WHEN** a pass clears exactly 1 distinct square
- **THEN** the pass scores 40 (before any house multiplier)

#### Scenario: Three squares score 120

- **WHEN** a pass clears exactly 3 distinct squares
- **THEN** the pass scores 120 (before any house multiplier)

### Requirement: Single-sweep big-clear package

A pass clearing 4 or more distinct squares SHALL score the single-sweep package: 640 for 4 squares,
plus 160 for each additional square (5 = 800, 6 = 960). This package, not a linear per-square value,
SHALL be the base for any house multiplier.

#### Scenario: Four squares score the 640 package

- **WHEN** a pass clears exactly 4 distinct squares
- **THEN** the base package is 640 (not 4 × 40)

#### Scenario: Six squares score 960

- **WHEN** a pass clears exactly 6 distinct squares
- **THEN** the base package is 960 (640 + 2 × 160)

### Requirement: Cross-pass streak multiplier (house mechanic, Lumines II+)

The cross-pass streak multiplier SHALL be retained as a documented house mechanic layered on top of
the faithful base, with curve `STREAK_CURVE = [1, 2, 3, 4]` applied to the WHOLE faithful pass
package. Because the big-clear package already contains the single-sweep ×4 (640 + 160(n−4) ≡ 40n ×
4), the streak curve SHALL NOT re-apply a ×4 (the legacy `[4,8,12,16]` curve is removed). A pass
clearing 4 or more squares SHALL be qualifying and SHALL escalate the streak count. A pass clearing
fewer than 4 squares SHALL apply ×1 and reset the streak count to 0.

#### Scenario: First qualifying pass pays the bare package

- **WHEN** a pass clears 4 squares with no prior streak
- **THEN** the pass scores 640 (package × ×1), NOT 2560

#### Scenario: Multiplier applies to the package, not per square

- **WHEN** a pass clears 4 squares while the streak count selects the ×2 entry
- **THEN** the pass scores 640 × 2 = 1280

#### Scenario: Streak escalates across consecutive qualifying passes

- **WHEN** consecutive passes each clear at least 4 squares
- **THEN** the streak count increments each pass and the multiplier escalates along the curve, capped
  at the final curve entry

#### Scenario: A sub-4 pass resets the streak

- **WHEN** a pass clears fewer than 4 squares after a qualifying streak
- **THEN** the multiplier for that pass is ×1 and the streak count resets to 0

### Requirement: Scoring awarded at the right edge

Pass scoring SHALL be deferred and banked once when the sweep reaches the right edge (pass
completion), using the squares accumulated during the pass — even though erasure fires per group
mid-pass.

#### Scenario: Score banks at pass end, not at group erase

- **WHEN** groups erase mid-pass at gaps
- **THEN** no score is added at those erase moments
- **AND** the full pass score is banked when the bar reaches the right edge

### Requirement: Soft-drop scoring banked on lock

Soft drop SHALL award +1 point per cell descended, accrued for the current piece and banked into the
score exactly once when the piece locks — never per row in realtime. Hard drop SHALL award no drop
points.

#### Scenario: Soft drop banks the descent total on lock

- **WHEN** a piece is soft-dropped 5 rows then locks
- **THEN** +5 is added to the score on the lock, and the score did not tick up per row before that

#### Scenario: Hard drop awards no drop points

- **WHEN** a piece is hard-dropped any distance
- **THEN** no drop points are awarded for the drop

### Requirement: Board-state bonuses (house bonus)

The board-state bonuses SHALL be retained as documented house bonuses, assessed only on a pass where
a clear actually occurred: a settled field reduced to a single colour SHALL award 1000; a settled
field emptied of all locked cells SHALL award 10000. All-clear SHALL take precedence over
single-colour. These SHALL NOT be claimed as faithful Lumines values.

#### Scenario: All-clear bonus on an emptied board

- **WHEN** a pass clears the last cells leaving an empty settled field
- **THEN** the all-clear bonus of 10000 is awarded (and single-colour is not)

#### Scenario: No bonus on a pass that cleared nothing

- **WHEN** a pass clears 0 squares while the board happens to be a single colour
- **THEN** no board-state bonus is awarded
