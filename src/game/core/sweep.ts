import { chainFlood } from "./chain-clear";
import { COLS, SKIN_ADVANCE_THRESHOLD } from "./constants";
import { computeMarked } from "./detect";
import { cloneGrid, settle, settleColumn } from "./grid";
import { boardStateBonus, nextCombo, passScore } from "./scoring";
import { SKINS } from "./skins";
import type { GameState, Grid, SweepPass } from "./types";

/** Snapshot the currently-marked cells (grouped by column) for a new pass. */
function startPass(grid: Grid): SweepPass {
  const { marked, distinctSquares } = computeMarked(grid);
  const markedByCol: number[][] = Array.from({ length: COLS }, () => []);
  for (const { row, col } of marked) markedByCol[col]!.push(row);
  return { markedByCol, distinctSquares, deletedCount: 0, processedCols: 0 };
}

/**
 * Deep-clone a pass so `advanceSweep` can mutate it without writing through to
 * the caller's `GameState.sweepPass`. The inner `markedByCol` arrays are the
 * live read surface for deletion, so they are copied too — a shallow copy would
 * still share them and leak mutations (`processedCols`/`deletedCount` aside).
 * Keeps the core a pure function of (state, columns): same input -> same output.
 */
function clonePass(pass: SweepPass): SweepPass {
  return {
    markedByCol: pass.markedByCol.map((rows) => rows.slice()),
    distinctSquares: pass.distinctSquares,
    deletedCount: pass.deletedCount,
    processedCols: pass.processedCols,
  };
}

/**
 * Delete this pass's snapshot-marked cells in a single column (mutates grid).
 * When a deleted cell carries a chain special, the SAME delete step also floods
 * every same-colour orthogonally-connected cell (one deterministic delete step
 * shared with the overlapping-2x2 square clears). Snapshot squares are already
 * counted via `pass.distinctSquares`; flooded-in extras clear but contribute
 * NOTHING to the score. The `specials` set is kept aligned: any consumed chain
 * cell is dropped.
 */
function deleteColumn(
  grid: Grid,
  pass: SweepPass,
  col: number,
  specials: Set<number>,
): boolean {
  let flooded = false;
  for (const row of pass.markedByCol[col]!) {
    const colour = grid[row]![col];
    if (colour === null) continue;
    const coord = row * COLS + col;
    const isChain = specials.has(coord);
    grid[row]![col] = null;
    pass.deletedCount += 1;
    specials.delete(coord);
    // Chain activation (PSP-faithful): a chain cell is part of a cleared square
    // (it was snapshot-marked), so it activates. Flood its connected same-colour
    // region in this same step; extras score nothing. Only chain cells flood;
    // ordinary square cells just clear.
    if (isChain) {
      chainFlood(grid, coord, colour, specials);
      flooded = true;
    }
  }
  return flooded;
}

/**
 * Process a single column as the bar's leading edge crosses it: delete this
 * pass's snapshot-marked cells in that column (plus any chain floods they
 * trigger), then settle so cells above removed cells fall IMMEDIATELY (the
 * deferred-gravity fix). A chain flood can empty cells in other columns
 * (including ahead of the bar), so every column is settled here; per-column
 * gravity is independent, so this equals settling only the affected columns.
 */
function processColumn(
  grid: Grid,
  pass: SweepPass,
  col: number,
  specials: Set<number>,
): void {
  const flooded = deleteColumn(grid, pass, col, specials);
  if (flooded) {
    // A chain flood can empty cells in any column (including ahead of the bar),
    // so settle the whole grid. Per-column gravity is independent, so this is
    // equivalent to settling only the touched columns, just simpler.
    for (let c = 0; c < COLS; c++) settleColumn(grid, c);
  } else {
    // No flood: only this column's stack changed; settle it alone (the original
    // deferred-gravity fix), keeping behaviour identical for non-chain passes.
    settleColumn(grid, col);
  }
}

/**
 * Deterministic skin advancement: while the per-skin squares-cleared count meets
 * the threshold, advance to the next skin (clamped at the last) and reset the
 * counter. A loop handles one big pass crossing several thresholds; once at the
 * last skin the counter is capped so it does not grow unbounded.
 */
