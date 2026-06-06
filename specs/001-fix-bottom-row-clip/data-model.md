# Phase 1 Data Model: Fix Bottom-Row Clip/Delay

This bug fix introduces **no new entities and no schema changes**. It adjusts the
derivation of one existing render field. The relevant existing structures are documented
here for clarity.

## Existing structures (unchanged shape)

### `RenderState` (`src/game/engine/controller.ts`)

Per-frame snapshot consumed by the renderer and HUD.

| Field | Type | Meaning | Affected? |
|-------|------|---------|-----------|
| `grid` | `Cell[][]` (ROWS×COLS) | Settled stack only | No |
| `active` | `ActivePiece \| null` | Falling 2×2 piece (logical position) | No |
| `fallProgress` | `number` (0..1) | Fractional descent toward the next gravity row, used for smooth interpolation | **Derivation changed** |
| `score` | `number` | Current score | No |
| `gameOver` | `boolean` | Game-over flag | No |
| `sweepX` | `number` | Sweep-bar column position | No |
| `marked` | `MarkedCell[]` | Cells marked for clearing | No |

### `fallProgress` — semantics change

- **Type/range**: unchanged — `number` in `[0, 1]`.
- **Before**: `testMode ? 0 : clamp(gravityAccumMs / GRAVITY_INTERVAL_MS, 0, 1)` — accrues
  toward 1 even when the active piece cannot descend, causing the renderer to draw it
  below its resting row (and below the canvas on the bottom row).
- **After**: additionally `0` when the active piece **is resting** (`isResting(state)`).
  A grounded piece reports `fallProgress = 0` and is drawn exactly at its logical row.

  Invariant introduced: **a resting active piece has `fallProgress === 0`**, therefore the
  active piece is never rendered below its logical (in-bounds) row.

## Grid bounds invariants (already enforced — relied upon, not changed)

- `canPlace` rejects any piece position with `row >= ROWS` (`piece.ts`), so the logical
  active piece is always within bounds.
- `settle` writes cells only into rows `0..ROWS-1` (`grid.ts`), so the settled grid never
  holds out-of-bounds cells.
- Consequence: `window.__lumines.state().grid` already satisfies "no out-of-bounds cells"
  (FR-003); the fix preserves this and ensures the *rendered* piece matches it.

## State transitions (unchanged)

Falling → (gravity tick, can descend) → Falling at next row
Falling → (gravity tick, cannot descend) → Locked (merged + `settle`) → next spawn
Falling → (hard drop) → Locked immediately

The fix changes only how the **Falling-but-resting** moment is *rendered*
(`fallProgress = 0`); it does not alter any transition, timing, or lock semantics.
