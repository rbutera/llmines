import { GRID_COLS, GRID_ROWS } from "../constants";
import type { Cell, Grid } from "./types";

export function createGrid(
  rows = GRID_ROWS,
  cols = GRID_COLS,
): Grid {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null as Cell),
  );
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS;
}

export function isOccupied(grid: Grid, row: number, col: number): boolean {
  if (!inBounds(row, col)) return false;
  return grid[row]![col] !== null;
}
