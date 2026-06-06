import { GRID_COLS, SWEEP_PERIOD } from "./constants";
import {
  applyGravityAll,
  applyGravityColumn,
  countDistinctSquaresInMarked,
  scanSquares,
} from "./grid";
import type { GameState } from "./types";

/**
 * Clear all marked cells in a specific column.
 * Deletes marked cells, applies gravity, re-scans for new squares.
 * Adds deleted count to state.sweepCellsDeleted.
 */
export function clearColumn(state: GameState, col: number): void {
  const toRemove: string[] = [];

  for (const key of state.markedCells) {
    const [, colStr] = key.split(",");
    if (parseInt(colStr!, 10) === col) {
      toRemove.push(key);
    }
  }

  if (toRemove.length === 0) return;

  // Delete marked cells in this column
  for (const key of toRemove) {
    const [rowStr, colStr] = key.split(",");
    const r = parseInt(rowStr!, 10);
    const c = parseInt(colStr!, 10);
    state.grid[r]![c] = null;
    state.markedCells.delete(key);
  }

  state.sweepCellsDeleted += toRemove.length;

  // Apply gravity to this column
  applyGravityColumn(state.grid, col);

  // Re-scan for new squares formed after gravity
  const { markedKeys } = scanSquares(state.grid);
  for (const key of markedKeys) {
    state.markedCells.add(key);
  }
}

/**
 * Complete a sweep traversal - calculate and apply score.
 * Score = sweepCellsDeleted × sweepSquaresCleared.
 * Only applies score if sweepCellsDeleted > 0.
 */
export function completeSweep(state: GameState): void {
  if (state.sweepCellsDeleted > 0) {
    const score = state.sweepCellsDeleted * state.sweepSquaresCleared;
    state.score += score;
  }

  // Reset accumulators
  state.sweepCellsDeleted = 0;
  state.sweepSquaresCleared = 0;
  state.lastSweepColumn = -1;
}

/**
 * Count distinct squares before clearing a column and update sweepSquaresCleared.
 * The count captures distinct squares at the moment before each column clear,
 * taking the maximum seen (since new squares can form from gravity).
 */
function clearColumnWithScoring(state: GameState, col: number): void {
  // Count distinct squares BEFORE clearing this column
  const squaresBefore = countDistinctSquaresInMarked(
    state.grid,
    state.markedCells,
  );
  const cellsBefore = state.sweepCellsDeleted;
  clearColumn(state, col);
  // If cells were actually deleted, update the squares count
  // Use max to capture the highest distinct squares seen during this traversal
  if (state.sweepCellsDeleted > cellsBefore) {
    state.sweepSquaresCleared = Math.max(
      state.sweepSquaresCleared,
      squaresBefore,
    );
  }
}

/**
 * Advance the sweep bar by dtMs milliseconds.
 * Moves sweepX by (dtMs / SWEEP_PERIOD) * GRID_COLS.
 * Clears columns as the sweep bar crosses their right boundary.
 * Handles wrap-around and scoring on full traversal.
 */
export function advanceSweep(state: GameState, dtMs: number): void {
  const prevX = state.sweepX;
  const delta = (dtMs / SWEEP_PERIOD) * GRID_COLS;
  let newX = prevX + delta;

  if (newX >= GRID_COLS) {
    // Sweep wraps around — clear remaining columns in this traversal first
    for (let col = state.lastSweepColumn + 1; col < GRID_COLS; col++) {
      clearColumnWithScoring(state, col);
      state.lastSweepColumn = col;
    }

    // Complete the sweep — apply scoring
    completeSweep(state);

    // Wrap around
    newX = newX % GRID_COLS;
    state.sweepX = newX;

    // Clear columns in the new traversal up to current position
    const newCol = Math.floor(newX);
    for (let col = 0; col <= newCol; col++) {
      if (col > state.lastSweepColumn) {
        clearColumnWithScoring(state, col);
        state.lastSweepColumn = col;
      }
    }
  } else {
    state.sweepX = newX;

    // Clear any columns we've crossed
    const newCol = Math.floor(newX);
    for (let col = state.lastSweepColumn + 1; col <= newCol; col++) {
      clearColumnWithScoring(state, col);
      state.lastSweepColumn = col;
    }
  }
}

/**
 * Execute a full sweep immediately (test mode).
 * Deletes ALL marked cells, applies gravity, re-scans, and applies scoring.
 * Score = cellsDeleted × distinctSquares (calculated BEFORE clearing).
 */
export function sweepNow(state: GameState): void {
  // Count distinct squares BEFORE clearing
  const distinctSquares = countDistinctSquaresInMarked(
    state.grid,
    state.markedCells,
  );

  // Delete all marked cells
  let totalDeleted = 0;
  for (const key of state.markedCells) {
    const [rowStr, colStr] = key.split(",");
    const r = parseInt(rowStr!, 10);
    const c = parseInt(colStr!, 10);
    state.grid[r]![c] = null;
    totalDeleted++;
  }
  state.markedCells.clear();

  // Apply gravity to all columns
  applyGravityAll(state.grid);

  // Re-scan for new squares formed by gravity
  const { markedKeys } = scanSquares(state.grid);
  for (const key of markedKeys) {
    state.markedCells.add(key);
  }

  // Apply scoring: cellsDeleted × distinctSquares
  if (totalDeleted > 0) {
    state.score += totalDeleted * distinctSquares;
  }

  // Reset sweep state
  state.sweepX = 0;
  state.sweepCellsDeleted = 0;
  state.sweepSquaresCleared = 0;
  state.lastSweepColumn = -1;
}
