import {
  COLS,
  PREVIEW_DEPTH,
  SPAWN_COL,
  SPAWN_ROW,
  SPECIAL_RATE,
} from "./constants";
import { cloneGrid, inBounds, pieceCells, settle } from "./grid";
import { nextBit, nextFloat } from "./rng";
import type {
  ActivePiece,
  GameState,
  GeneratedPiece,
  Grid,
  Piece,
  PiecePos,
} from "./types";

/** Draw the next piece from the RNG, returning [nextState, piece]. */
export function nextPiece(rngState: number): [number, Piece] {
  const [s1, a] = nextBit(rngState);
  const [s2, b] = nextBit(s1);
  const [s3, c] = nextBit(s2);
  const [s4, d] = nextBit(s3);
  return [
    s4,
    [
      [a, b],
      [c, d],
    ],
  ];
}

/**
 * Generate the next piece plus its chain-special decision, drawing off the SINGLE
 * in-state RNG in the pinned CANONICAL ORDER:
 *   1. 4 colour bits (the existing `nextPiece` order)
 *   2. 1 special roll: special iff `nextFloat < SPECIAL_RATE` (~1/30)
 *   3. if special, 1 more draw to pick which of the 4 cells carries it
 *
 * This order is the determinism contract: a seeded run is identical whether or
 * not the preview/specials are consumed, because the colour draws always come
 * first and in the same sequence. NEVER introduce a second RNG.
 */
export function generateNext(rngState: number): [number, GeneratedPiece] {
  const [s1, cells] = nextPiece(rngState);
  const [s2, roll] = nextFloat(s1);
  if (roll >= SPECIAL_RATE) {
    return [s2, { cells }];
  }
  const [s3, pick] = nextFloat(s2);
  const cellIndex = Math.min(3, Math.floor(pick * 4)) as 0 | 1 | 2 | 3;
  return [s3, { cells, special: { cellIndex } }];
}

/**
 * Refill the preview queue to depth `PREVIEW_DEPTH + 1` (head + the 3 shown),
 * drawing in the canonical order. Pure: returns a new state with the advanced
 * `rngState` and a longer `queue`.
 */
export function refillQueue(state: GameState): GameState {
  let rngState = state.rngState;
  const queue = state.queue.slice();
  while (queue.length < PREVIEW_DEPTH + 1) {
    const [next, gp] = generateNext(rngState);
    rngState = next;
    queue.push(gp);
  }
  return { ...state, rngState, queue };
}

/**
 * Spawn the head of the preview queue, then refill it. Replaces `spawnNext`'s
 * draw-one-on-spawn behaviour so the preview is truthful and the special is
 * decided at generation time. Falls back to a fresh draw if the queue is empty.
 */
export function spawnFromQueue(state: GameState): GameState {
  const filled = refillQueue(state);
  const queue = filled.queue.slice();
  const head = queue.shift();
  if (!head) return filled;
  const spawned = spawnGeneratedPiece({ ...filled, queue }, head);
  // Keep the preview topped up after consuming the head.
  return refillQueue(spawned);
}

/** Coordinate (`row*COLS+col`) of the cell at `cellIndex` for a piece at `pos`. */
function specialCoordFor(pos: PiecePos, cellIndex: 0 | 1 | 2 | 3): number {
  const row = pos.row + (cellIndex >= 2 ? 1 : 0);
  const col = pos.col + (cellIndex % 2 === 1 ? 1 : 0);
  return row * COLS + col;
}

/**
 * Place a generated piece (carrying any special decision) at spawn. On game over
 * the special is dropped with the piece.
 */
export function spawnGeneratedPiece(
  state: GameState,
  gp: GeneratedPiece,
): GameState {
  const pos: PiecePos = { row: SPAWN_ROW, col: SPAWN_COL };
  if (!canPlace(state.grid, gp.cells, pos)) {
    return { ...state, active: null, gameOver: true };
  }
  return { ...state, active: { cells: gp.cells, pos, special: gp.special } };
}

/** Can a piece with these cells legally occupy this top-left position? */
export function canPlace(grid: Grid, cells: Piece, pos: PiecePos): boolean {
  const probe: ActivePiece = { cells, pos };
  for (const { row, col } of pieceCells(probe)) {
    if (col < 0 || col >= grid[0]!.length) return false;
    if (row >= grid.length) return false;
    // Allow rows above the top (row < 0 won't happen for a 2x2 at row>=0).
    if (row >= 0 && grid[row]![col] !== null) return false;
  }
  return true;
}

/**
 * Place a new piece at the top-centre spawn position. If the spawn cells are
 * occupied, set gameOver and leave no active piece.
 */
export function spawnPiece(state: GameState, cells: Piece): GameState {
  const pos: PiecePos = { row: SPAWN_ROW, col: SPAWN_COL };
  if (!canPlace(state.grid, cells, pos)) {
    return { ...state, active: null, gameOver: true };
  }
  return { ...state, active: { cells, pos } };
}

/** Spawn the next RNG-drawn piece (used by the production loop). */
export function spawnNext(state: GameState): GameState {
  const [rngState, cells] = nextPiece(state.rngState);
  return spawnPiece({ ...state, rngState }, cells);
}

