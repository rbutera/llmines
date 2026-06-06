## ADDED Requirements

### Requirement: Beat-derived sweep timing

The timeline SHALL advance at exactly **one grid column per eighth-note** of the active track's tempo, so a full 16-column pass takes exactly **two 4/4 bars**. Sweep position SHALL be a pure function of absolute audio-clock time (read via the injected `Clock` from `lumines-audio-clock`), not of an accumulated wall-clock interval. The controller SHALL compute the absolute target sweep position from `clock.now()` and feed the pure core only the forward column delta; the core SHALL remain a pure function of `(state, columnDelta)`.

#### Scenario: One column per eighth-note

- **WHEN** the audio clock advances by one eighth-note at the current BPM
- **THEN** the sweep advances by exactly one column

#### Scenario: Full pass is two bars

- **WHEN** the audio clock advances by two full 4/4 bars at the current BPM
- **THEN** the sweep completes exactly one full 16-column pass and wraps to the left edge

#### Scenario: Frame-rate independence (no accumulator drift)

- **WHEN** the clock is advanced by a total of three eighth-notes in a single step versus the same total split across three smaller steps
- **THEN** the final grid and final `sweepX` are identical in both cases

#### Scenario: Dropped frames do not desync the bar

- **WHEN** a frame is dropped or delayed (a large gap between two clock readings)
- **THEN** the next frame recomputes sweep position from absolute clock time and the bar position matches the music with no cumulative drift

### Requirement: Squares clear only on the pass that fully covers them

A marked 2x2 square SHALL be cleared only on the sweep pass that fully covers it. The set of cells eligible for deletion this pass SHALL be snapshotted at pass start; a square forming behind the bar's current column SHALL wait for the next pass, and a square completed mid-pass (whether ahead of, at, or behind the bar) that was not in the pass-start snapshot SHALL NOT clear during the current pass.

#### Scenario: Square formed behind the bar waits a pass

- **WHEN** a mono 2x2 square forms in a column the bar has already crossed during the current pass
- **THEN** it is not cleared this pass
- **AND** it is cleared on the next pass that fully covers it (assuming it persists)

#### Scenario: Square present at pass start clears this pass

- **WHEN** a mono 2x2 square exists in the settled grid at the moment the pass starts
- **THEN** the bar deletes its cells as the leading edge crosses its columns during this pass

#### Scenario: Square completed mid-pass ahead of the bar waits

- **WHEN** a mono 2x2 square is completed mid-pass in columns the bar has not yet reached but which were not marked at pass start
- **THEN** it is not deleted this pass and waits for the next pass

### Requirement: Incremental per-column gravity on clear

When the bar clears a column's marked cells, all cells above the removed cells in that column SHALL fall by per-column gravity **immediately, in the same step** the bar clears that column, not deferred to the end of the pass. Columns SHALL be processed left-to-right and monotonically (delete the column's snapshot-marked cells, then settle that column and any column to its left that lost support) so that deletion and settle never race and a cell falling into a coordinate after the pass-start snapshot is never wrongly deleted.

#### Scenario: Stack above a swept column falls immediately (the bug fix)

- **WHEN** a clearable square sits in a column with a tall stack of cells above it, and the bar crosses that column without yet completing the pass
- **THEN** the stack above the cleared cells has already fallen (settled) in `window.__lumines.state().grid`
- **AND** this happens before the pass completes (without the bar reaching the far edge)

#### Scenario: A post-snapshot falling cell is not wrongly deleted

- **WHEN** a cell falls into a coordinate that was marked for deletion at pass start but the falling cell entered that coordinate after the snapshot was taken
- **THEN** that falling cell is not deleted by this pass's snapshot deletion

#### Scenario: A column is never both settling and pending deletion in the same step

- **WHEN** the leading edge crosses a column
- **THEN** that column's snapshot deletion completes before its settle, and the column is processed exactly once during the pass

### Requirement: Cascades resolve on the next pass

New mono 2x2 squares formed by an incremental settle SHALL NOT be added to the current pass's snapshot. They SHALL be detected at the next pass start and become eligible for clearing on a subsequent pass. A cascade square that lands in a column the bar has already crossed this pass SHALL wait a full additional pass.

#### Scenario: Collapse-formed square clears on a later pass

- **WHEN** an incremental settle during a pass causes the collapsed grid to form a new mono 2x2 square
- **THEN** that new square is not cleared during the current pass
- **AND** it is marked at the next pass start and cleared on a subsequent covering pass

#### Scenario: Cascade in an already-passed column waits a full pass

- **WHEN** a cascade forms a square in a column the bar has already crossed during the current pass
- **THEN** it waits for the next full pass before it can be cleared

### Requirement: Scoring is banked per pass, gravity is per column

Decoupling gravity to per-column SHALL NOT change the per-pass scoring boundary: the score for cleared squares SHALL be banked when a pass completes, even though gravity now settles per column during the pass. (The score *formula* itself is owned by a separate change; this requirement only fixes the timing boundary.)

#### Scenario: Score banks at pass completion

- **WHEN** a pass clears one or more squares
- **THEN** the score contribution for that pass is applied at pass completion, not incrementally per column

### Requirement: Determinism and test seam preserved for the sweep

The sweep SHALL remain deterministic and inspectable via the `window.__lumines` seam. The existing drivers (`sweepNow`, `sweepProgress`) SHALL continue to work; a beat-sync test helper that advances the clock MAY be added additively. In test mode the production loop SHALL NOT run.

#### Scenario: Existing sweep drivers still work

- **WHEN** a test calls `window.__lumines.sweepProgress(dtMs)` or `sweepNow()`
- **THEN** the sweep advances deterministically as before

#### Scenario: Same seed yields the same sweep outcome

- **WHEN** two runs use the same seed and the same sequence of clock advances and inputs
- **THEN** the resulting grids and scores are identical
