import { GRID_COLS, GRID_ROWS } from "../constants";
import { createGrid } from "./grid";
import type { Grid } from "./types";

/**
 * Collapse settled cells downward so empties rise to the top of each column,
 * preserving vertical order within the column (FR-012).
 */
export function applyGravity(grid: Grid): Grid {
  const next = createGrid();
  for (let c = 0; c < GRID_COLS; c++) {
    const stack: (0 | 1)[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      const cell = grid[r]![c];
      if (cell !== null && cell !== undefined) stack.push(cell);
    }
    // place from the bottom up
    let r = GRID_ROWS - 1;
    for (let i = stack.length - 1; i >= 0; i--) {
      next[r]![c] = stack[i]!;
      r--;
    }
  }
  return next;
}
