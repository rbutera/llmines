// Grid model and placement helpers for LLMines.
// This module is part of the pure game core: it imports nothing from React or PixiJS.

import { COLS, ROWS } from "~/game/constants";
import type { ActiveBlock, Color, Grid } from "~/game/types";

/**
 * Create an empty Playfield grid sized ROWS x COLS (10 rows x 16 cols), with
 * every cell `null`. Addressed `[row][col]`, row 0 at the top (Req 1.2, 17.2).
 */
export function emptyGrid(): Grid {
  const grid: Grid = [];
  for (let row = 0; row < ROWS; row++) {
    const cells: (Color | null)[] = [];
    for (let col = 0; col < COLS; col++) {
      cells.push(null);
    }
    grid.push(cells);
  }
  return grid;
}

/**
 * Deep-clone a grid by cloning each row array, so mutations on the clone never
 * affect the original. Keeps the pure core's immutability guarantees.
 */
export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

/** True iff `(row, col)` is a valid Playfield coordinate (Req 4.7). */
export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

/**
 * True iff `(row, col)` is in bounds AND the grid cell there is occupied
 * (non-null). Out-of-bounds coordinates are reported as not occupied; callers
 * that must reject out-of-bounds placement use `inBounds` separately (see
 * `canPlace`).
 */
export function isOccupied(grid: Grid, row: number, col: number): boolean {
  if (!inBounds(row, col)) {
    return false;
  }
  const gridRow = grid[row];
  if (gridRow === undefined) {
    return false;
  }
  return gridRow[col] != null;
}

/**
 * Return the four footprint cells of an ActiveBlock with their grid
 * coordinates and colours. The piece is `[[topLeft, topRight], [bottomLeft,
 * bottomRight]]`:
 * - `piece[0][0]` at `(row, col)`
 * - `piece[0][1]` at `(row, col + 1)`
 * - `piece[1][0]` at `(row + 1, col)`
 * - `piece[1][1]` at `(row + 1, col + 1)`
 */
export function blockCells(
  block: ActiveBlock,
): { row: number; col: number; color: Color }[] {
  const { piece, row, col } = block;
  const [topRow, bottomRow] = piece;
  const [topLeft, topRight] = topRow;
  const [bottomLeft, bottomRight] = bottomRow;
  return [
    { row, col, color: topLeft },
    { row, col: col + 1, color: topRight },
    { row: row + 1, col, color: bottomLeft },
    { row: row + 1, col: col + 1, color: bottomRight },
  ];
}
