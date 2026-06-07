# Bottom Row Clip Fix Bugfix Design

## Overview

The active falling piece is rendered with a smooth vertical interpolation offset so it
visually slides between discrete gravity rows. In `PixiRenderer.drawPiece`
(`src/game/render/renderer.ts`) this offset is computed unconditionally as
`const yOff = rs.fallProgress * CELL;` and applied to all four cells of the active piece.

When the piece is resting — its lowest cells already occupy the last legal row (the bottom
grid row, or the top of the settled stack) and it cannot descend any further — that
fractional offset still pushes the piece downward. The result is cells drawn below the
bottom grid row (outside the 400px canvas) and a visible "hang" until the next gravity tick
locks the piece into place.

The fix is targeted and minimal: in `drawPiece`, detect whether the active piece can still
descend one more row using the existing pure-core collision logic, and when it cannot,
zero the interpolation offset so the piece renders at its true grid row. Pieces that can
still fall keep the existing smooth per-column overhang interpolation untouched. No core
game logic, gravity timing, or lock behaviour changes — this is purely a rendering offset
clamp.

## Glossary

- **Bug_Condition (C)**: The active piece is resting (cannot descend another row) and a
  positive `fallProgress` offset is being applied, drawing cells below their true resting
  row / below the canvas bounds.
- **Property (P)**: When the active piece is resting, every cell SHALL render at its true
  grid row entirely within the canvas bounds, with no interpolation offset and no pre-lock
  delay.
- **Preservation**: Smooth descent interpolation for pieces that can still fall, the
  post-clear collapse animation, hard-drop placement, test-mode (`fallProgress === 0`)
  rendering, and all sweep/mark/flash/score visuals must remain unchanged.
- **`PixiRenderer.drawPiece(rs: RenderState)`**: The renderer method in
  `src/game/render/renderer.ts` that draws the active piece each frame, currently applying
  `yOff = rs.fallProgress * CELL` to all four piece cells.
- **`RenderState`**: The per-frame snapshot produced by `GameController.renderState()` in
  `src/game/engine/controller.ts`. Relevant fields: `grid` (the settled stack only — the
  active piece is drawn separately), `active` (`ActivePiece | null`), and `fallProgress`
  (a `0..1` fraction toward the next gravity row, forced to `0` in test mode).
- **`canPlace(grid, cells, pos)`**: Pure collision predicate exported from
  `src/game/core` (`piece.ts`). Returns `true` if a piece's cells fit at `pos` against the
  settled `grid` and within bounds. Used as the basis for the resting check in the renderer.
- **`isResting` / `canDescend`**: Pure-core helpers in `src/game/core/piece.ts`.
  `isResting(state)` is `state.active !== null && !canDescend(state)`; `canDescend` probes
  one row down via `canPlace`. These operate on `GameState`; the renderer only has a
  `RenderState`, so it computes the equivalent directly from `rs.grid` + `rs.active` using
  `canPlace`.
- **`CELL`**: Pixel size of one grid cell (40). Grid is `ROWS` (10) × `COLS` (16); canvas
  height is `ROWS * CELL = 400`.

## Bug Details

### Bug Condition

The bug manifests when the active piece has reached the lowest row it can legally occupy
(its bottom cells sit on the last grid row or atop the settled stack) but has not yet been
locked by a gravity tick, while `fallProgress > 0`. `drawPiece` is unconditionally adding
`rs.fallProgress * CELL` to the piece's vertical position, pushing the resting piece below
its true row — below the canvas bottom when resting on the floor — until the next gravity
tick snaps it into place.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type RenderState (with active piece present)
  OUTPUT: boolean

  IF input.active IS null THEN RETURN false

  // "resting" = cannot descend one more row against the settled grid
  nextPos := { row: input.active.pos.row + 1, col: input.active.pos.col }
  resting := NOT canPlace(input.grid, input.active.cells, nextPos)

  RETURN resting AND input.fallProgress > 0
