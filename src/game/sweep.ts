// Sweep, scoring, and post-deletion gravity for LLMines.
// This module is part of the pure game core: it imports nothing from React or PixiJS.

import { COLS, ROWS, SWEEP_MS_PER_COL } from "~/game/constants";
import { cloneGrid } from "~/game/grid";
import {
  countDistinctSquares,
  detectMarked,
  distinctSquaresInColumns,
} from "~/game/squares";
import type { GameState, Grid } from "~/game/types";

/**
 * Score contribution of a single Sweep_Deletion_Event: the number of deleted
 * cells multiplied by the number of Distinct_Squares cleared (Req 7.1). When
 * either factor is zero the result is zero (no score change).
 */
export function scoreFor(deletedCells: number, distinctSquares: number): number {
  return deletedCells * distinctSquares;
}

/**
 * Return a NEW grid in which, in column `col` only, every non-null cell has
 * fallen to the bottom preserving its relative top-to-bottom order, with empty
 * cells stacked above (Req 8.1). All other columns are copied unchanged.
 *
 * Pure: does not mutate `grid`. Out-of-range `col` yields a faithful clone.
 */
export function collapseColumn(grid: Grid, col: number): Grid {
  const next = cloneGrid(grid);
  if (col < 0 || col >= COLS) {
    return next;
  }

  // Gather the occupied colours in top-to-bottom order.
  const values: (0 | 1)[] = [];
  for (let r = 0; r < ROWS; r++) {
    const cell = grid[r]?.[col];
    if (cell != null) {
      values.push(cell);
    }
  }

  // Empties on top, occupied cells flush to the bottom preserving order.
  const emptyCount = ROWS - values.length;
  for (let r = 0; r < ROWS; r++) {
    const row = next[r];
    if (row === undefined) {
      continue;
    }
    row[col] = r < emptyCount ? null : (values[r - emptyCount] ?? null);
  }

  return next;
}

/** Aggregate outcome of a sweep operation (a Sweep_Deletion_Event). */
export interface SweepResult {
  /** Total Stack cells deleted during the event. */
  deletedCells: number;
  /** Total Distinct_Squares cleared during the event. */
  distinctSquares: number;
  /** Score added for the event (`deletedCells * distinctSquares`). */
  scoreDelta: number;
}

/**
 * Count occupied (non-null) cells in column `col` that are flagged in `marked`.
 */
function countMarkedInColumn(
  grid: Grid,
  marked: boolean[][],
  col: number,
): number {
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    if (marked[r]?.[col] === true && grid[r]?.[col] != null) {
      n++;
    }
  }
  return n;
}

/** Set every Marked_Cell in column `col` to null, mutating `grid` in place. */
function clearMarkedInColumn(
  grid: Grid,
  marked: boolean[][],
  col: number,
): void {
  for (let r = 0; r < ROWS; r++) {
    if (marked[r]?.[col] === true) {
      const row = grid[r];
      if (row !== undefined) {
        row[col] = null;
      }
    }
  }
}

/**
 * AUTHORITATIVE per-event sweep used by `sweepNow`. Deletes every Marked_Cell on
 * the entry grid, scores per the pinned rule (Req 7.1), applies post-deletion
 * gravity to every column (Req 8.1), and re-marks the settled stack (Req 8.2).
 *
 * Model (must satisfy Property 11):
 *  1. `marked = detectMarked(grid)`.
 *  2. `deletedCells` = total marked cells (members of any monochrome 2x2).
 *  3. `distinctSquares = countDistinctSquares(grid)` on the ENTRY grid.
 *  4. `scoreDelta = scoreFor(deletedCells, distinctSquares)` (0 when nothing deleted).
 *  5. Build `newGrid`: null out every marked cell, then `collapseColumn` for cols 0..15.
 *  6. `newMarked = detectMarked(newGrid)`.
 *
 * Pure: never mutates the input `state` or its `grid`.
 */
