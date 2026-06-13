import { chainFlood, type ChainClearRecord } from "./chain-clear";
import { COLS, ROWS, SKIN_ADVANCE_THRESHOLD } from "./constants";
import { isSquareAt } from "./detect";
import { cloneGrid, settleColumnWithMarks } from "./grid";
import { boardStateBonus, nextCombo, passPackage, passScore } from "./scoring";
import { SKINS } from "./skins";
import type { GameState, Grid, SweepPass } from "./types";

/** A fresh ROWS x COLS boolean grid of `false`. */
function emptyMarks(): boolean[][] {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => false),
  );
}

/**
 * Begin a fresh pass (design D1, audit A2). Marks are NO LONGER snapshotted at
 * pass start — they are set incrementally by {@link markColumn} as the bar's
 * leading edge reaches each column. So a square completed ahead of the bar is
 * picked up when the edge reaches its left (anchor) column and clears on the
 * CURRENT pass, and a square forming behind the already-passed edge waits for the
 * next pass. `distinctSquares` accumulates as squares are marked.
 */
function startPass(): SweepPass {
  return {
    marks: emptyMarks(),
    distinctSquares: 0,
    countedCorners: new Set<number>(),
    runStart: -1,
    deletedCount: 0,
    processedCols: 0,
    groupErases: [],
  };
}

/**
 * Deep-clone a pass so `advanceSweep` can mutate it without writing through to
 * the caller's `GameState.sweepPass`. The `marks` grid is the live read surface
 * for deletion, so it is copied row-by-row — a shallow copy would share the rows
 * and leak mutations. The `countedCorners` set and `groupErases` (record-only)
 * are copied too. Keeps the core a pure function of (state, columns).
 */
function clonePass(pass: SweepPass): SweepPass {
  return {
    marks: pass.marks.map((row) => row.slice()),
    distinctSquares: pass.distinctSquares,
    countedCorners: new Set(pass.countedCorners),
    runStart: pass.runStart,
    deletedCount: pass.deletedCount,
    processedCols: pass.processedCols,
    groupErases: pass.groupErases.map((g) => ({
      cells: g.cells.slice(),
      hadChain: g.hadChain,
    })),
  };
}

/**
 * Incremental marking (design D1, audit A2). As the bar's leading edge reaches
 * column `col`, detect every completed 2x2 square whose TOP-LEFT (anchor) column
 * is exactly `col` against the CURRENT settled grid, and mark all four of its
 * cells (the right column `c+1`'s cells are marked AHEAD of the bar — legal; they
 * extend the contiguous run when the edge reaches them). A square is therefore
 * marked iff it is complete at the moment the edge reaches its left anchor
 * column; a square whose anchor column was already passed before it completed is
 * never re-marked (its cells live in already-erased/passed columns).
 *
 * `distinctSquares` accumulates, deduped by anchor corner via `countedCorners`,
 * so a square already counted earlier in the pass is not recounted.
 */
function markColumn(grid: Grid, pass: SweepPass, col: number): void {
  if (col < 0 || col >= COLS - 1) return; // no 2x2 can be anchored on the last col
  for (let row = 0; row < ROWS - 1; row++) {
    if (!isSquareAt(grid, row, col)) continue;
    const corner = row * COLS + col;
    if (!pass.countedCorners.has(corner)) {
      pass.countedCorners.add(corner);
      pass.distinctSquares += 1;
    }
    pass.marks[row]![col] = true;
    pass.marks[row]![col + 1] = true;
    pass.marks[row + 1]![col] = true;
    pass.marks[row + 1]![col + 1] = true;
  }
}

/** Does column `col` currently carry any mark? (a marked column extends a run.) */
function columnHasMark(pass: SweepPass, col: number): boolean {
  for (let row = 0; row < ROWS; row++) {
    if (pass.marks[row]![col]) return true;
  }
  return false;
}

/**
 * Erase a contiguous-group batch (design D2, audit A3): delete every marked cell
 * across the columns `[fromCol, toCol]` in ONE batch, fire chain floods for any
 * special in the batch, then settle the touched columns ONCE. Deletion reads the
 * `marks` grid (identity-based), NOT a fixed coordinate list, so a cell only dies
 * if its mark is still set at its current row — flood-consumed cells already had
 * their marks cleared, and innocent cells never carried a mark. Snapshot squares
 * are counted via `pass.distinctSquares`; flooded-in extras clear but score
 * NOTHING. The `specials` set is kept aligned. Records the batch's erased cells +
 * whether a chain fired into `pass.groupErases` (RECORD-ONLY, design D8).
 */
