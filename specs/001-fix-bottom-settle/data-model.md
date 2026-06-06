# Data Model: Fix Bottom Settle

## Playfield

**Purpose**: Visible board boundary for all falling, settling, and landed cells.

**Fields**:

- `columns`: Fixed visible width, currently 16.
- `rows`: Fixed visible height, currently 10.
- `cellSize`: Render unit used to convert grid positions to canvas positions.
- `bottomBoundary`: Last visible pixel row of the playfield.

**Validation Rules**:

- No visible cell rectangle may draw below `bottomBoundary`.
- Valid landed grid rows are `0` through `rows - 1`.
- Valid landed grid columns are `0` through `columns - 1`.

## Falling Piece

**Purpose**: Active 2x2 piece controlled by the player or gravity before it locks into the grid.

**Fields**:

- `cells`: 2x2 color matrix.
- `position`: Top-left grid row and column.
- `fallProgress`: Visual interpolation progress toward the next gravity row.
- `landingState`: Whether the piece can descend further or is at the landing boundary.

**Validation Rules**:

- A falling piece may only occupy valid model positions.
- Its rendered vertical offset must be capped so the lowest visible cell remains inside the playfield.
- Hard drop transitions directly from active piece to landed grid state without an intermediate below-grid frame.

**State Transitions**:

```text
spawning -> falling -> landing-boundary -> locked
falling -> hard-dropped -> locked
```

## Landed Grid

**Purpose**: Settled board state after a piece locks.

**Fields**:

- `grid`: 10 by 16 matrix of cell colors or empty cells.
- `settledCells`: Occupied cells derived from the grid.
- `markedCells`: Cells selected by square detection and sweep behavior.

**Validation Rules**:

- Landed cells must only exist in valid rows and columns.
- Bottom-row landings must fill the expected final rows, typically rows 8 and 9 for a 2x2 piece landing on the floor.
- No out-of-bounds cells may be represented in the public state inspection surface.

## Settle Motion

**Purpose**: Visual transition that keeps landed cells smooth after movement or clears, including per-column overhang behavior.

**Fields**:

- `columnOffsets`: Temporary per-cell or per-column vertical offsets used during collapse animation.
- `duration`: Short animation period for easing offsets back to the grid.
- `affectedColumns`: Columns whose cells visually settle after a grid change.

**Validation Rules**:

- Offsets for settled cells may animate within the playfield but must not push visible cells below the playfield.
- Existing per-column overhang/collapse behavior must continue for uneven stacks.
- Active-piece landing correction must not clear or suppress settled-grid offsets unrelated to the landing artifact.
