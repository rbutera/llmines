## ADDED Requirements

### Requirement: Next-piece preview renders as flat 2D squares

The next-piece preview SHALL render upcoming pieces as FLAT 2D squares — no per-column shear and no 3D tilt — distinct from the board, which renders sheared 2.5D cubes. The preview SHALL keep the same bright/dark colour mapping as the board so colours read identically.

#### Scenario: Preview applies no shear

- **WHEN** a preview piece is rendered
- **THEN** the shear factor applied to its cells is 0 regardless of column (unlike board cells, which shear by column)

#### Scenario: Preview preserves colour identity

- **WHEN** a preview piece contains bright (colour A) and dark (colour B) cells
- **THEN** the preview shows them with the same bright/dark mapping the board uses