function advanceSkin(
  skinIndex: number,
  clearsInSkin: number,
): { skinIndex: number; clearsInSkin: number } {
  let idx = skinIndex;
  let count = clearsInSkin;
  while (count >= SKIN_ADVANCE_THRESHOLD && idx < SKINS.length - 1) {
    count -= SKIN_ADVANCE_THRESHOLD;
    idx += 1;
  }
  if (idx >= SKINS.length - 1 && count >= SKIN_ADVANCE_THRESHOLD) {
    count = SKIN_ADVANCE_THRESHOLD;
  }
  return { skinIndex: idx, clearsInSkin: count };
}

/**
 * Advance the sweep deterministically by a (possibly fractional) number of
 * columns. As the bar's leading edge crosses each column it deletes that
 * column's snapshot-marked cells (and any chain floods) and settles immediately.
 * Scoring is banked when a pass completes using the faithful rule
 * (squares x 40 x combo-curve) plus board-state bonuses; combo and per-skin
 * clear counters advance at the boundary. Wraps and starts a fresh pass for the
 * next traversal — new squares formed by settle are picked up by that next
 * `startPass`, so cascades resolve on the following pass. Pure: returns a new
 * GameState (relocated `specials` set, updated `combo`, `clearsInSkin`, and
 * possibly `skinIndex`).
 */
export function advanceSweep(state: GameState, columns: number): GameState {
  if (columns <= 0) return state;

  const grid = cloneGrid(state.grid);
  const specials = new Set(state.specials);
  let score = state.score;
  let sweepX = state.sweepX;
  let combo = state.combo;
  let skinIndex = state.skinIndex;
  let clearsInSkin = state.clearsInSkin;
  let pass: SweepPass = state.sweepPass
    ? clonePass(state.sweepPass)
    : startPass(grid);
  let remaining = columns;

  while (remaining > 0) {
    const toEdge = COLS - sweepX;
    const step = Math.min(remaining, toEdge);
    sweepX += step;
    remaining -= step;

    const passedCols = Math.min(COLS, Math.floor(sweepX));
    for (let col = pass.processedCols; col < passedCols; col++) {
      processColumn(grid, pass, col, specials);
    }
    pass.processedCols = passedCols;

    // Pass complete: bank scoring with the faithful rule, advance combo/skin,
    // apply board-state bonus, wrap, and re-snapshot (grid already settled).
    if (sweepX >= COLS - 1e-9) {
      const squares = pass.distinctSquares;
      score += passScore(squares, combo);
      combo = nextCombo(combo, squares);
      if (squares > 0) {
        // Board-state bonuses are only assessed when a clear actually happened
        // this pass (a clear reduced the field) — not awarded passively every
        // pass a single-colour/empty board sits there.
        score += boardStateBonus(grid);
        clearsInSkin += squares;
        ({ skinIndex, clearsInSkin } = advanceSkin(skinIndex, clearsInSkin));
      }
      sweepX = 0;
      pass = startPass(grid);
    }
  }

  return {
    ...state,
    grid,
    specials,
    score,
    sweepX,
    combo,
    skinIndex,
    clearsInSkin,
    sweepPass: pass,
  };
}

/**
 * Run one full timeline sweep immediately from the current grid: snapshot,
 * delete all marked cells (with chain floods), apply faithful scoring + bonus,
 * settle gravity, advance combo + skin. Resets sweepX to 0.
 */
export function runFullSweep(state: GameState): GameState {
  const grid = cloneGrid(state.grid);
  const specials = new Set(state.specials);
  const pass = startPass(grid);
  for (let col = 0; col < COLS; col++) {
    deleteColumn(grid, pass, col, specials);
  }
  const squares = pass.distinctSquares;
  const settled = settle(grid);
  let score = state.score + passScore(squares, state.combo);
  const combo = nextCombo(state.combo, squares);
  let skinIndex = state.skinIndex;
  let clearsInSkin = state.clearsInSkin;
  if (squares > 0) {
    // Bonuses only when a clear happened this sweep (see advanceSweep).
    score += boardStateBonus(settled);
    clearsInSkin += squares;
    ({ skinIndex, clearsInSkin } = advanceSkin(skinIndex, clearsInSkin));
  }
  return {
    ...state,
    grid: settled,
    specials,
    score,
    combo,
    skinIndex,
    clearsInSkin,
    sweepX: 0,
    sweepPass: null,
  };
}
