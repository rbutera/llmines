## ADDED Requirements

### Requirement: Whole-grid 2x2 overlap-counting square detection

Square detection SHALL scan the entire settled grid for every aligned 2x2 window whose four cells are the same non-null colour, independent of piece origin. A contiguous mono rectangle of `W x H` SHALL count as `(W-1) x (H-1)` distinct squares (overlapping windows counted by top-left corner). All cells belonging to any completed square SHALL be marked for deletion as the union of those squares' cells. There SHALL be no line-clear mechanic.

#### Scenario: Mono rectangle overlap counts

- **WHEN** the settled grid contains a mono rectangle of one colour
- **THEN** the count of distinct squares is `(W-1) * (H-1)` (e.g. 2x2 -> 1, 2x3 -> 2, 3x3 -> 4, 4x4 -> 9)
- **AND** every cell of the rectangle is marked

#### Scenario: Cross-piece square detected

- **WHEN** a mono 2x2 square spans cells contributed by two different locked pieces
- **THEN** it is detected as one square because detection scans the settled grid, not piece boundaries

#### Scenario: No line clears

- **WHEN** a full row of the grid is filled with cells
- **THEN** no clear occurs solely because the row is full; clears happen only for mono 2x2 squares covered by the sweep

### Requirement: Distinct-square count exposed via the test seam

The number of distinct completed squares (`distinctSquares`) SHALL be exposed on the public `window.__lumines.state()` projection so the eval can assert it. This addition SHALL be additive: existing `state()` fields (grid, score, gameOver, sweepX) and the existing `window.__lumines` methods SHALL be unchanged.

#### Scenario: distinctSquares readable from state

- **WHEN** the settled grid contains completed mono squares and `window.__lumines.state()` is read
- **THEN** the projection includes a `distinctSquares` count matching the overlap-counting detection result

#### Scenario: Existing state fields unchanged

- **WHEN** `window.__lumines.state()` is read after this change
- **THEN** the `grid`, `score`, `gameOver`, and `sweepX` fields are still present and unchanged in shape
