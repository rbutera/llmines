import { chainFlood } from "./chain-clear";
import { COLS, ROWS, SKIN_ADVANCE_THRESHOLD } from "./constants";
import { computeMarked } from "./detect";
import { cloneGrid, settle, settleColumnWithMarks } from "./grid";
import { boardStateBonus, nextCombo, passScore } from "./scoring";
import { SKINS } from "./skins";
import type { GameState, Grid, SweepPass } from "./types";

/** A fresh ROWS x COLS boolean grid of `false`. */
function emptyMarks(): boolean[][] {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => false),
  );
}

/**
 * Snapshot the currently-marked cells as a ROWS x COLS boolean grid for a new
 * pass. Marks are identity-based: the snapshot is taken once, but `marks` then
 * travels with its cells through every per-column settle (`settleColumnWithMarks`)
 * and is cleared for any cell a chain flood consumes. So deletion always targets
 * the originally-marked cell at its CURRENT row, never a stale (row,col) that a
 * later settle has refilled with an innocent cell.
 */
function startPass(grid: Grid): SweepPass {
  const { marked, distinctSquares } = computeMarked(grid);
  const marks = emptyMarks();
  for (const { row, col } of marked) marks[row]![col] = true;
  return { marks, distinctSquares, deletedCount: 0, processedCols: 0 };
}

/**
 * Deep-clone a pass so `advanceSweep` can mutate it without writing through to
 * the caller's `GameState.sweepPass`. The `marks` grid is the live read surface
 * for deletion, so it is copied row-by-row — a shallow copy would share the rows
 * and leak mutations. Keeps the core a pure function of (state, columns).
 */
function clonePass(pass: SweepPass): SweepPass {
  return {
    marks: pass.marks.map((row) => row.slice()),
    distinctSquares: pass.distinctSquares,
    deletedCount: pass.deletedCount,
    processedCols: pass.processedCols,
  };
}

/**
 * Delete this pass's marked cells in a single column (mutates grid + marks).
 * Deletion reads the `marks` grid, NOT a fixed snapshot coordinate list, so a
 * cell only dies if its mark is still set at its current row — flood-consumed
 * cells have already had their marks cleared, and innocent cells never carried a
 * mark. When a deleted cell carries a chain special, the SAME delete step floods
 * every same-colour orthogonally-connected cell (clearing their marks too).
 * Snapshot squares are counted via `pass.distinctSquares`; flooded-in extras
 * clear but score NOTHING. The `specials` set is kept aligned.
 */
function deleteColumn(
  grid: Grid,
  pass: SweepPass,
  col: number,
  specials: Set<number>,
): boolean {
  let flooded = false;
  for (let row = 0; row < ROWS; row++) {
    if (!pass.marks[row]![col]) continue;
    const colour = grid[row]![col] ?? null;
    pass.marks[row]![col] = false;
    if (colour === null) continue;
    const coord = row * COLS + col;
    const isChain = specials.has(coord);
    grid[row]![col] = null;
    pass.deletedCount += 1;
    specials.delete(coord);
    // Chain activation (PSP-faithful): a chain cell is part of a cleared square
    // (it was marked), so it activates. Flood its connected same-colour region
    // in this same step; extras score nothing. Only chain cells flood; ordinary
    // square cells just clear.
    if (isChain) {
      chainFlood(grid, coord, colour, specials, pass.marks);
      flooded = true;
    }
  }
  return flooded;
}

/**
 * Process a single column as the bar's leading edge crosses it: delete this
 * pass's marked cells in that column (plus any chain floods), then settle so
 * cells above removed cells fall IMMEDIATELY (the deferred-gravity fix). The
 * settle moves the `marks` grid in lockstep with the cells, so marks for
 * not-yet-processed columns follow their cells down. A chain flood can empty
 * cells in other columns (including ahead of the bar), so every column is
 * settled here; per-column gravity is independent, so this equals settling only
 * the affected columns.
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
    for (let c = 0; c < COLS; c++) settleColumnWithMarks(grid, pass.marks, c);
  } else {
    // No flood: only this column's stack changed; settle it alone (the original
    // deferred-gravity fix), keeping behaviour identical for non-chain passes.
    settleColumnWithMarks(grid, pass.marks, col);
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
