# Bugfix Requirements Document

## Introduction

In the existing LLMines (Lumines-style) build, the renderer draws the active falling
piece with a fractional vertical offset (`fallProgress * CELL`) so the piece descends
smoothly between discrete gravity rows. This interpolation is applied unconditionally —
including when the piece has already reached the lowest row it can legally occupy (the
bottom row of the playfield, or the top of a settled stack).

As a result, a piece that is resting and about to lock is still pushed downward visually
by the fractional offset, drawing cells below the bottom grid row and outside the canvas
bounds. The piece appears to clip below the playfield and hang there until the next
gravity tick snaps it into place, producing a visible delay/clip artifact instead of a
clean, immediate settle.

The grid is 10 rows × 16 cols (`grid[row][col]`, row 0 = TOP, bottom row index = 9),
the canvas is `ROWS * CELL` (400px) tall, and a piece is 2×2. The fix must remove the
below-bounds clip and pre-lock delay on the bottom row while preserving the existing
smooth descent and per-column settle animation for pieces that can still fall.

## Bug Analysis

### Current Behavior (Defect)

When the active piece is resting on the bottom row (or on top of the settled stack) but
has not yet been locked by a gravity tick, the renderer still applies the fractional fall
offset to it.

1.1 WHEN the active piece is resting on the bottom row (its lowest cells occupy the last
grid row and it cannot descend further) AND `fallProgress` is greater than 0 THEN the
system draws the piece's bottom cells below the bottom grid row, outside the canvas
bounds.

1.2 WHEN the active piece is resting on top of the settled stack (it cannot descend
further) AND `fallProgress` is greater than 0 THEN the system draws the piece overlapping
into the row(s) below its resting position rather than at its true resting row.

1.3 WHEN the active piece has reached its resting position THEN the system delays the
visual snap into place until the next gravity tick locks the piece, producing a visible
clip/delay artifact before the piece appears on the correct row.

### Expected Behavior (Correct)

2.1 WHEN the active piece is resting on the bottom row (its lowest cells occupy the last
grid row and it cannot descend further) THEN the system SHALL render every cell of the
piece entirely within the canvas/playfield bounds, with no cells drawn below the bottom
grid row.

2.2 WHEN the active piece is resting on top of the settled stack (it cannot descend
further) THEN the system SHALL render the piece at its true resting row with no cells
drawn into the row(s) below its resting position.

2.3 WHEN the active piece has reached its resting position THEN the system SHALL settle it
into place immediately and smoothly, with no visible delay or clip artifact before it
locks, and `window.__lumines.state().grid` SHALL reflect the landed block on the correct
bottom rows with no out-of-bounds cells.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the active piece can still descend at least one more row (it is not resting) THEN
the system SHALL CONTINUE TO interpolate its vertical position smoothly using
`fallProgress` for the existing smooth per-column overhang settle.

3.2 WHEN settled cells collapse downward after a sweep/clear THEN the system SHALL CONTINUE
TO animate the per-column fall offsets easing into their final positions exactly as before.

3.3 WHEN a piece is hard-dropped THEN the system SHALL CONTINUE TO place and lock it at the
lowest legal row, and `window.__lumines.state().grid` SHALL CONTINUE TO reflect the result
as it does today.

3.4 WHEN the game is in test mode (`fallProgress` is 0) THEN the system SHALL CONTINUE TO
render the active piece at its exact grid position with no interpolation offset.

3.5 WHEN sweep, marked-cell pulsing, clear flashes, and scoring run THEN the system SHALL
CONTINUE TO behave identically to the current build.
