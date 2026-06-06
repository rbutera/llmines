## ADDED Requirements

### Requirement: Fixed 16x10 playfield

The playfield SHALL be exactly **16 columns wide and 10 rows tall**. Cell size and canvas dimensions SHALL derive solely from the column and row constants; no layer SHALL hard-code a width (in particular, no layer SHALL use a literal width of 10). Board width SHALL be a fixed constant and SHALL NOT be configurable below 16, because the beat-sync math (one column per eighth-note, 16 columns = two bars) assumes 16.

#### Scenario: Grid reports 16x10

- **WHEN** a game is created and `window.__lumines.state().grid` is read
- **THEN** the grid has exactly 10 rows and each row has exactly 16 columns

#### Scenario: Canvas dimensions derive from constants

- **WHEN** the renderer computes its board width and height
- **THEN** the width equals `COLS * CELL` and the height equals `ROWS * CELL`
- **AND** no rendering or layout code uses a literal column count other than the shared constant

### Requirement: Render scale fits the container without changing the logical grid

The board SHALL be scaled to fit its display container while the logical grid stays 16x10. Scaling SHALL be a display-only concern (CSS/transform) and SHALL NOT alter the number of columns/rows, cell coordinates in `state()`, or any game logic.

#### Scenario: Scaled display preserves the logical grid

- **WHEN** the canvas is scaled to fit a smaller or larger container
- **THEN** `window.__lumines.state().grid` is still 10 rows x 16 columns with unchanged cell coordinates
