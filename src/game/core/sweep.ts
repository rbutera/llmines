import { COLS } from "./constants";
import { computeMarked } from "./detect";
import { cloneGrid, settle, settleColumn } from "./grid";
import type { GameState, Grid, SweepPass } from "./types";

/** Snapshot the currently-marked cells (grouped by column) for a new pass. */
function startPass(grid: Grid): SweepPass {
  const { marked, distinctSquares } = computeMarked(grid);
  const markedByCol: number[][] = Array.from({ length: COLS }, () => []);
  for (const { row, col } of marked) markedByCol[col]!.push(row);
  return { markedByCol, distinctSquares, deletedCount: 0, processedCols: 0 };
}

/** Delete this pass's snapshot-marked cells in a single column (mutates grid). */
function deleteColumn(grid: Grid, pass: SweepPass, col: number): void {
  for (const row of pass.markedByCol[col]!) {
    if (grid[row]![col] !== null) {
      grid[row]![col] = null;
      pass.deletedCount += 1;
    }
  }
}

/** Apply per-pass scoring: deletedCells x distinctSquares. */
function passScore(pass: SweepPass): number {
  return pass.deletedCount * pass.distinctSquares;
}

/**
 * Process a single column as the bar's leading edge crosses it: delete this
 * pass's snapshot-marked cells in that column, then settle that column so any
 * cells above the removed cells fall IMMEDIATELY (the deferred-gravity fix).
 *
 * Gravity is per-column and independent, so settling only the just-deleted
 * column is both sufficient and correct: removing cells in column `col` can
 * never strand a cell in any other column. Deletion happens before settle, and
 * each column is processed exactly once (driven by `processedCols`), so a column
 * is never simultaneously settling and pending-deletion, and a cell that falls
 * into a snapshot coordinate after the snapshot was taken is never re-deleted
 * (deletion is keyed by the pass-start (row, col) snapshot, applied first).
 */
function processColumn(grid: Grid, pass: SweepPass, col: number): void {
  deleteColumn(grid, pass, col);
  settleColumn(grid, col);
}

/**
 * Advance the sweep deterministically by a (possibly fractional) number of
 * columns. As the bar's leading edge crosses each column it deletes that
 * column's snapshot-marked cells and settles that column immediately (so the
 * stack above a swept column falls at once, not at pass end). Scoring is banked
 * when a pass completes; the grid is already settled incrementally, so no batch
 * settle is needed. Wraps and starts a fresh pass for the next traversal — new
 * squares formed by an incremental settle are picked up by that next
 * `startPass`, so cascades resolve on the following pass. Pure: returns a new
 * GameState.
 */
export function advanceSweep(state: GameState, columns: number): GameState {
  if (columns <= 0) return state;

  const grid = cloneGrid(state.grid);
  let score = state.score;
  let sweepX = state.sweepX;
  let pass: SweepPass = state.sweepPass ?? startPass(grid);
  let remaining = columns;

  while (remaining > 0) {
    const toEdge = COLS - sweepX;
    const step = Math.min(remaining, toEdge);
    sweepX += step;
    remaining -= step;

    // Process each column the leading edge has now fully crossed: delete then
    // settle that column immediately, left-to-right, each column exactly once.
    const passedCols = Math.min(COLS, Math.floor(sweepX));
    for (let col = pass.processedCols; col < passedCols; col++) {
      processColumn(grid, pass, col);
    }
    pass.processedCols = passedCols;

    // Pass complete: bank scoring, wrap, re-snapshot (grid already settled).
    if (sweepX >= COLS - 1e-9) {
      score += passScore(pass);
      sweepX = 0;
      pass = startPass(grid);
    }
  }

  return { ...state, grid, score, sweepX, sweepPass: pass };
}

/**
 * Run one full timeline sweep immediately from the current grid: snapshot,
 * delete all marked cells, apply scoring, settle gravity. Resets sweepX to 0.
 */
export function runFullSweep(state: GameState): GameState {
  const grid = cloneGrid(state.grid);
  const pass = startPass(grid);
  for (let col = 0; col < COLS; col++) deleteColumn(grid, pass, col);
  const score = state.score + passScore(pass);
  return {
    ...state,
    grid: settle(grid),
    score,
    sweepX: 0,
    sweepPass: null,
  };
}
