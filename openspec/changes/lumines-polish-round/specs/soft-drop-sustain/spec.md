## ADDED Requirements

### Requirement: Holding soft-drop sustains continuous slow fall

Holding the soft-drop key SHALL produce CONTINUOUS descent at soft-drop speed — faster than normal gravity (`GRAVITY_INTERVAL_MS`) and slower than an instant hard-drop — rather than one row per key press. A fresh soft-drop press SHALL end the spawn-hold, perform an immediate step, and engage sustained mode; releasing the key SHALL disengage sustained mode and revert to normal gravity; locking or spawning a piece SHALL clear sustained mode so the next piece's spawn-hold is honoured. The spawn-hold guard SHALL be preserved: a carried-over key (OS key-repeat) while a freshly spawned piece is held SHALL NOT fast-fall the new piece. Each sustained step SHALL route through the pure `softDrop` core op so scoring (+1 per descended row, banked on settle) and determinism are unchanged.

#### Scenario: Held soft-drop descends faster than gravity

- **WHEN** a fresh soft-drop press engages sustained mode and successive production frames each advance the clock by less than one gravity interval
- **THEN** the active piece descends multiple rows over that span — strictly more than gravity alone would move it in the same elapsed time

#### Scenario: Releasing reverts to gravity cadence

- **WHEN** sustained soft-drop is disengaged (key released)
- **THEN** the piece resumes descending at the normal gravity cadence

#### Scenario: Spawn-hold still protected from carried-over keys

- **WHEN** a piece is freshly spawned and held, and a carried-over (key-repeat) soft-drop arrives
- **THEN** the new piece is not fast-fallen and the hold is not broken by the carried-over key
