import { GRID_COLS, GRID_ROWS } from "../constants";
import type { ClearedCell, Color, Grid, MarkedCell } from "./types";

/** True if the aligned 2x2 window with top-left (r,c) is monochrome (all equal, non-null). */
export function isMonochromeWindow(grid: Grid, r: number, c: number): boolean {
  if (r < 0 || c < 0 || r + 1 >= GRID_ROWS || c + 1 >= GRID_COLS) return false;
  const a = grid[r]![c];
  if (a === null) return false;
  return (
    grid[r]![c + 1] === a &&
    grid[r + 1]![c] === a &&
    grid[r + 1]![c + 1] === a
  );
}

/**
 * Cells marked for deletion: any cell that belongs to at least one monochrome
 * 2x2 window. This marks the whole monochrome region (>= 2x2), per FR-008.
 */
export function markedCells(grid: Grid): MarkedCell[] {
  const marked: MarkedCell[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (grid[r]![c] === null) continue;
      const windows = [
        [r, c],
        [r - 1, c],
        [r, c - 1],
        [r - 1, c - 1],
      ];
      if (windows.some(([wr, wc]) => isMonochromeWindow(grid, wr!, wc!))) {
        marked.push({ row: r, col: c });
      }
    }
  }
  return marked;
}

/**
 * distinct_squares for the whole grid: count every aligned 2x2 whose top-left
 * corner is monochrome (2x3 region => 2, 3x3 region => 4), per FR-009.
 */
export function distinctSquares(grid: Grid): number {
  let count = 0;
  for (let r = 0; r < GRID_ROWS - 1; r++) {
    for (let c = 0; c < GRID_COLS - 1; c++) {
      if (isMonochromeWindow(grid, r, c)) count++;
    }
  }
  return count;
}

/**
 * Count distinct 2x2 squares within a set of cleared cells (with their colours).
 * Used so per-traversal scoring is exact regardless of the order columns clear.
 */
export function countSquaresInCells(cleared: ClearedCell[]): number {
  const map = new Map<string, Color>();
  for (const { row, col, color } of cleared) map.set(`${row},${col}`, color);
  const colorAt = (r: number, c: number): Color | undefined => map.get(`${r},${c}`);
  let count = 0;
  for (const { row, col, color } of cleared) {
    // count the window whose top-left is this cell
    if (
      colorAt(row, col) === color &&
      colorAt(row, col + 1) === color &&
      colorAt(row + 1, col) === color &&
      colorAt(row + 1, col + 1) === color
    ) {
      count++;
    }
  }
  return count;
}
