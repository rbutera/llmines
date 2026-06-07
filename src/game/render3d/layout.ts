import { COLS, ROWS } from "../core";

/**
 * Shared world-space layout for the 3D renderer. Single source of truth for cell
 * size, gaps, and grid-(col,row) -> centred world-(x,y) mapping so the cubes,
 * the back-plane grid, and the sweep bar all agree.
 *
 * IMPORTANT: the game grid has row 0 = TOP (see core/types.ts). World y is up,
 * so row 0 must map to the HIGHEST y. cellY flips the row accordingly.
 */

/** Uniform world-units per cell. */
export const CELL = 1;
/** Small gap so blocks read as discrete (matches the sandbox). */
export const GAP = 0.06;

export const BOARD_W = COLS * CELL;
export const BOARD_H = ROWS * CELL;

/** Centred world x for a column (col 0 = leftmost). */
export function cellX(col: number): number {
  return (col - (COLS - 1) / 2) * CELL;
}

/** Centred world y for a row. Row 0 = TOP => highest y (row axis is flipped). */
export function cellY(row: number): number {
  return ((ROWS - 1) / 2 - row) * CELL;
}

/**
 * World x for a sweep position `sweepX` in [0, COLS]. The sweep bar sits on a
 * column BOUNDARY (left edge of column `sweepX`), so it spans cellX(0)-0.5 ..
 * cellX(COLS-1)+0.5 as sweepX runs 0..COLS.
 */
export function sweepWorldX(sweepX: number): number {
  return sweepX * CELL - (COLS * CELL) / 2;
}
