import { GRID_COLS, GRID_ROWS } from "./constants";
import type { Cell, GameState, Grid } from "./types";

/** Create an empty grid (10 rows × 16 cols, all null). */
export function createEmptyGrid(): Grid {
  const grid: Grid = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    const row: Cell[] = new Array<Cell>(GRID_COLS).fill(null);
    grid.push(row);
  }
  return grid;
}

/** Create the initial game state. */
export function createInitialState(): GameState {
  return {
    grid: createEmptyGrid(),
    activePiece: null,
    markedCells: new Set(),
    score: 0,
    sweepX: 0,
    gameOver: false,
    sweepCellsDeleted: 0,
    sweepSquaresCleared: 0,
    lastSweepColumn: -1,
  };
}
