## ADDED Requirements

### Requirement: Clears play the clear-stage sound

A `lineClear` event SHALL fire the `stage` one-shot in addition to feeding clear-progress;
clears MUST no longer be silent. The `stage` velocity SHALL scale with the clear size
(a bigger clear sounds hotter). A `chain` event SHALL also play an audibly distinct
clear sound (a hotter and/or layered hit) so a chain is recognisably bigger than a plain
clear.

#### Scenario: A clear is audible

- **WHEN** a `lineClear` event is routed
- **THEN** the `stage` one-shot plays AND clear-progress is fed (both the sound and the
  progression happen)

#### Scenario: A bigger clear is louder

- **WHEN** a `lineClear` with a larger `squares` count is routed
- **THEN** the `stage` one-shot plays at a higher velocity than a single-square clear

#### Scenario: A chain is distinct from a plain clear

- **WHEN** a `chain` event is routed
- **THEN** it plays a sound that is audibly distinct from (hotter or fuller than) a plain
  `lineClear`

### Requirement: Every settle plays a lock sound scaled by cause

A `lock` event SHALL play the `drop` one-shot for every settle (gravity, soft, and hard),
with velocity scaled by the settle cause so a hard drop hits hardest and a gravity/soft
lock is softer. Locks MUST no longer be audible only on hard drops.

#### Scenario: A gravity lock thuds

- **WHEN** a `lock` event with `cause = "gravity"` is routed
- **THEN** the `drop` one-shot plays at a reduced velocity

#### Scenario: A hard drop hits hardest

- **WHEN** a `lock` event with `cause = "hard"` is routed
- **THEN** the `drop` one-shot plays at a higher velocity than a gravity or soft lock

### Requirement: Move is silent by decision; rotate and soft-drop keep their sounds

The `move` action SHALL remain unrouted (silent) by explicit decision. `rotate` SHALL play
the `rotate` one-shot and `softDrop` SHALL play the `softdrop` one-shot. The action SFX
name set SHALL match the manifest keys one-to-one (`move`, `rotate`, `softdrop`, `drop`,
`stage`), removing the prior hard-drop name mismatch.

#### Scenario: Move fires no sound

- **WHEN** a `move` event is routed
- **THEN** no one-shot plays

#### Scenario: Rotate and soft-drop play their mapped sounds

- **WHEN** a `rotate` event then a `softDrop` event are routed
- **THEN** the `rotate` one-shot plays for the first and the `softdrop` one-shot for the
  second

### Requirement: Per-segment SFX palettes with song-level fallback

The manifest schema SHALL support an optional per-segment `sfx` map (same shape as the
song-level `sfx`). The engine SHALL resolve each action sound for the ACTIVE segment from
that segment's `sfx` entry when present, otherwise from the song-level `sfx`, otherwise
silence. A manifest with no per-segment `sfx` SHALL behave exactly as the song-level
mapping (no behaviour change without new assets).

#### Scenario: A segment with its own palette uses it

- **WHEN** the active segment carries its own `sfx.stage` and a clear fires
- **THEN** the engine plays that segment's `stage` sample, not the song-level one

#### Scenario: A segment without a palette falls back to the song level

- **WHEN** the active segment has no `sfx` entry and an action fires
- **THEN** the engine plays the song-level sample for that action

#### Scenario: An old manifest is unaffected

- **WHEN** a manifest has no per-segment `sfx` on any segment
- **THEN** all action sounds resolve to the song-level set exactly as before

### Requirement: The SFX pool is hot-swapped per segment

The engine SHALL load (prefetch) the entering segment's SFX pool when it enters a segment,
and SHALL dispose a left-behind segment's SFX voices when that segment is disposed after an
advance, mirroring the per-segment tier player lifecycle. `playSfx` SHALL read the active
segment's pool. A one-shot dropped during a swap MUST never surface as an error to the game.

#### Scenario: Entering a segment prepares its sounds

- **WHEN** the engine enters a new segment
- **THEN** that segment's SFX pool is prefetched alongside its tier players

#### Scenario: Leaving a segment frees its sounds

- **WHEN** an advance completes and the left-behind segment is disposed
- **THEN** that segment's SFX voices are disposed too

#### Scenario: A swap never throws into the game

- **WHEN** an action one-shot is requested during a segment SFX pool swap
- **THEN** the request is silently dropped if no voice is available, with no error reaching
  the game
