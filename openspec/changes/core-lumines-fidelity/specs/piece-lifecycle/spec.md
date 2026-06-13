## ADDED Requirements

### Requirement: Pieces spawn above the visible field

A new piece SHALL spawn in staging rows ABOVE the visible field (the 2×2's top cell at row -2,
bottom at row -1) and descend into the visible 16×10 field under gravity. The visible field SHALL be
fully usable for stacking. Placement legality SHALL treat above-field rows as free.

#### Scenario: A new piece begins above the field

- **WHEN** a new piece spawns
- **THEN** its top cells are at row -2 and bottom cells at row -1 (above row 0)
- **AND** the piece descends into the field under gravity

#### Scenario: The top rows of the field are usable

- **WHEN** the stack is built up to row 0 outside the spawn columns
- **THEN** the game does not end merely because cells occupy rows 0-1 away from the spawn columns

### Requirement: Game over only when a piece cannot enter the field

Game over SHALL occur only when a newly spawned piece cannot enter the visible field — i.e. the cells
it would occupy at the top in-field rows (rows 0-1 of the spawn columns) are already occupied. A
piece staged above the field SHALL NOT trigger game over by virtue of being above the field.

#### Scenario: Blocked spawn columns end the game

- **WHEN** the spawn columns are filled up to row 0
- **AND** a new piece spawns above and cannot reach any in-field row
- **THEN** the game ends (game over)

#### Scenario: One free in-field row admits the piece

- **WHEN** the spawn columns are filled from row 1 down but row 0 is free
- **THEN** a new piece enters the field and the game does NOT end

### Requirement: Locking above the field is a top-out

A piece that locks with ANY of its cells above row 0 (still in the staging rows) SHALL end the game.
Above-field cells SHALL never be silently discarded without consequence: a lock that cannot fit
entirely inside the field IS the "blocks pile to the top" condition.

#### Scenario: Lateral shift onto a full column tops out

- **WHEN** a staged piece is moved sideways above a column stacked to row 0 and gravity locks it
  with cells still above the field
- **THEN** the game ends (game over); no cells are silently lost with play continuing

### Requirement: Gem preserved through hard drop

Hard drop SHALL carry the active piece's chain special through its descent loop, exactly as move,
rotate, and gravity descent do. A gem placed by hard drop SHALL lock as a chain-special cell, not a
plain block.

#### Scenario: Hard-dropped gem lands as a special

- **WHEN** a piece carrying a chain special is hard-dropped
- **THEN** after it locks, the cell that held the special is recorded in the settled specials set

#### Scenario: Gem survives hard drop regression

- **WHEN** the same gem piece is hard-dropped repeatedly under test
- **THEN** the special is present after every lock (never silently dropped)

### Requirement: Soft drop and hard drop descent semantics

Soft drop SHALL descend one row per step and accrue +1 soft-drop point per descended row (banked on
lock per the scoring capability). Hard drop SHALL descend to the lowest legal row and lock
immediately. Both SHALL preserve the chain special through descent.

#### Scenario: Soft drop descends one row and accrues a point

- **WHEN** a piece soft-drops one row without locking
- **THEN** the piece is one row lower and 1 soft-drop point is accrued (not yet banked)

#### Scenario: Hard drop lands at the lowest legal row

- **WHEN** a piece is hard-dropped over an empty column
- **THEN** it comes to rest on the floor and locks immediately

### Requirement: Spawn-hold window preserved

A freshly spawned piece SHALL hold at the top for the hold window before gravity resumes, so
placement is deliberate and a carried-over drop key cannot cascade into the next piece. Spawning a
new piece SHALL reset any pending soft-drop bonus to zero.

#### Scenario: New piece holds before falling

- **WHEN** a piece spawns
- **THEN** gravity is suspended until the hold window lapses or the player presses a fresh drop

#### Scenario: Spawn resets the soft-drop bonus

- **WHEN** a new piece spawns after the previous one banked its soft-drop bonus
- **THEN** the new piece starts with a soft-drop bonus of 0
