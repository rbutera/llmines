import { COLS, ROWS, type Cell, type Grid } from "../core";

/**
 * Render-agnostic board diff helpers.
 *
 * As of the Phase-1 render-layer swap (PixiJS 2D -> Three.js / R3F 2.5D), the
 * immediate-mode `PixiRenderer` class that used to live here has been removed —
 * the 3D scene lives in `src/game/render3d/**`. What REMAINS here are the PURE,
 * renderer-independent diff helpers (`clearedCellCount`, `computeCollapseOffsets`)
 * that compute board-change facts from successive RenderState grids. They have no
 * Pixi / Three / DOM dependency and are consumed by tests today (and are
 * available to the 3D renderer for collapse/clear animation later). The board
 * dimensions are kept derived from the shared COLS/ROWS constants so the
 * playfield-grid guard (`renderer.guard.test.ts`) stays meaningful.
 */

const CELL = 40;
export const BOARD_W = COLS * CELL; // 640
export const BOARD_H = ROWS * CELL; // 400

/** Count of non-null (occupied) cells in the settled grid. */
function occupiedCount(grid: Grid): number {
  let n = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if ((grid[row]![col] ?? null) !== null) n++;
    }
  }
  return n;
}

/**
 * Number of settled cells removed between two frames. Settle never changes the
 * occupied count and a lock only ADDS cells, so a net drop in occupied cells is
 * exactly a square-clear (sweep deletion / chain flood) this frame. Pure;
 * exported so the burst-gating decision is unit-testable without a renderer.
 */
export function clearedCellCount(prevGrid: Grid, newGrid: Grid): number {
  return Math.max(0, occupiedCount(prevGrid) - occupiedCount(newGrid));
}

/** Per-column occupied rows, bottom-to-top, with colours. */
function columnStack(grid: Grid, col: number): { row: number; cell: Cell }[] {
  const out: { row: number; cell: Cell }[] = [];
  for (let row = ROWS - 1; row >= 0; row--) {
    const c = grid[row]![col] ?? null;
    if (c !== null) out.push({ row, cell: c });
  }
  return out;
}

/**
 * Pure collapse diff: match each column's new stack to its old stack (top-down,
 * pairing each surviving cell to the next old cell of the SAME colour — the new
 * stack is a colour-ordered subsequence of the old one) and, for any cell that
 * ended LOWER than it started, return a starting pixel offset (negative = above
 * its rest position) so the renderer can ease it down. This animates an
 * incremental per-column settle: the bar clearing a column emits a new
 * RenderState whose column lost cells, so the stack above falls and is tweened
 * here — no special-casing for the deferred-gravity fix. Keyed by
 * `row * COLS + col`. Exported for testing.
 */
export function computeCollapseOffsets(
  oldGrid: Grid,
  newGrid: Grid,
  cell = CELL,
): Map<number, number> {
  const offsets = new Map<number, number>();
  for (let col = 0; col < COLS; col++) {
    const oldStack = columnStack(oldGrid, col).reverse(); // now top-down
    const newStack = columnStack(newGrid, col).reverse(); // now top-down
    let oi = 0;
    for (const nu of newStack) {
      while (oi < oldStack.length && oldStack[oi]!.cell !== nu.cell) oi++;
      if (oi >= oldStack.length) break; // no further match (defensive)
      const oldRow = oldStack[oi]!.row;
      oi++;
      if (nu.row > oldRow) {
        offsets.set(nu.row * COLS + col, (oldRow - nu.row) * cell);
      }
    }
  }
  return offsets;
}
