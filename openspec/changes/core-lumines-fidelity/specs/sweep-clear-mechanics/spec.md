## ADDED Requirements

### Requirement: Mark squares as the bar passes

The timeline sweep SHALL mark completed-square cells incrementally as its leading edge reaches each
column, detecting squares against the live settled grid. A square completed mid-pass, ahead of the
bar, SHALL be marked when the bar's edge reaches it and SHALL clear on the CURRENT pass, never
waiting a full extra traversal. A square cell whose column the bar has already passed SHALL NOT be
re-marked.

#### Scenario: Square formed ahead of the bar clears on the current pass

- **WHEN** the sweep is mid-pass at column 4 and a 2×2 same-colour square is completed at columns
  8-9
- **THEN** the bar marks that square's cells when its leading edge reaches columns 8-9
- **AND** the square clears on this pass, not the next

#### Scenario: Square behind the bar is not re-marked

- **WHEN** the bar has already passed and erased columns 0-3 this pass
- **AND** a settle drops cells into columns 0-3 forming a new square there
- **THEN** that new square is NOT marked or cleared on the current pass (the columns are already
  passed)

#### Scenario: Already-complete square at pass start clears this pass

- **WHEN** a 2×2 same-colour square exists at columns 2-3 before the pass begins
- **THEN** the bar marks it as the edge reaches columns 2-3 and it clears on this pass

### Requirement: Per-group batch erase with deferred gravity

Marked cells SHALL erase as a contiguous-group batch when the bar reaches a column with no marked
cells (a gap) or reaches the right edge — never column-by-column. Gravity SHALL settle only AFTER a
group erase, and SHALL settle once per group (not per column). Overlapping or adjacent squares whose
marked columns are contiguous SHALL erase together as one group.

#### Scenario: A contiguous marked run erases as one batch

- **WHEN** marked cells span columns 5-7 contiguously and column 8 has no marked cells
- **THEN** when the bar's edge reaches column 8 (the gap), all marked cells in columns 5-7 erase in
  a single batch
- **AND** gravity settles once over the affected columns after that batch

#### Scenario: Gravity does not run between columns of one group

- **WHEN** a single marked group spans columns 3-5
- **THEN** no per-column settle occurs at columns 3 or 4
- **AND** the only settle for that group runs after column 5's batch erase

#### Scenario: Marked group at the right edge erases at pass end

- **WHEN** a marked group extends to the last column with no trailing gap
- **THEN** the group erases as a batch when the bar reaches the right edge

#### Scenario: Two groups separated by a gap erase independently

- **WHEN** marked cells occupy columns 2-3, column 4 is a gap, and marked cells occupy columns 6-7
- **THEN** the columns 2-3 group erases when the edge reaches the column-4 gap
- **AND** the columns 6-7 group erases when the edge reaches the right edge (or the next gap)

### Requirement: Chain flood activates at group-erase time

When a marked cell carrying a chain special is erased, its chain flood SHALL activate at the
group-erase moment, clearing every same-colour orthogonally-connected cell (including cells in
columns ahead of the bar). Flood-consumed cells SHALL have their marks cleared so identity-based
deletion never targets an innocent cell. Flooded-in extras SHALL contribute nothing to the pass
square count or score.

#### Scenario: Gem in an erased group floods at batch time

- **WHEN** a marked group containing a chain-special cell erases as a batch
- **THEN** the chain flood fires in the same batch step, clearing the connected same-colour region
- **AND** gravity settles once after the flood

#### Scenario: Flood ahead of the bar clears those cells and their marks

- **WHEN** a chain flood reaches same-colour cells in columns the bar has not yet passed
- **THEN** those cells are cleared and their marks removed
- **AND** the bar does not later attempt to delete a settled innocent cell at those coordinates

#### Scenario: Flooded extras score nothing

- **WHEN** a gem flood clears 6 extra connected cells beyond a single completed square
- **THEN** only the 1 distinct square counts toward the pass score; the 6 flooded extras add 0

### Requirement: Cascades resolve on the appropriate pass

After a group erase and settle, newly-formed squares SHALL be marked and cleared per the incremental
marking rule: a cascade forming under columns the bar has NOT yet passed SHALL be picked up on the
current pass when the edge reaches those columns; a cascade forming behind the bar (in already-passed
columns) SHALL be picked up on the NEXT pass. The sweep SHALL NOT re-enter an erased column within
the same pass (no same-pass infinite cascade).

#### Scenario: Cascade under unpassed columns clears this pass

- **WHEN** a group erase at columns 2-3 drops cells that form a new square at columns 6-7 (not yet
  passed)
- **THEN** the bar marks and clears that cascade square when its edge reaches columns 6-7 this pass

#### Scenario: Cascade behind the bar clears next pass

- **WHEN** a group erase at columns 6-7 drops cells that form a new square at columns 2-3 (already
  passed)
- **THEN** that cascade square is not cleared this pass and is harvested on the next pass

### Requirement: Marks travel with cells through settles

The identity-based marks mechanism SHALL be preserved: when gravity settles after a group erase or
chain flood, each marked cell SHALL keep its mark wherever it falls, and emptied cells SHALL carry no
mark. Deletion SHALL always target the originally-marked cell at its current row, never a stale
(row, col) that a settle has refilled.

#### Scenario: A marked cell that falls keeps its mark at its new row

- **WHEN** a chain flood empties cells below a marked cell and the column settles
- **THEN** the marked cell's mark is now at its new (lower) row
- **AND** an innocent cell that settled onto the marked cell's old row carries no mark
