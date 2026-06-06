## ADDED Requirements

### Requirement: Seedable chain special block generation

The generator SHALL occasionally emit a **chain special block** at a target rate of approximately **1 per 30 pieces** (configurable). The special SHALL be decided at piece-generation time (so it can appear in the preview) using a single deterministic draw off the one in-state RNG, in the canonical per-piece draw order: 4 colour bits, then 1 special roll, then (if special) 1 cell-index pick. No second RNG SHALL be introduced.

#### Scenario: Special rate is reproducible for a seed

- **WHEN** a long seeded run is generated
- **THEN** chain specials appear at approximately the configured rate (~1/30)
- **AND** the same seed produces specials at the same piece indices on every run

#### Scenario: Special decided at generation, visible in preview

- **WHEN** a piece carrying a chain special is generated into the preview queue
- **THEN** the preview reflects that an upcoming piece carries a special, before it spawns

#### Scenario: Single RNG stream, canonical order

- **WHEN** pieces are generated with specials enabled versus disabled from the same seed
- **THEN** the colour draws follow the identical canonical order, so the cell colours match position-for-position where the special roll does not consume colour bits

### Requirement: Chain activation requires a completed square

A chain cell SHALL activate only when it is part of a completed 2x2 square that the sweep clears (PSP-faithful must-be-in-square precondition). A chain cell that is not inside a cleared square SHALL NOT trigger a flood-fill clear.

#### Scenario: Chain in a cleared square activates

- **WHEN** a chain cell is one of the cells of a mono 2x2 square that the sweep clears this pass
- **THEN** the chain activates and triggers a flood-fill clear

#### Scenario: Chain outside a square does not activate

- **WHEN** a chain cell is on the board but not part of any cleared square
- **THEN** no flood-fill clear occurs for it

### Requirement: Flood-fill clear shares the deterministic delete/score step

When an activated chain cell is part of a cleared square, the same clear step SHALL also remove **every same-colour cell orthogonally (4-) connected** to the chain cell. The flood MAY reach cells in columns ahead of the bar; those cells SHALL be removed in the same step. Multiple chain cells in one connected region SHALL resolve as a single flood fill (shared visited set, no double processing). Flooded-in cells beyond the triggering square SHALL be removed but SHALL NOT add to `squares_in_pass` (they score nothing). The settle (per-column, from the sweep capability) SHALL run on the post-flood grid.

#### Scenario: Connected same-colour region clears

- **WHEN** a chain cell of colour X activates inside a cleared square and a chain of same-colour X cells is orthogonally connected to it
- **THEN** the entire connected same-colour region is removed in the same clear step

#### Scenario: Flood reaches ahead of the bar

- **WHEN** the connected region extends into columns the bar has not yet reached this pass
- **THEN** those cells are removed immediately as part of the chain clear

#### Scenario: Flooded extras score nothing

- **WHEN** a chain flood removes cells beyond the triggering square
- **THEN** `squares_in_pass` (and therefore the combo) counts only the snapshot squares, not the flooded extras

#### Scenario: Two chain cells in one region resolve once

- **WHEN** two chain cells lie within a single connected same-colour region that activates
- **THEN** the region is flooded exactly once (no cell processed twice)

### Requirement: Specials exposed via the test seam

The chain-cell coordinates (`specials`) SHALL be exposed on the public `window.__lumines.state()` projection so the eval can assert special placement deterministically. This addition SHALL be additive.

#### Scenario: specials readable from state

- **WHEN** a piece carrying a chain special locks into the grid and `window.__lumines.state()` is read
- **THEN** the projection includes the chain-cell coordinate(s) in `specials`