function movePiece(state: GameState, dCol: number): GameState {
  if (!state.active || state.gameOver) return state;
  const pos = { row: state.active.pos.row, col: state.active.pos.col + dCol };
  if (!canPlace(state.grid, state.active.cells, pos)) return state;
  return { ...state, active: { cells: state.active.cells, pos } };
}

export function moveLeft(state: GameState): GameState {
  return movePiece(state, -1);
}

export function moveRight(state: GameState): GameState {
  return movePiece(state, +1);
}

/** Rotate the 2x2 90° clockwise: [[a,b],[c,d]] -> [[c,a],[d,b]]. */
export function rotateCells(cells: Piece): Piece {
  const [[a, b], [c, d]] = cells;
  return [
    [c, a],
    [d, b],
  ];
}

export function rotateCW(state: GameState): GameState {
  if (!state.active || state.gameOver) return state;
  const rotated = rotateCells(state.active.cells);
  if (!canPlace(state.grid, rotated, state.active.pos)) return state;
  return { ...state, active: { cells: rotated, pos: state.active.pos } };
}

/** Can the active piece descend one row? */
function canDescend(state: GameState): boolean {
  if (!state.active) return false;
  const pos = { row: state.active.pos.row + 1, col: state.active.pos.col };
  return canPlace(state.grid, state.active.cells, pos);
}

/** Merge the active piece into the settled grid, then settle by gravity. */
export function lockPiece(state: GameState): GameState {
  if (!state.active) return state;
  const grid = cloneGrid(state.grid);
  for (const { row, col, color } of pieceCells(state.active)) {
    if (inBounds(row, col) && color !== null) grid[row]![col] = color;
  }

  // Record this piece's chain-special coordinate (if any) at its merged
  // position, then settle the grid and the specials set TOGETHER so a special
  // cell falls with its column. The special travels with the cell, not the slot.
  const specials = new Set(state.specials);
  if (state.active.special) {
    const coord = specialCoordFor(state.active.pos, state.active.special.cellIndex);
    const row = Math.floor(coord / COLS);
    const col = coord % COLS;
    if (inBounds(row, col)) specials.add(coord);
  }

  const settled = settleSpecials(grid, specials);
  return {
    ...state,
    grid: settled.grid,
    specials: settled.specials,
    active: null,
  };
}

/**
 * Settle every column by gravity, carrying chain-special markers down with the
 * exact cells they sit on. Returns the settled grid and the relocated specials
 * set. Per-column and order-independent in result; mirrors `settle()` but keeps
 * `specials` coordinates aligned to their cells after the fall.
 */
export function settleSpecials(
  grid: Grid,
  specials: Set<number>,
): { grid: Grid; specials: Set<number> } {
  const rows = grid.length;
  const out: Grid = grid.map((r) => r.map(() => null as Grid[number][number]));
  const newSpecials = new Set<number>();
  const cols = grid[0]!.length;
  for (let col = 0; col < cols; col++) {
    let writeRow = rows - 1;
    for (let row = rows - 1; row >= 0; row--) {
      const cell = grid[row]![col] ?? null;
      if (cell === null) continue;
      out[writeRow]![col] = cell;
      if (specials.has(row * cols + col)) {
        newSpecials.add(writeRow * cols + col);
      }
      writeRow--;
    }
  }
  return { grid: out, specials: newSpecials };
}

/**
 * Advance one gravity step. Returns the new state and whether the piece locked.
 * In test mode the controller calls this and never auto-spawns.
 */
export function gravityStep(state: GameState): {
  state: GameState;
  locked: boolean;
} {
  if (!state.active || state.gameOver) return { state, locked: false };
  if (canDescend(state)) {
    const pos = { row: state.active.pos.row + 1, col: state.active.pos.col };
    return {
      state: { ...state, active: { cells: state.active.cells, pos } },
      locked: false,
    };
  }
  return { state: lockPiece(state), locked: true };
}

/**
 * Soft drop: one extra gravity step. When the piece actually descends a row
 * (i.e. it did not lock), award +1 point per the soft-drop scoring rule. A step
 * that locks the piece (it could not descend) scores nothing for that step.
 */
export function softDrop(state: GameState): {
  state: GameState;
  locked: boolean;
} {
  const result = gravityStep(state);
  if (!result.locked) {
    return { state: { ...result.state, score: result.state.score + 1 }, locked: false };
  }
  return result;
}

/** Hard drop: descend to the lowest legal row, then lock immediately. */
export function hardDrop(state: GameState): GameState {
  if (!state.active || state.gameOver) return state;
  let active = state.active;
  while (
    canPlace(state.grid, active.cells, {
      row: active.pos.row + 1,
      col: active.pos.col,
    })
  ) {
    active = {
      cells: active.cells,
      pos: { row: active.pos.row + 1, col: active.pos.col },
    };
  }
  return lockPiece({ ...state, active });
}

/** Is the active piece currently resting (cannot descend)? */
export function isResting(state: GameState): boolean {
  return state.active !== null && !canDescend(state);
}
