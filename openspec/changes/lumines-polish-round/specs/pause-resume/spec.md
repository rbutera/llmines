## ADDED Requirements

### Requirement: Escape pauses and resumes play

Pressing Escape during active play SHALL toggle a paused state. While paused, the timeline sweep AND gravity SHALL be halted and SHALL NOT advance; the active piece, settled grid, and score SHALL be preserved. Pressing Escape again (or resuming) SHALL continue play from where it left off WITHOUT rewinding or jumping the sweep. Pause SHALL be a production-loop concern only and SHALL NOT alter the deterministic core or the `window.__lumines` seam.

#### Scenario: Paused freezes the sweep and gravity

- **WHEN** the game is playing and `pause()` is called, then a production frame is run
- **THEN** `sweepX` does not advance and gravity does not tick

#### Scenario: Resume continues without rewind

- **WHEN** a paused game is `resume()`d and a subsequent production frame runs with the clock advanced
- **THEN** the sweep advances forward again from its current position (no rewind, no discontinuous jump)

#### Scenario: Pause preserves game state

- **WHEN** the game is paused
- **THEN** the active piece, the settled grid, the score, and `gameOver` are unchanged