function eraseGroup(
  grid: Grid,
  pass: SweepPass,
  fromCol: number,
  toCol: number,
  specials: Set<number>,
  record?: ChainClearRecord[],
): void {
  const erased: number[] = [];
  let hadChain = false;
  // First delete all marked cells in the run; activating chain floods inline so a
  // flood ahead of the bar clears those cells (and their marks) within the batch.
  for (let col = fromCol; col <= toCol; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (!pass.marks[row]![col]) continue;
      const colour = grid[row]![col] ?? null;
      pass.marks[row]![col] = false;
      if (colour === null) continue;
      const coord = row * COLS + col;
      const isChain = specials.has(coord);
      grid[row]![col] = null;
      pass.deletedCount += 1;
      erased.push(coord);
      specials.delete(coord);
      if (isChain) {
        // Flood the connected same-colour region (including cells ahead of the
        // bar); extras score nothing. The flood clears its cells' marks too, so a
        // cell a flood consumes is never re-targeted by identity-based deletion.
        // A local record sink captures the flooded component so this batch's
        // telemetry `cells` includes the flood extent (D8), while the optional
        // `record` (render wavefront) is fed too.
        const localSink: ChainClearRecord[] = [];
        chainFlood(grid, coord, colour, specials, pass.marks, localSink);
        for (const r of localSink) {
          if (record) record.push(r);
          // Skip the origin (dist 0) — already pushed above as `coord`.
          for (const oc of r.cells) {
            if (oc.cell !== coord) erased.push(oc.cell);
          }
        }
        hadChain = true;
      }
    }
  }
  // Settle each touched column ONCE (deferred gravity). A chain flood can empty
  // cells in columns ahead of the run, so settle the whole grid when one fired —
  // per-column gravity is independent, so this equals settling only the affected
  // columns, just simpler and provably complete.
  if (hadChain) {
    for (let c = 0; c < COLS; c++) settleColumnWithMarks(grid, pass.marks, c);
  } else {
    for (let col = fromCol; col <= toCol; col++) {
      settleColumnWithMarks(grid, pass.marks, col);
    }
  }
  pass.groupErases.push({ cells: erased, hadChain });
}

/**
 * Walk the bar's leading edge across the columns `[fromCol, reachedCol]`
 * (INCLUSIVE — `reachedCol` is the column the edge has now reached / entered),
 * driving the incremental mark -> run -> eraseGroup loop (design D1/D2). For each
 * newly-reached column:
 *   1. mark squares now complete at its left anchor (`markColumn`);
 *   2. if it carries marks, it extends the current contiguous run;
 *   3. if it is a GAP (no marks), the run that ended at the prior column closes —
 *      erase it as one batch (`eraseGroup`) and settle once.
 * When the edge reaches a gap column it erases the run BEHIND it — so a square at
 * cols 0-1 erases once the edge reaches the (empty) col 2, even mid-pass. A run
 * still open at the right edge is flushed separately by {@link flushOpenRun} at
 * pass completion (which may be a later call that reaches no new column).
 */
function crossColumns(
  grid: Grid,
  pass: SweepPass,
  fromCol: number,
  reachedCol: number,
  specials: Set<number>,
  record?: ChainClearRecord[],
): void {
  for (let col = fromCol; col <= reachedCol; col++) {
    markColumn(grid, pass, col);
    const marked = columnHasMark(pass, col);
    if (marked) {
      if (pass.runStart < 0) pass.runStart = col;
    } else if (pass.runStart >= 0) {
      // Gap column the edge has reached closes the run that ended at col-1.
      eraseGroup(grid, pass, pass.runStart, col - 1, specials, record);
      pass.runStart = -1;
    }
  }
}

/**
 * Flush a run still open at pass completion (it extends to the last column with
 * no trailing gap, design D2). Called once when the bar reaches the right edge,
 * even on a later call that reaches no new column.
 */