END FUNCTION
```

### Examples

- A piece descends so its bottom cells occupy the last grid row (row 9). `fallProgress`
  ramps from 0 toward 1 before the next gravity tick. Expected: piece stays flush on row 9.
  Actual: bottom cells are drawn at `9 * CELL + fallProgress * CELL`, i.e. up to ~40px
  below the canvas, clipping out of bounds until the tick locks it.
- A piece lands atop a 3-high settled stack so its bottom cells rest on the row above the
  stack. Expected: piece renders flush on its resting row. Actual: piece overlaps downward
  into the settled cells by `fallProgress * CELL` until the lock tick.
- A piece resting on the bottom row appears to "hang and jump": it visually clips below,
  then snaps up onto row 9 only when the next gravity tick fires — a visible delay artifact.
- Edge: a piece that can still descend at least one row (mid-fall) — NOT a bug; it should
  keep interpolating smoothly.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Pieces that can still descend at least one more row must continue to interpolate smoothly
  using `fallProgress` (Requirement 3.1).
- Post-clear/collapse per-column fall offsets (`fallOffsets`) must continue easing into
  their final positions exactly as before (Requirement 3.2).
- Hard-drop must continue to place and lock at the lowest legal row, and
  `window.__lumines.state().grid` must reflect the result as today (Requirement 3.3).
- Test mode (`fallProgress === 0`) must continue to render the active piece at its exact
  grid position with no offset (Requirement 3.4).
- Sweep bar, marked-cell pulsing, clear flashes, and scoring must behave identically
  (Requirement 3.5).

**Scope:**
All inputs where the active piece can still descend (`isBugCondition` is false) must be
completely unaffected by this fix. This includes:
- Mid-fall pieces with `fallProgress > 0` that have at least one free row below them.
- Any frame where there is no active piece (`rs.active === null`).
- Test-mode frames where `fallProgress` is already `0`.
- All settled-cell, sweep, mark, flash, and score rendering paths, which do not consult the
  active-piece offset at all.

## Hypothesized Root Cause

Based on the bug description and confirmation in the requirements phase, the cause is
isolated and confirmed:

1. **Unconditional interpolation offset (confirmed root cause)**: In
   `PixiRenderer.drawPiece`, `const yOff = rs.fallProgress * CELL;` is applied to every
   active-piece cell with no check for whether the piece can still descend. A resting
   piece therefore receives a downward offset it should not have.

2. **Renderer lacks a resting check**: The pure core already knows when a piece cannot
   descend (`canDescend` / `isResting` in `piece.ts`, both built on `canPlace`), but
   `drawPiece` never consults this. The settled-only `rs.grid` plus `rs.active` carried in
   `RenderState` contain everything needed to compute it in the renderer.

3. **Timing assumption**: The smooth-descent model assumes there is always "a next row" to
   ease toward. At the resting position there is no next row, so the offset is meaningless
   and visually wrong; it is only corrected when the gravity tick locks the piece.

## Correctness Properties

Property 1: Bug Condition - Resting Piece Renders At True Row

_For any_ `RenderState` where the bug condition holds (`isBugCondition` returns true — the
active piece is present and cannot descend another row while `fallProgress > 0`), the fixed
`drawPiece` SHALL render all four piece cells with zero vertical interpolation offset, so
every cell sits entirely within the canvas bounds on its true grid row with no cells below
the bottom row and no pre-lock delay. The settled grid exposed via
`window.__lumines.state().grid` SHALL reflect landed blocks on the correct rows with no
out-of-bounds cells.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Non-Resting And Non-Active Rendering Unchanged

_For any_ `RenderState` where the bug condition does NOT hold (`isBugCondition` returns
false — no active piece, the active piece can still descend at least one row, or
`fallProgress === 0`), the fixed `drawPiece` SHALL produce exactly the same vertical offset
and output as the original code, preserving smooth descent interpolation, collapse
animation, hard-drop placement, test-mode rendering, and all sweep/mark/flash/score visuals.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct (and it was confirmed in the requirements
phase):

**File**: `src/game/render/renderer.ts`

**Function**: `PixiRenderer.drawPiece(rs: RenderState)`

**Specific Changes**:
1. **Import the collision predicate**: Add `canPlace` to the existing import from
   `"../core"` (alongside `COLS`, `ROWS`, `Cell`, `Grid`).

2. **Compute a resting check before applying the offset**: After the early `if (!rs.active)
   return;` guard, determine whether the active piece can descend one more row:
   ```
   const { cells, pos } = rs.active;
   const canDescend = canPlace(rs.grid, cells, { row: pos.row + 1, col: pos.col });
   ```
   `rs.grid` is the settled stack only (the active piece is drawn separately), which is
   exactly the grid `canPlace` expects for collision testing.

3. **Clamp/zero the interpolation offset when resting**:
   ```
   const yOff = canDescend ? rs.fallProgress * CELL : 0;
   ```
   When the piece can still fall, behaviour is identical to today. When it is resting, the
   offset is zeroed so the piece draws on its true grid row.

4. **Leave the cell-mapping and draw loop unchanged**: The existing `map` of four
   `[row, col, color]` tuples and the `this.cellRect(...)` calls stay exactly as they are;
   only the `yOff` value feeding them changes.

5. **No core changes**: `piece.ts`, `controller.ts`, gravity timing, lock/spawn behaviour,
   and `RenderState` shape are untouched. The fix lives entirely in the renderer's
   per-frame draw of the active piece.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that
demonstrate the bug on the unfixed renderer, then verify the fix renders resting pieces at
their true row and preserves every other behaviour. Because the visual offset lives in
Pixi draw calls, the most reliable observable signals are (a) the computed `yOff` for the
active piece given a `RenderState`, and (b) the public game state and DOM bounds exposed via
`window.__lumines.state()` in the existing Playwright e2e harness.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix.
Confirm (or refute) that the unconditional `yOff = fallProgress * CELL` pushes resting
pieces below their true row. If refuted, re-hypothesize.

**Test Plan**: Drive a `RenderState` in which the active piece is resting (bottom row or on
the stack) with `fallProgress > 0`, and assert the offset applied to the piece is non-zero
on the unfixed code (the counterexample), then 0 after the fix. Complement with an e2e check
that no active-piece cell is rendered below the canvas bottom while resting.

**Test Cases**:
1. **Bottom-row rest**: Active piece whose bottom cells occupy row 9, `fallProgress = 0.5`
   — unfixed code applies `yOff = 20`, drawing cells below the 400px canvas (will fail on
   unfixed code).
2. **Stack-top rest**: Active piece resting on top of a settled stack, `fallProgress = 0.5`
   — unfixed code overlaps the piece downward into settled cells (will fail on unfixed code).
3. **Pre-lock delay**: Resting piece with rising `fallProgress` shows a downward clip that
   only corrects on the next gravity tick (will fail on unfixed code).
4. **Out-of-range / floor edge**: Piece resting on row 9 with `fallProgress` near 1 — bottom
   cells drawn ~40px below the canvas (may fail on unfixed code).

**Expected Counterexamples**:
- A resting active piece receives `yOff = fallProgress * CELL > 0`, placing cells below their
  true row / below the canvas bottom.
- Cause: `drawPiece` applies the interpolation offset without checking `canPlace` for the
  row below.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed `drawPiece`
produces the expected behavior (zero offset, in-bounds rendering, immediate settle).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  yOff := computeActivePieceYOffset(input)   // fixed drawPiece logic
  ASSERT yOff = 0
  ASSERT every active cell row*CELL + yOff + CELL <= BOARD_H   // no cell below canvas
  ASSERT every active cell stays within [0, BOARD_H]
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed
`drawPiece` produces the same vertical offset as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT computeActivePieceYOffset_original(input) = computeActivePieceYOffset_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking
because:
- It generates many `RenderState` inputs automatically across the input domain (varied
  grids, active positions, and `fallProgress` values).
- It catches edge cases manual unit tests might miss (pieces one row above the floor,
  partially filled columns, `fallProgress` boundaries 0 and 1).
- It provides strong guarantees that the offset is unchanged for every non-resting and
  non-active input.

**Test Plan**: Capture the original `yOff` behaviour (offset = `fallProgress * CELL` for
non-resting pieces, and the early-return for `rs.active === null`) on the unfixed code, then
write property-based tests asserting the fixed code matches it for all `NOT isBugCondition`
inputs.

**Test Cases**:
1. **Mid-fall interpolation preserved**: For pieces with a free row below, observe `yOff =
   fallProgress * CELL` on unfixed code, then verify it is unchanged after the fix.
2. **Test-mode preserved**: With `fallProgress === 0`, verify `yOff === 0` before and after
   the fix (no behavioural change in deterministic test mode).
3. **No-active-piece preserved**: With `rs.active === null`, verify `drawPiece` draws nothing
   both before and after the fix.
4. **Collapse / hard-drop / sweep unaffected**: Verify the settled-cell collapse animation,
   hard-drop final grid (`window.__lumines.state().grid`), and sweep/mark/flash/score
   visuals are identical, since none of these consult the active-piece offset.

### Unit Tests

- A helper that mirrors `drawPiece`'s offset decision (e.g. `computeActivePieceYOffset(rs)`)
  returns `0` when the active piece is resting on the bottom row.
- The same helper returns `0` when the active piece is resting atop a settled stack.
- The helper returns `fallProgress * CELL` when the active piece has a free row below it.
- The helper returns `0` when `fallProgress === 0` (test mode), regardless of resting state.
- Resting detection via `canPlace(rs.grid, cells, {row+1, col})` correctly handles the
  floor (row 9) and stack-top boundaries.

### Property-Based Tests

- Generate random settled grids, active piece positions, and `fallProgress` values; for every
  generated `RenderState` where `isBugCondition` holds, assert the computed offset is `0` and
  all active cells stay within `[0, BOARD_H]` (Property 1).
- For every generated `RenderState` where `isBugCondition` does NOT hold, assert the fixed
  offset equals the original `fallProgress * CELL` (or the no-active no-op), preserving
  behaviour (Property 2).
- Generate `fallProgress` across the full `0..1` range including boundaries to confirm no
  off-by-one at the lock threshold.

### Integration Tests

- Playwright e2e (extending `e2e/lumines.spec.ts`): spawn a piece, soft/gravity-drop it to
  the floor, and assert via `window.__lumines.state().grid` that the landed block occupies
  the correct bottom rows with no out-of-bounds cells.
- Drive a piece to rest on the bottom row and confirm there is no frame where the active
  piece renders below the canvas bounds (no clip) and no visible pre-lock delay.
- Verify a full flow with a settled stack: land a piece atop the stack and confirm it settles
  flush, then continue play (sweep, clear, collapse) to confirm downstream visuals are intact.
