# Feature Specification: Fix Bottom-Row Clip/Delay

**Feature Branch**: `001-fix-bottom-row-clip`

**Created**: 2026-06-04

**Status**: Draft

**Input**: User description: "When a block lands on (or near) the bottom row, it must settle cleanly WITHIN the playfield. Currently blocks delay and clip BELOW the game canvas before snapping into place on the bottom row."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Blocks settle cleanly on the bottom row (Priority: P1)

A player drops a block (either by letting it fall or by hard-dropping it) toward the
bottom of the playfield. The block comes to rest on the bottom row entirely inside
the visible playfield. At no point does any part of the block appear below the
playfield, and there is no pause or visual "snap-back" before the block locks into
place.

**Why this priority**: This is the entire feature. The current behaviour breaks the
core falling-block loop at the most common landing location (the floor), producing a
visible glitch on essentially every game. Fixing it restores correct, polished
landing behaviour with no other scope.

**Independent Test**: Drop a block straight to an empty bottom row and watch it land.
It can be verified visually (no cell ever drawn below the grid, no delay before lock)
and programmatically by reading `window.__lumines.state().grid` immediately after the
landing and confirming the cells occupy the correct bottom rows with no out-of-bounds
positions.

**Acceptance Scenarios**:

1. **Given** a block is falling toward an empty bottom row, **When** it reaches the
   floor and locks, **Then** every cell of the block is rendered inside the playfield
   bounds and no cell is ever drawn below the bottom row.
2. **Given** a player hard-drops a block onto the bottom row, **When** the drop
   completes, **Then** the block locks immediately and smoothly with no visible delay,
   clip, or snap-back artifact.
3. **Given** a block has just landed on the bottom row, **When** the game state is
   queried via `window.__lumines.state().grid`, **Then** the landed cells appear on the
   correct bottom rows and no cell is recorded outside the grid bounds.

---

### Edge Cases

- **Hard-drop to floor**: A hard-dropped block must lock on the bottom row in the same
  frame/settle window as any other landing — no extra delay specific to the floor.
- **Uneven bottom landing (per-column overhang)**: When the block's columns come to
  rest at different heights (one column on the floor, the other resting on an existing
  stack just above the floor), each column must settle smoothly into its own resting
  position and remain within bounds.
- **Stack reaching the bottom region**: When existing settled cells already occupy the
  lowest rows, a new block landing on top of them must rest on the stack without any
  column dipping below the playfield during the settle.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: While a block is settling or locking onto the bottom row, every cell of
  the block MUST render entirely within the playfield/canvas bounds at all times; no
  cell may be drawn below the bottom grid row.
- **FR-002**: A block hard-dropped or settling onto the bottom row MUST lock
  immediately and smoothly, with no visible delay, clip, or snap-back artifact before
  it locks.
- **FR-003**: After a block lands on the bottom row, `window.__lumines.state().grid`
  MUST reflect the landed cells on the correct bottom rows, with zero out-of-bounds
  cells.
- **FR-004**: The existing smooth per-column overhang settle behaviour MUST be
  preserved for all landings (it MUST NOT regress as a result of this fix).
- **FR-005**: All other existing game behaviour and polish (gameplay, scoring, sweep,
  rendering elsewhere on the board) MUST remain unchanged.

### Key Entities *(include if feature involves data)*

- **Block (active piece)**: The falling unit the player controls; lands and locks onto
  the grid. Relevant attribute for this feature: its rendered position relative to the
  playfield bounds during the settle.
- **Playfield grid**: The bounded set of rows and columns representing the board. The
  bottom row is its lowest row; cells must never be recorded or drawn outside these
  bounds.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across repeated bottom-row landings (both gravity-settle and hard-drop),
  no cell is ever rendered below the playfield boundary — 0 out-of-bounds frames.
- **SC-002**: Blocks landing on the bottom row lock with no perceptible delay — the
  settle-to-lock duration on the floor is indistinguishable from landings elsewhere on
  the board.
- **SC-003**: For every bottom-row landing, the queryable game state grid matches the
  rendered resting position with zero out-of-bounds cells.
- **SC-004**: Per-column overhang settle remains visually identical to its prior
  behaviour for non-bottom landings (no observable regression).

## Assumptions

- This is a single bug fix applied to the existing, working LLMines build; the game is
  not being rebuilt and all current behaviour/polish must keep working.
- "Bottom row" refers to the lowest row of the playfield grid; "near the bottom row"
  covers both natural gravity-settle and hard-drop into the floor region.
- The debug/test interface `window.__lumines.state()` already exists in the build and
  exposes `.grid`; it is the canonical way to assert landed-cell positions.
- The current clip/delay is a rendering/settle-timing defect at the bottom boundary,
  not a change to game rules — the fix preserves existing scoring, sweep, and movement
  semantics.