function flushOpenRun(
  grid: Grid,
  pass: SweepPass,
  specials: Set<number>,
  record?: ChainClearRecord[],
): void {
  if (pass.runStart >= 0) {
    eraseGroup(grid, pass, pass.runStart, COLS - 1, specials, record);
    pass.runStart = -1;
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
 * columns. As the bar's leading edge crosses each column it MARKS squares now
 * complete at/behind it (design D1), accumulating contiguous marked columns into
 * a run; a gap column or the right edge ERASES the run as one batch and settles
 * once (design D2). Chain floods fire at group-erase time. Scoring is banked when
 * the pass completes at the right edge using the accumulated `distinctSquares`
 * (faithful rule: package(squares) x streak-multiplier) plus board-state bonuses;
 * combo and per-skin clear counters advance at the boundary. Wraps and starts a
 * fresh pass for the next traversal — new squares formed by settle behind the bar
 * are picked up by that next pass; squares formed under unpassed columns are
 * marked when the edge reaches them this pass. Pure: returns a new GameState.
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
  // RECORD-ONLY sink for chain-flood clears this call (render wavefront). Does
  // not influence deletion/scoring/timing.
  const chainRecords: ChainClearRecord[] = [];
  // RECORD-ONLY (D8): the latest pass-completion event this call, if any pass
  // completed; carried forward from the prior state otherwise.
  let lastPassComplete = state.lastPassComplete;
  let pass: SweepPass = state.sweepPass
    ? clonePass(state.sweepPass)
    : startPass();
  let remaining = columns;

  while (remaining > 0) {
    const toEdge = COLS - sweepX;
    const step = Math.min(remaining, toEdge);
    sweepX += step;
    remaining -= step;

    // The leading edge at `sweepX` has reached (entered) column floor(sweepX);
    // clamp to the last column at pass end. `processedCols` is the next column to
    // process, so columns [processedCols, reachedCol] are newly reached this step.
    const passComplete = sweepX >= COLS - 1e-9;
    const reachedCol = passComplete ? COLS - 1 : Math.floor(sweepX);
    if (reachedCol >= pass.processedCols) {
      crossColumns(
        grid,
        pass,
        pass.processedCols,
        reachedCol,
        specials,
        chainRecords,
      );
      pass.processedCols = reachedCol + 1;
    }
    // A run still open at the right edge erases at pass completion — even when
    // this step reached no new column (the wrap arrived in a later call).
    if (passComplete) flushOpenRun(grid, pass, specials, chainRecords);

    // Pass complete: bank scoring with the faithful rule, advance combo/skin,
    // apply board-state bonus, wrap, and start a fresh pass (grid already settled
    // by the per-group settles).
    if (sweepX >= COLS - 1e-9) {
      const squares = pass.distinctSquares;
      score += passScore(squares, combo);
      // RECORD-ONLY (D8): emit the pass-completion event with the squares cleared,
      // the multiplier ACTUALLY applied to the package, and the per-group erases.
      // `combo` here is the streak count that scored THIS pass (advanced below).
      const comboMultiplier =
        squares > 0 ? passScore(squares, combo) / passPackage(squares) : 1;
      lastPassComplete = {
        id: (lastPassComplete?.id ?? 0) + 1,
        squares,
        comboMultiplier,
        groupErases: pass.groupErases,
      };
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
      pass = startPass();
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
    lastChainClear: nextChainClear(state.lastChainClear, chainRecords),
    lastPassComplete,
  };
}

/**
 * RECORD-ONLY: fold this call's chain-flood records into the `lastChainClear`
 * field. If none occurred, the prior value is carried forward unchanged (the
 * renderer keys off the monotonic `id`, so an unchanged value never re-fires).
 * If one or more occurred, the LARGEST component (most cells) is chosen as the
 * representative event and the `id` is bumped past the prior so the renderer
 * fires exactly once. Choosing the largest keeps a single visible wavefront for
 * the most dramatic clear; ties keep the first (earliest in sweep order). Pure.
 */
function nextChainClear(
  prev: GameState["lastChainClear"],
  records: ChainClearRecord[],
): GameState["lastChainClear"] {
  if (records.length === 0) return prev;
  let best = records[0]!;
  for (let i = 1; i < records.length; i++) {
    if (records[i]!.cells.length > best.cells.length) best = records[i]!;
  }
  const id = (prev?.id ?? 0) + 1;
  return { origin: best.origin, cells: best.cells, id };
}

/**
 * Run one full timeline sweep immediately from the current grid using the same
 * group-batch model as {@link advanceSweep}: mark every column, erase contiguous
 * groups at gaps / the right edge (settling once per group), then bank faithful
 * scoring + board-state bonus, advance combo + skin. Resets sweepX to 0. Matches
 * the incremental result on a static board.
 */
export function runFullSweep(state: GameState): GameState {
  const grid = cloneGrid(state.grid);
  const specials = new Set(state.specials);
  const chainRecords: ChainClearRecord[] = [];
  const pass = startPass();
  // Reach all 16 columns in one go, then flush any run open at the right edge.
  crossColumns(grid, pass, 0, COLS - 1, specials, chainRecords);
  flushOpenRun(grid, pass, specials, chainRecords);
  pass.processedCols = COLS;

  const squares = pass.distinctSquares;
  let score = state.score + passScore(squares, state.combo);
  // RECORD-ONLY (D8): emit the pass-completion event (this path completes a pass).
  const comboMultiplier =
    squares > 0 ? passScore(squares, state.combo) / passPackage(squares) : 1;
  const lastPassComplete = {
    id: (state.lastPassComplete?.id ?? 0) + 1,
    squares,
    comboMultiplier,
    groupErases: pass.groupErases,
  };
  const combo = nextCombo(state.combo, squares);
  let skinIndex = state.skinIndex;
  let clearsInSkin = state.clearsInSkin;
  if (squares > 0) {
    // Bonuses only when a clear happened this sweep (see advanceSweep).
    score += boardStateBonus(grid);
    clearsInSkin += squares;
    ({ skinIndex, clearsInSkin } = advanceSkin(skinIndex, clearsInSkin));
  }
  return {
    ...state,
    grid,
    specials,
    score,
    combo,
    skinIndex,
    clearsInSkin,
    sweepX: 0,
    sweepPass: null,
    lastChainClear: nextChainClear(state.lastChainClear, chainRecords),
    lastPassComplete,
  };
}
