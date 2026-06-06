import { COLS, ROWS } from "./constants";
import { seedState } from "./rng";
import type { ActivePiece, Cell, GameState, Grid } from "./types";

/** Build an empty ROWS x COLS grid of nulls. */
export function emptyGrid(): Grid {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => null as Cell),
  );
}

/** Deep-clone a grid (rows are new arrays). */
export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

/** Fresh game: empty grid, no active piece, score 0, not over, sweep at 0. */
export function createGame(seed = 1): GameState {
  return {
    grid: emptyGrid(),
    active: null,
    score: 0,
    gameOver: false,
    sweepX: 0,
    rngState: seedState(seed),
  };
}

/** True if (row, col) is within the grid bounds. */
export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

/** True if a settled cell occupies (row, col). Out-of-bounds counts occupied. */
export function isOccupied(grid: Grid, row: number, col: number): boolean {
  if (row < 0 || col < 0 || col >= COLS) return true;
  if (row >= ROWS) return true;
  return grid[row]![col] !== null;
}

/** Absolute cell coordinates covered by an active piece. */
export function pieceCells(
  active: ActivePiece,
): { row: number; col: number; color: Cell }[] {
  const { cells, pos } = active;
  return [
    { row: pos.row, col: pos.col, color: cells[0][0] },
    { row: pos.row, col: pos.col + 1, color: cells[0][1] },
    { row: pos.row + 1, col: pos.col, color: cells[1][0] },
    { row: pos.row + 1, col: pos.col + 1, color: cells[1][1] },
  ];
}

/**
 * Composite the active falling piece onto a copy of the settled grid so that
 * `state().grid` reflects reality (settled stack + active piece). Read-only.
 */
export function viewGrid(state: GameState): Grid {
  const grid = cloneGrid(state.grid);
  if (state.active) {
    for (const { row, col, color } of pieceCells(state.active)) {
      if (inBounds(row, col)) grid[row]![col] = color;
    }
  }
  return grid;
}

/**
 * Per-column gravity: every settled cell falls straight down until it rests on
 * the floor or another cell. Returns a new grid (input is not mutated).
 */
export function settle(grid: Grid): Grid {
  const out = emptyGrid();
  for (let col = 0; col < COLS; col++) {
    settleColumnInto(grid, out, col);
  }
  return out;
}

/** Settle one column of `src` into `dst` (per-column gravity). Helper for both. */
function settleColumnInto(src: Grid, dst: Grid, col: number): void {
  let writeRow = ROWS - 1;
  for (let row = ROWS - 1; row >= 0; row--) {
    const cell = src[row]![col] ?? null;
    if (cell !== null) {
      dst[writeRow]![col] = cell;
      writeRow--;
    }
  }
  // Clear any cells above the new top (in case dst already held this column).
  for (; writeRow >= 0; writeRow--) dst[writeRow]![col] = null;
}

/**
 * Per-column gravity for a SINGLE column, mutating `grid` in place. Cells in
 * `col` fall straight down to rest on the floor or another cell; other columns
 * are untouched. Used by the incremental per-column sweep settle so a stack
 * above a swept column falls the instant the bar clears that column, rather than
 * waiting for a batch settle at pass end.
 */
export function settleColumn(grid: Grid, col: number): void {
  // Collect the column's occupied cells top-to-bottom, then re-lay them from the
  // floor up. Mutates in place so callers working on a cloned grid stay cheap.
  const stack: Cell[] = [];
  for (let row = 0; row < ROWS; row++) {
    const cell = grid[row]![col] ?? null;
    if (cell !== null) stack.push(cell);
  }
  let row = ROWS - 1;
  for (let i = stack.length - 1; i >= 0; i--) {
    grid[row]![col] = stack[i]!;
    row--;
  }
  for (; row >= 0; row--) grid[row]![col] = null;
}
