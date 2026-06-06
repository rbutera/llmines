# Phase 0 Research: Fix Bottom-Row Clip/Delay

No open `NEEDS CLARIFICATION` items remained from the spec. Research here is a root-cause
investigation of the existing brownfield code, not a technology evaluation.

## Root cause

**Decision**: The artifact is caused by the active piece's smooth descent interpolation
overshooting its resting position.

- `GameController.renderState()` (`src/game/engine/controller.ts:197-210`) returns
  `fallProgress = clamp(gravityAccumMs / GRAVITY_INTERVAL_MS, 0, 1)` in production.
- `PixiRenderer.drawPiece()` (`src/game/render/renderer.ts:259-274`) draws each active
  cell at `y = row * CELL + fallProgress * CELL`, i.e. up to one full cell *below* the
  logical row, anticipating the next gravity step.
- When the piece is **resting** (cannot descend), `gravityAccumMs` keeps accumulating
  toward the next tick, so `fallProgress` rises toward 1 while the logical row stays
  put. For a piece on the bottom row this draws cells past `BOARD_H` (the canvas floor)
  — they clip outside the playfield.
- On the next gravity tick, `gravityStep` locks the piece, resets `gravityAccumMs = 0`,
  and the now-settled cells render at the true row → the piece "snaps" back up. The
  interval between visual overshoot and the lock tick is the perceived **delay/clip**.

**Rationale**: Confirmed by reading the three collaborating files. The logical model is
already bounds-safe — `canPlace` rejects `row >= grid.length` (`piece.ts:22-31`) and
`settle` writes only within `ROWS` (`grid.ts:72-85`) — so `state().grid` never contains
out-of-bounds cells. The defect is therefore purely in the render offset, which explains
why it is a *visual* clip rather than a state corruption.

**Alternatives considered**:
- *Clamp inside `drawPiece` (renderer)*: rejected — the renderer would need game logic
  (whether the piece can descend) it does not currently own; the controller already
  derives render state and has `isResting`.
- *Lock the piece immediately on rest instead of waiting a tick*: rejected for this fix —
  changes gravity/lock timing and lock-delay feel, risking regressions to scoring/sweep
  cadence; out of scope for a minimal render fix.

## Chosen fix

**Decision**: In `renderState()`, force `fallProgress = 0` when `isResting(state)` is
true (in addition to the existing `testMode ? 0` branch). A resting piece is then drawn
exactly at its logical row — always within bounds — and locks with no positional snap.

**Rationale**: One-line, localized, uses the already-exported `isResting` predicate
(`piece.ts:145`, re-exported via `core/index.ts`). Active-piece descent interpolation
for *non-resting* pieces is unchanged, so normal falling stays smooth.

**Alternatives considered**: Capping the offset by the distance-to-rest in pixels (so a
piece interpolates only as far as it can legally fall). Rejected as unnecessary: a piece
is either able to descend a full row (offset valid) or resting (offset must be 0); there
is no partial-row legal descent in this fixed-grid model.

## No-regression analysis (per-column overhang settle)

**Decision**: The fix does not touch the overhang **settle** polish.

**Rationale**: The "smooth per-column overhang settle" is the *settled-cell* collapse
animation — `seedCollapse` builds per-column `fallOffsets` from old→new grid diffs
(`renderer.ts:127-143`) and `frame()` eases them to 0 (`renderer.ts:168-174`). That path
is driven by grid changes (locks/clears/gravity in `settle`), entirely separate from the
active piece's `fallProgress`. Changing `fallProgress` leaves `fallOffsets` and
`seedCollapse` untouched.

## Verification strategy

- **Logical (existing test API)**: `window.__lumines.state().grid` already reflects only
  in-bounds cells. A Playwright case will hard-drop / tick a piece to the bottom row and
  assert the landed cells occupy the correct bottom rows with no out-of-bounds entries —
  guarding FR-003 / SC-001 / SC-003.
- **Render offset (unit)**: A Vitest test on `GameController.getRenderState()` will assert
  `fallProgress === 0` when the active piece is resting on the floor, and `> 0`/normal
  while a piece is mid-fall — directly guarding the clip fix (FR-001/FR-002) without
  needing pixel inspection.
- **Regression**: Full existing Vitest + Playwright suites must remain green (FR-004/FR-005).
