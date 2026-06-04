import { COLS } from "./constants";
import { computeMarked } from "./detect";
import { cloneGrid, settle } from "./grid";
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
 * Advance the sweep deterministically by a (possibly fractional) number of
 * columns. Deletes snapshot-marked cells as the bar crosses each column;
 * applies scoring and settles gravity when a pass completes; wraps and starts a
 * fresh pass for the next traversal. Pure: returns a new GameState.
 */
export function advanceSweep(state: GameState, columns: number): GameState {
  if (columns <= 0) return state;

  let grid = cloneGrid(state.grid);
  let score = state.score;
  let sweepX = state.sweepX;
  let pass: SweepPass = state.sweepPass ?? startPass(grid);
  let remaining = columns;

  while (remaining > 0) {
    const toEdge = COLS - sweepX;
    const step = Math.min(remaining, toEdge);
    sweepX += step;
    remaining -= step;

    // Delete any columns fully crossed by the bar's leading edge.
    const passedCols = Math.min(COLS, Math.floor(sweepX));
    for (let col = pass.processedCols; col < passedCols; col++) {
      deleteColumn(grid, pass, col);
    }
    pass.processedCols = passedCols;

    // Pass complete: score, settle, wrap, re-snapshot.
    if (sweepX >= COLS - 1e-9) {
      score += passScore(pass);
      grid = settle(grid);
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
