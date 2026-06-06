import { GRID_COLS, GRID_ROWS } from "./constants";
import type { Cell, GameState, Grid } from "./types";

/** Lock the active piece into the grid. */
export function lockPiece(state: GameState): void {
  const piece = state.activePiece;
  if (!piece) return;

  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const gr = piece.row + r;
      const gc = piece.col + c;
      if (gr >= 0 && gr < GRID_ROWS && gc >= 0 && gc < GRID_COLS) {
        state.grid[gr]![gc] = piece.cells[r]![c]!;
      }
    }
  }
  state.activePiece = null;
}

/**
 * Scan the grid for all aligned 2×2 monochrome squares.
 * Returns the set of cell keys ("row,col") that should be marked,
 * and the count of distinct squares (by top-left corner).
 */
export function scanSquares(grid: Grid): {
  markedKeys: Set<string>;
  distinctCount: number;
} {
  const markedKeys = new Set<string>();
  let distinctCount = 0;

  for (let r = 0; r < GRID_ROWS - 1; r++) {
    for (let c = 0; c < GRID_COLS - 1; c++) {
      const tl = grid[r]![c];
      if (tl === null) continue;
      const tr = grid[r]![c + 1];
      const bl = grid[r + 1]![c];
      const br = grid[r + 1]![c + 1];
      if (tl === tr && tl === bl && tl === br) {
        distinctCount++;
        markedKeys.add(`${r},${c}`);
        markedKeys.add(`${r},${c + 1}`);
        markedKeys.add(`${r + 1},${c}`);
        markedKeys.add(`${r + 1},${c + 1}`);
      }
    }
  }

  return { markedKeys, distinctCount };
}

/**
 * Apply gravity to a single column: drop all cells down to fill gaps.
 * Returns true if anything moved.
 */
export function applyGravityColumn(grid: Grid, col: number): boolean {
  let moved = false;
  let writeRow = GRID_ROWS - 1;

  for (let readRow = GRID_ROWS - 1; readRow >= 0; readRow--) {
    if (grid[readRow]![col] !== null) {
      if (readRow !== writeRow) {
        grid[writeRow]![col] = grid[readRow]![col]!;
        grid[readRow]![col] = null;
        moved = true;
      }
      writeRow--;
    }
  }

  return moved;
}

/**
 * Apply gravity to all columns.
 * Returns set of columns that had cells move.
 */
export function applyGravityAll(grid: Grid): Set<number> {
  const movedCols = new Set<number>();
  for (let c = 0; c < GRID_COLS; c++) {
    if (applyGravityColumn(grid, c)) {
      movedCols.add(c);
    }
  }
  return movedCols;
}

/**
 * Get the full grid state including the active piece overlaid.
 * Used for test API state() and rendering.
 */
export function getFullGrid(state: GameState): Grid {
  const result: Grid = state.grid.map((row) => [...row]);
  const piece = state.activePiece;
  if (piece) {
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const gr = piece.row + r;
        const gc = piece.col + c;
        if (gr >= 0 && gr < GRID_ROWS && gc >= 0 && gc < GRID_COLS) {
          result[gr]![gc] = piece.cells[r]![c] as Cell;
        }
      }
    }
  }
  return result;
}

/**
 * Mark cells after a piece locks. Scans for monochrome squares
 * and adds to the marked set (preserving existing marks).
 * Returns the scan result { markedKeys, distinctCount }.
 */
export function markSquares(state: GameState): {
  markedKeys: Set<string>;
  distinctCount: number;
} {
  const result = scanSquares(state.grid);
  for (const key of result.markedKeys) {
    state.markedCells.add(key);
  }
  return result;
}

/**
 * Get distinct square count for cells that are currently marked.
 * Only counts squares where ALL 4 cells are marked.
 */
export function countDistinctSquaresInMarked(
  grid: Grid,
  markedCells: Set<string>,
): number {
  let count = 0;
  for (let r = 0; r < GRID_ROWS - 1; r++) {
    for (let c = 0; c < GRID_COLS - 1; c++) {
      const tl = grid[r]![c];
      if (tl === null) continue;
      const tr = grid[r]![c + 1];
      const bl = grid[r + 1]![c];
      const br = grid[r + 1]![c + 1];
      if (tl === tr && tl === bl && tl === br) {
        // Check all 4 are marked
        if (
          markedCells.has(`${r},${c}`) &&
          markedCells.has(`${r},${c + 1}`) &&
          markedCells.has(`${r + 1},${c}`) &&
          markedCells.has(`${r + 1},${c + 1}`)
        ) {
          count++;
        }
      }
    }
  }
  return count;
}