export function fullSweep(state: GameState): { state: GameState } & SweepResult {
  const entryGrid = state.grid;
  const marked = detectMarked(entryGrid);

  let deletedCells = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (marked[r]?.[c] === true && entryGrid[r]?.[c] != null) {
        deletedCells++;
      }
    }
  }

  const distinctSquares = countDistinctSquares(entryGrid);
  const scoreDelta = deletedCells === 0 ? 0 : scoreFor(deletedCells, distinctSquares);

  // Null out marked cells on a fresh copy, then apply gravity column by column.
  let newGrid = cloneGrid(entryGrid);
  for (let r = 0; r < ROWS; r++) {
    const row = newGrid[r];
    if (row === undefined) {
      continue;
    }
    for (let c = 0; c < COLS; c++) {
      if (marked[r]?.[c] === true) {
        row[c] = null;
      }
    }
  }
  for (let c = 0; c < COLS; c++) {
    newGrid = collapseColumn(newGrid, c);
  }

  const newMarked = detectMarked(newGrid);

  return {
    state: {
      ...state,
      grid: newGrid,
      marked: newMarked,
      score: state.score + scoreDelta,
      sweepX: 0,
    },
    deletedCells,
    distinctSquares,
    scoreDelta,
  };
}

/**
 * Advance the Timeline_Bar by `dtMs` and apply any deletions for the columns it
 * crosses (Req 6.1, 6.2, 6.3, 19.4).
 *
 * Rate: `sweepX` increases by `dtMs / SWEEP_MS_PER_COL` columns, so 16 columns
 * take 4000 ms (0.25 s per column). The bar wraps continuously: when its
 * continuous position reaches or exceeds `COLS` it is reduced modulo `COLS`
 * (Req 6.2).
 *
 * Deletion model (deterministic, documented): each time the continuous position
 * crosses an integer boundary `k` (k >= 1), column `(k - 1) mod COLS` has been
 * fully traversed. For that column we recompute `marked`, delete its Marked_Cells,
 * score `scoreFor(deletedInCol, distinctSquaresInColumns(grid, [col]))`, then
 * collapse the column. `marked` is recomputed once more from the final grid.
 *
 * Pure: never mutates the input `state` or its `grid`.
 */
export function sweepProgress(
  state: GameState,
  dtMs: number,
): { state: GameState } & SweepResult {
  const delta = Math.max(0, dtMs) / SWEEP_MS_PER_COL;
  const startX = state.sweepX;
  const target = startX + delta;

  const grid = cloneGrid(state.grid);
  let deletedCells = 0;
  let distinctSquares = 0;
  let scoreDelta = 0;

  // Process every integer boundary strictly above startX and at-or-below target.
  for (
    let boundary = Math.floor(startX) + 1;
    boundary <= target;
    boundary++
  ) {
    const col = (((boundary - 1) % COLS) + COLS) % COLS;
    const marked = detectMarked(grid);
    const deletedInCol = countMarkedInColumn(grid, marked, col);
    if (deletedInCol > 0) {
      const distinctInCol = distinctSquaresInColumns(grid, [col]);
      clearMarkedInColumn(grid, marked, col);
      const collapsed = collapseColumn(grid, col);
      // Copy collapsed column back into our working grid.
      for (let r = 0; r < ROWS; r++) {
        const src = collapsed[r];
        const dst = grid[r];
        if (src !== undefined && dst !== undefined) {
          dst[col] = src[col] ?? null;
        }
      }
      deletedCells += deletedInCol;
      distinctSquares += distinctInCol;
      scoreDelta += scoreFor(deletedInCol, distinctInCol);
    }
  }

  // Wrap the continuous position back into [0, COLS). `target` is always
  // non-negative (startX >= 0, delta >= 0), so a single modulo suffices; adding
  // COLS before the modulo would round values just under COLS up to COLS.
  const sweepX = target % COLS;
  const newMarked = detectMarked(grid);

  return {
    state: {
      ...state,
      grid,
      marked: newMarked,
      score: state.score + scoreDelta,
      sweepX,
    },
    deletedCells,
    distinctSquares,
    scoreDelta,
  };
}
