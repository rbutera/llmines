import { cloneGrid, createGrid } from "./grid";
import { markedCells } from "./marking";
import {
  collides,
  lockPiece,
  pieceCells,
  spawnPiece,
  tryFall,
  tryMove,
  tryRotate,
} from "./piece";
import { advanceSweep, sweepNowDraft } from "./sweep";
import { randomPiece, seedRng } from "./rng";
import type {
  ActivePiece,
  GameState,
  Grid,
  MarkedCell,
  Piece,
} from "./types";

const DEFAULT_SEED = 0x1234567;

export function createInitialState(seed = DEFAULT_SEED): GameState {
  return {
    phase: "start",
    grid: createGrid(),
    active: null,
    score: 0,
    gameOver: false,
    sweepX: 0,
    rngState: seedRng(seed),
    sweepCleared: [],
    sweepMarkSnapshot: null,
  };
}

/** Shallow-clone the state with a deep-copied grid and fresh arrays. */
function draft(state: GameState): GameState {
  return {
    ...state,
    grid: cloneGrid(state.grid),
    active: state.active ? { ...state.active, cells: cloneCells(state.active.cells) } : null,
    sweepCleared: state.sweepCleared.slice(),
    sweepMarkSnapshot: state.sweepMarkSnapshot
      ? state.sweepMarkSnapshot.slice()
      : null,
  };
}

function cloneCells(cells: Piece): Piece {
  return [
    [cells[0][0], cells[0][1]],
    [cells[1][0], cells[1][1]],
  ];
}

/** Grid as rendered: settled cells with the active piece overlaid. */
export function renderGrid(state: GameState): Grid {
  const g = cloneGrid(state.grid);
  if (state.active) {
    for (const { row, col, color } of pieceCells(state.active)) {
      const gridRow = g[row];
      if (gridRow && col >= 0 && col < gridRow.length) gridRow[col] = color;
    }
  }
  return g;
}

export function marked(state: GameState): MarkedCell[] {
  return markedCells(state.grid);
}

// --- RNG-driven piece generation ---------------------------------------------

export function nextPiece(state: GameState): { state: GameState; piece: Piece } {
  const { state: rngState, piece } = randomPiece(state.rngState);
  return { state: { ...state, rngState }, piece };
}

// --- Lifecycle ---------------------------------------------------------------

export function seed(state: GameState, n: number): GameState {
  return { ...state, rngState: seedRng(n) };
}

/**
 * Place a piece at the spawn position. If one is already falling it is locked
 * first. If the spawn cells are occupied, the game ends.
 */
export function placePiece(state: GameState, piece: Piece): GameState {
  const next = draft(state);
  if (next.active) {
    next.grid = lockPiece(next.grid, next.active);
    next.active = null;
  }
  const candidate: ActivePiece = spawnPiece(piece);
  if (collides(next.grid, candidate)) {
    next.active = null;
    next.phase = "gameover";
    next.gameOver = true;
    return next;
  }
  next.active = candidate;
  if (next.phase === "start") next.phase = "playing";
  return next;
}

/** Production helper: spawn the next RNG piece; ends the game if blocked. */
export function spawnNext(state: GameState): GameState {
  const { state: s, piece } = nextPiece(state);
  return placePiece(s, piece);
}

// --- Controls ----------------------------------------------------------------

export function moveLeft(state: GameState): GameState {
  if (!state.active) return state;
  const moved = tryMove(state.grid, state.active, -1);
  return moved ? { ...state, active: moved } : state;
}

export function moveRight(state: GameState): GameState {
  if (!state.active) return state;
  const moved = tryMove(state.grid, state.active, +1);
  return moved ? { ...state, active: moved } : state;
}

export function rotate(state: GameState): GameState {
  if (!state.active) return state;
  const rotated = tryRotate(state.grid, state.active);
  return rotated ? { ...state, active: rotated } : state;
}

/**
 * Advance one gravity step: move the active piece down, or lock it if it cannot
 * fall. NEVER auto-spawns (production auto-spawn is the driver's job).
 */
export function stepGravity(state: GameState): GameState {
  if (!state.active) return state;
  const fell = tryFall(state.grid, state.active);
  if (fell) return { ...state, active: fell };
  // lock
  const next = draft(state);
  next.grid = lockPiece(next.grid, next.active!);
  next.active = null;
  return next;
}

/** Drop the piece to its resting place and lock immediately. */
export function hardDrop(state: GameState): GameState {
  if (!state.active) return state;
  let piece: ActivePiece = state.active;
  for (;;) {
    const fell = tryFall(state.grid, piece);
    if (!fell) break;
    piece = fell;
  }
  const next = draft(state);
  next.grid = lockPiece(next.grid, piece);
  next.active = null;
  return next;
}

// --- Sweep -------------------------------------------------------------------

export function sweepProgress(state: GameState, dtMs: number): GameState {
  const next = draft(state);
  advanceSweep(next, dtMs);
  return next;
}

export function sweepNow(state: GameState): GameState {
  const next = draft(state);
  sweepNowDraft(next);
  return next;
}

// --- Restart -----------------------------------------------------------------

export function restart(seedValue = DEFAULT_SEED): GameState {
  const fresh = createInitialState(seedValue);
  fresh.phase = "playing";
  return fresh;
}
