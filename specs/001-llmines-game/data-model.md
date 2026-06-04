# Data Model: LLMines Game

## Color

Represents one of the two playable block colors.

**Fields**

- `value`: `0` for color A or `1` for color B

**Validation Rules**

- No other color values are valid.
- Empty cells are represented separately from color values.

## Cell

Represents one position in the playfield grid.

**Fields**

- `color`: color value when occupied, otherwise empty
- `state`: visual/gameplay state such as active, settled, marked, clearing, or collapsing

**Validation Rules**

- A grid cell may contain at most one color.
- Only settled cells participate in square detection.
- Active-piece cells are included in state snapshots for deterministic testing but do not count as settled until locked.

## Playfield Grid

Represents the 16-column by 10-row board, with row 0 at the top.

**Fields**

- `rows`: 10 rows
- `columns`: 16 columns
- `settledCells`: occupied cells that have locked
- `activePieceCells`: projected cells from the currently falling piece

**Validation Rules**

- Coordinates must remain within columns 0-15 and rows 0-9.
- Gravity after deletion preserves vertical order inside each column.
- State snapshots for test mode include settled cells plus the active piece.

## Piece

Represents the active 2x2 falling block.

**Fields**

- `matrix`: 2x2 color matrix
- `row`: top row of the piece
- `col`: left column of the piece
- `orientation`: current 90-degree rotation state

**Validation Rules**

- The spawn position is columns 7-8 and rows 0-1.
- Each of the four cells is independently assigned color A or B.
- Movement and rotation are valid only if all resulting cells remain in bounds and do not overlap settled cells.
- A piece locks when it cannot move one row lower.

**State Transitions**

- `spawning` -> `falling` when spawn cells are open.
- `spawning` -> `gameOver` when any spawn cell is occupied.
- `falling` -> `falling` after valid move, rotate, gravity, or soft-drop.
- `falling` -> `locked` after hard-drop or failed downward gravity step.

## Marked Square

Represents one distinct aligned monochrome 2x2 square counted by its top-left coordinate.

**Fields**

- `row`: top row of the square
- `col`: left column of the square
- `color`: shared color
- `cells`: four participating cell coordinates

**Validation Rules**

- Valid top-left rows are 0-8.
- Valid top-left columns are 0-14.
- All four cells must be settled and have the same color.
- Larger monochrome regions produce one marked square for every qualifying aligned 2x2 top-left coordinate.

## Marked Cell

Represents a settled cell that participates in at least one marked square.

**Fields**

- `row`: cell row
- `col`: cell column
- `color`: cell color
- `squareIds`: marked squares that include this cell

**Validation Rules**

- A marked cell is deleted only when the sweep passes its column.
- A marked cell may belong to more than one marked square.

## Timeline Sweep

Represents the repeating clear bar.

**Fields**

- `x`: current sweep position from 0 through 16
- `periodMs`: 4000
- `columnDurationMs`: 250
- `passedColumns`: columns crossed during the current sweep
- `deletedCellsThisSweep`: count of cells deleted during the current traversal
- `clearedSquaresThisSweep`: distinct square top-left coordinates cleared during the current traversal

**Validation Rules**

- A full traversal is exactly 8 beats at 120 BPM, equal to 4.0 seconds.
- Sweep progress wraps to the left after reaching column 16.
- In test mode, `dtMs` advancement is deterministic and independent of audio time.

## Score

Represents the cumulative player score for a game session.

**Fields**

- `value`: non-negative integer

**Validation Rules**

- Score starts at 0.
- On each sweep that deletes cells, increment by `deletedCellsThisSweep * clearedSquaresThisSweep`.
- Sweeps that delete no cells do not change score.

## Game Session

Represents the current round.

**Fields**

- `screen`: start, playing, or game-over
- `grid`: playfield grid
- `activePiece`: current piece, if any
- `score`: current score
- `sweep`: timeline sweep state
- `rngState`: deterministic or random piece generation state
- `audioState`: backing-track source and loop status
- `testMode`: whether deterministic harness behavior is active

**Validation Rules**

- Start screen precedes the first round.
- Restart resets grid, score, sweep, game-over state, and active piece.
- Normal play auto-spawns after locks; test-mode `tick()` does not.
- Test-mode hooks are exposed only when the public test-mode flag is enabled.
