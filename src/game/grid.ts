import { COLS, ROWS } from "./constants";
import type { CellCoord, Grid } from "./types";

/** A fresh empty grid (16 cols x 10 rows), all cells null. */
export function createGrid(): Grid {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => null),
  );
}

/** Deep copy of a grid. */
export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

/** True if (row, col) is inside the grid bounds. */
export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

/**
 * Apply per-column gravity in place: within each column, every non-null cell
 * falls straight down to rest on the floor or on the cell beneath it, preserving
 * vertical order. Used after a piece locks and after a sweep deletes cells.
 */
export function applyGravity(grid: Grid): void {
  for (let col = 0; col < COLS; col++) {
    // Collect the colours in this column, top-to-bottom.
    const stack: Grid[number] = [];
    for (let row = 0; row < ROWS; row++) {
      const v = grid[row]![col]!;
      if (v !== null) stack.push(v);
    }
    // Re-lay them at the bottom of the column.
    const empty = ROWS - stack.length;
    for (let row = 0; row < ROWS; row++) {
      grid[row]![col] = row < empty ? null : stack[row - empty]!;
    }
  }
}

/**
 * Top-left corners of every aligned, monochrome 2x2 in the grid. The number of
 * these is the `distinct_squares` multiplier from the pinned scoring rule:
 * a 2x3 region yields 2, a 3x3 region yields 4.
 */
export function squareTopLefts(grid: Grid): CellCoord[] {
  const corners: CellCoord[] = [];
  for (let row = 0; row < ROWS - 1; row++) {
    for (let col = 0; col < COLS - 1; col++) {
      const v = grid[row]![col]!;
      if (
        v !== null &&
        grid[row]![col + 1] === v &&
        grid[row + 1]![col] === v &&
        grid[row + 1]![col + 1] === v
      ) {
        corners.push({ row, col });
      }
    }
  }
  return corners;
}

/**
 * Boolean mask of cells that belong to at least one monochrome 2x2, i.e. the
 * cells "marked" for deletion by the timeline sweep.
 */
export function markedMask(grid: Grid): boolean[][] {
  const mask = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => false),
  );
  for (const { row, col } of squareTopLefts(grid)) {
    mask[row]![col] = true;
    mask[row]![col + 1] = true;
    mask[row + 1]![col] = true;
    mask[row + 1]![col + 1] = true;
  }
  return mask;
}

/** Flat list of all currently marked cells. */
export function markedCells(grid: Grid): CellCoord[] {
  const mask = markedMask(grid);
  const cells: CellCoord[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (mask[row]![col]) cells.push({ row, col });
    }
  }
  return cells;
}
