# Feature Specification: Fix Bottom Settle

**Feature Branch**: `cell/speckit-codex-brownfield`

**Created**: 2026-06-04

**Status**: Draft

**Input**: User description: "Brownfield bug fix for LLMines: when a block lands on or near the bottom row, it must settle cleanly within the playfield. Hard-dropped and naturally settling pieces must never render below the grid, must lock without a visible delay or clip artifact, must report valid landed grid cells through the existing state inspection surface, and must preserve the existing smooth per-column overhang settle."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bottom-row landings stay inside the playfield (Priority: P1)

As a player, I want any piece that reaches the bottom row to remain visually contained in the playfield throughout the landing, so the board feels precise and polished.

**Why this priority**: This directly addresses the visible bug where blocks briefly clip below the playfield before snapping into place.

**Independent Test**: Can be fully tested by hard-dropping pieces to the bottom row and observing that every block cell remains inside the visible playfield for the entire landing.

**Acceptance Scenarios**:

1. **Given** a falling piece has clear space to the bottom row, **When** the player hard-drops it, **Then** the piece lands on the correct bottom rows without any visible cell extending below the playfield.
2. **Given** a falling piece is settling naturally near the bottom row, **When** gravity brings it to rest, **Then** it locks into the bottom rows immediately and smoothly with no visible below-grid delay.
3. **Given** a landed piece is inspected through the existing game-state test surface, **When** the bottom-row landing has completed, **Then** the landed cells are recorded on valid grid rows only and no out-of-bounds cells are reported.

---

### User Story 2 - Existing overhang settle polish is preserved (Priority: P2)

As a player, I want pieces with uneven column support to keep the existing smooth per-column settling behavior, so the bug fix does not make normal landings feel harsher or less polished.

**Why this priority**: The feature is a brownfield bug fix and must preserve the current landing feel outside the bottom-row clipping case.

**Independent Test**: Can be tested by landing pieces across uneven stacks and confirming the per-column overhang settle remains smooth while still respecting playfield bounds.

**Acceptance Scenarios**:

1. **Given** an uneven stack creates a per-column overhang landing, **When** a piece settles onto that stack, **Then** the existing smooth per-column visual settle remains present.
2. **Given** a per-column overhang landing occurs near the bottom row, **When** the piece settles, **Then** the landing remains smooth and no block cell is drawn below the playfield.

### Edge Cases

- A hard-dropped piece whose lowest cells land exactly on the bottom row must never render below the playfield during the drop, settle, or lock.
- A naturally falling piece that reaches the bottom row over multiple frames must settle immediately once the landing position is reached, with no extra visual delay below the grid.
- A piece landing near the bottom row while partially supported by existing blocks must keep all visible cells within bounds.
- A per-column overhang settle near the bottom must preserve the expected smooth column offsets without allowing any column to exceed the playfield boundary.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The game MUST keep every visible cell of a falling, hard-dropped, settling, or locking piece within the playfield bounds whenever the piece lands on or near the bottom row.
- **FR-002**: The game MUST lock a piece that has reached its valid bottom-row landing position without any visible below-grid delay or snap-back artifact.
- **FR-003**: The game MUST record a piece landed on the bottom row in the correct valid grid rows, with no landed cells outside the grid.
- **FR-004**: The game MUST apply the same bottom-bound containment to both hard-drop landings and natural gravity-based landings.
- **FR-005**: The game MUST preserve the existing smooth per-column overhang settle behavior for supported columns and uneven stack landings.
- **FR-006**: The game MUST avoid changing unrelated gameplay behavior, scoring, controls, piece generation, board dimensions, or visual polish outside the bottom-row landing artifact.

### Key Entities

- **Playfield**: The visible grid area where pieces fall, settle, and lock; all piece cells must remain within this boundary when visible.
- **Falling Piece**: The active player-controlled piece before it becomes part of the landed grid.
- **Landed Grid**: The board state after a piece locks; it must contain landed cells only at valid grid positions.
- **Settle Motion**: The short visual landing transition, including existing per-column overhang behavior, that makes pieces feel smooth as they come to rest.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of tested hard-drop landings to the bottom row, no piece cell is visible below the playfield at any point.
- **SC-002**: In 100% of tested natural gravity landings on or near the bottom row, the piece settles and locks with zero visible below-grid delay before the landed state appears.
- **SC-003**: In 100% of inspected bottom-row landings, the game-state test surface reports landed cells only on valid grid rows and columns.
- **SC-004**: Existing per-column overhang settle behavior remains visibly smooth in representative uneven-stack landings, including cases near the bottom row.
- **SC-005**: No unrelated gameplay outcomes change in regression checks for controls, piece movement, scoring, and normal non-bottom landings.

## Assumptions

- The current game is already playable and polished, and this feature is limited to correcting the bottom-row clipping and delay artifact.
- The playfield boundary is the authoritative visible limit for all active, settling, and landed piece cells.
- The existing game-state inspection surface remains available for validating landed grid rows after a bottom-row lock.
- Representative testing includes both direct hard drops and natural gravity landings, plus uneven-stack overhang cases.
