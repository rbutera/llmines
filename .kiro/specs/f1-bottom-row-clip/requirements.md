# Requirements — F1: Bottom-row clip/delay fix

## Introduction

LLMines is an existing, working Lumines-like game. When a 2×2 piece lands on (or
near) the bottom row, it currently appears to delay and clip BELOW the game
canvas before snapping into place on the bottom row. This is a rendering/timing
bug: the falling piece is drawn with a fractional fall offset that keeps
increasing even after the piece can no longer descend, pushing cells below the
playfield until the gravity tick finally locks it.

This feature fixes the artifact so a landing block settles cleanly within the
playfield with no visible delay or clipping, without rebuilding the game or
regressing existing behaviour/polish.

## Requirements

### Requirement 1 — Render within bounds

**User Story:** As a player, I want a landing block to always render inside the
playfield, so that I never see cells drawn below the grid.

#### Acceptance Criteria
1. WHEN a piece is hard-dropped or settles onto the bottom row THEN the renderer
   SHALL draw all of its cells entirely within the canvas/playfield bounds at
   all times (no cell drawn below the bottom grid row).
2. WHEN the active piece cannot descend further (it is resting on the floor or
   the stack) THEN the system SHALL NOT apply a downward fractional fall offset
   that moves it below its resting row.

### Requirement 2 — Immediate, smooth settle

**User Story:** As a player, I want the block to settle immediately and smoothly
on the bottom row, so that there is no visible hover/clip delay before it locks.

#### Acceptance Criteria
1. WHEN a piece comes to rest on the bottom row (or stack) THEN the settle SHALL
   appear immediate, with no visible delay or clip artifact before it locks.
2. WHEN a piece is mid-fall (can still descend) THEN its descent SHALL remain
   smooth (the existing fractional interpolation is preserved).

### Requirement 3 — Correct landed grid (testability)

**User Story:** As a test harness, I want `window.__lumines.state().grid` to
reflect the landed block on the correct bottom rows, so that I can assert there
are no out-of-bounds cells.

#### Acceptance Criteria
1. WHEN a block lands THEN `window.__lumines.state().grid` SHALL reflect the
   landed block on the correct bottom row(s) with no out-of-bounds cells.

### Requirement 4 — No regression of overhang settle (polish)

**User Story:** As a player, I want the existing smooth per-column overhang
settle to keep working, so that polish is preserved.

#### Acceptance Criteria
1. WHEN cells settle by per-column gravity after a lock or clear THEN the
   existing smooth collapse animation SHALL continue to play unchanged.
2. WHEN this fix is applied THEN no existing core unit test or E2E behaviour
   SHALL regress.
