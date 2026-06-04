import { GRID_COLS, SWEEP_MS_PER_COL } from "../constants";
import { applyGravity } from "./gravity";
import { markedCells } from "./marking";
import { scoreForClear } from "./scoring";
import type { GameState } from "./types";

/**
 * Clear the marked cells in a single column into the traversal's cleared list.
 * Marks are frozen per traversal (snapshot) so clearing the left half of a
 * square does not "unmark" its right half before the bar reaches it.
 *
 * Mutates the provided draft state.
 */
function clearColumn(state: GameState, col: number): void {
  state.sweepMarkSnapshot ??= markedCells(state.grid);
  for (const m of state.sweepMarkSnapshot) {
    if (m.col !== col) continue;
    const color = state.grid[m.row]?.[m.col];
    if (color === null || color === undefined) continue;
    state.grid[m.row]![m.col] = null;
    state.sweepCleared.push({ row: m.row, col: m.col, color });
  }
}

/** Apply scoring + gravity for the just-completed traversal and reset. */
function finalizeTraversal(state: GameState): void {
  if (state.sweepCleared.length > 0) {
    state.score += scoreForClear(state.sweepCleared);
    state.grid = applyGravity(state.grid);
  }
  state.sweepCleared = [];
  state.sweepMarkSnapshot = null;
}

/**
 * Advance the sweep deterministically by dtMs (0.25s/column). As the bar fully
 * passes a column it clears that column's marked cells; completing a full
 * 16-column traversal applies scoring + gravity and wraps to the left.
 *
 * Mutates the provided draft state.
 */
export function advanceSweep(state: GameState, dtMs: number): void {
  if (dtMs <= 0) return;
  let target = state.sweepX + dtMs / SWEEP_MS_PER_COL;
  let col = Math.floor(state.sweepX); // next column to be fully passed
  // safety bound: never loop more than a few full traversals worth of columns
  let guard = 0;
  while (target >= col + 1 && guard < GRID_COLS * 4 + 4) {
    guard++;
    clearColumn(state, col);
    col++;
    if (col === GRID_COLS) {
      finalizeTraversal(state);
      target -= GRID_COLS;
      col = 0;
    }
  }
  state.sweepX = target;
}

/** Run one full timeline sweep immediately and apply scoring (FR test sweepNow). */
export function sweepNowDraft(state: GameState): void {
  state.sweepX = 0;
  state.sweepCleared = [];
  state.sweepMarkSnapshot = markedCells(state.grid);
  for (let c = 0; c < GRID_COLS; c++) clearColumn(state, c);
  finalizeTraversal(state);
  state.sweepX = 0;
}
