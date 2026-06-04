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
    let writeRow = ROWS - 1;
    for (let row = ROWS - 1; row >= 0; row--) {
      const cell = grid[row]![col] ?? null;
      if (cell !== null) {
        out[writeRow]![col] = cell;
        writeRow--;
      }
    }
  }
  return out;
}
