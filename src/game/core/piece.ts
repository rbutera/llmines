import { NEW_BLOCK_HOLD_MS, SPAWN_COL, SPAWN_ROW } from "./constants";
import { cloneGrid, inBounds, pieceCells, settle } from "./grid";
import { nextBit } from "./rng";
import type { ActivePiece, GameState, Grid, Piece, PiecePos } from "./types";

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
    return {
      ...state,
      active: null,
      gameOver: true,
      hold: { active: false, remainingMs: 0 },
    };
  }
  // Arm the new-block hold: the piece pauses at the top for one beat before
  // auto-gravity begins (a fresh drop press ends it early).
  return {
    ...state,
    active: { cells, pos },
    hold: { active: true, remainingMs: NEW_BLOCK_HOLD_MS },
  };
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
  // Clear the hold; the next spawn re-arms it for the next piece.
  return {
    ...state,
    grid: settle(grid),
    active: null,
    hold: { active: false, remainingMs: 0 },
  };
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

/** Soft drop: one extra gravity step (same semantics, faster cadence). */
export function softDrop(state: GameState): {
  state: GameState;
  locked: boolean;
} {
  return gravityStep(state);
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
