## ADDED Requirements

### Requirement: Next-3 preview queue

The system SHALL maintain a pre-generated queue of upcoming pieces deep enough to display the **next 3 pieces** in order. The UI SHALL display this 3-piece preview. Spawning SHALL take the head of the queue and refill it, replacing the prior draw-one-on-spawn behaviour.

#### Scenario: Three upcoming pieces are previewable

- **WHEN** a game is in progress and `window.__lumines.state()` (or the preview UI) is read
- **THEN** at least the next 3 upcoming pieces are available in order

#### Scenario: Spawning consumes the queue head and refills

- **WHEN** a piece spawns
- **THEN** it is the former head of the queue
- **AND** the queue is refilled so it still shows the next 3

### Requirement: Queue draws preserve seeded reproducibility

The queue SHALL draw pieces in the single canonical RNG order (4 colour bits, then the special roll, then if special a cell-index pick) so that a seeded run is identical with or without the preview existing. Two runs with the same seed SHALL produce identical queues.

#### Scenario: Same seed, identical queue

- **WHEN** two runs use the same seed
- **THEN** their preview queues are identical piece-for-piece

#### Scenario: Preview does not alter the seeded sequence

- **WHEN** the same seed is run with the preview/queue enabled versus a single-draw baseline that draws in the same canonical order
- **THEN** the sequence of spawned pieces is identical

### Requirement: Queue surfaces upcoming specials

When a queued piece carries a chain special (decided at generation time), the preview SHALL reflect that the upcoming piece carries a special.

#### Scenario: Upcoming special visible in preview

- **WHEN** a piece carrying a chain special is in the preview queue
- **THEN** the preview indicates that an upcoming piece carries a special before it spawns
