// GameEngine orchestrator for LLMines.
//
// The engine owns a single mutable `GameState` and delegates every transition
// to the pure functions in the game core (`rules`, `sweep`). It imports nothing
// from React or PixiJS, so it stays fully unit-testable and shared verbatim
// between the host game loop and the Test_Mode interface (Req 16.3, 17).
//
// All mutation is confined to reassigning the single `state` reference; the pure
// functions never mutate their inputs, so each snapshot returned by `getState`
// stays valid even after subsequent transitions.

import { COLS, ROWS } from "~/game/constants";
import { blockCells, cloneGrid, emptyGrid } from "~/game/grid";
import { seed as rngSeed } from "~/game/rng";
import {
  gravityStep,
  hardDrop,
  lock,
  move,
  rotate,
  spawnPiece,
  spawnRandom,
} from "~/game/rules";
import { fullSweep, sweepProgress, type SweepResult } from "~/game/sweep";
import type { GameState, Grid, Piece } from "~/game/types";

export type { SweepResult } from "~/game/sweep";

/**
 * Imperative-friendly orchestrator over the pure game core. Each method either
 * reads the current snapshot or applies one pure transition, reassigning the
 * engine's single `GameState`.
 */
export interface GameEngine {
  /** Current immutable snapshot of the game state (read-only). */
  getState(): GameState;
  /** Reseed the RNG: `state.rngState = rngSeed(n)` (Req 18.1). */
  seed(n: number): void;
  /**
   * Reset to a fresh game: empty grid, no active block, all-false marked matrix,
   * score 0, not game over, sweepX 0, soft-drop off. The current `rngState` is
   * preserved so a prior `seed()` persists across a restart (Req 7.2, 9.3, 11.2).
   */
  startNewGame(): void;
  /** Draw a random piece and spawn it at the Spawn_Position (Req 2). */
  spawnRandom(): void;
  /**
   * Spawn `p` at the Spawn_Position. If a block is mid-fall it is locked into
   * the Stack first, so consecutive calls stack deterministically (Req 18.2,
   * 18.3, 18.4).
   */
  spawnPiece(p: Piece): void;
  /** Shift the active block one column left (Req 4.1). */
  moveLeft(): void;
  /** Shift the active block one column right (Req 4.2). */
  moveRight(): void;
  /** Toggle the soft-drop flag (Req 4.3). */
  setSoftDrop(on: boolean): void;
  /** Rotate the active block 90 degrees clockwise (Req 4.4). */
  rotate(): void;
  /** Hard-drop the active block to its lowest legal row and lock it (Req 4.5). */
  hardDrop(): void;
  /**
   * Advance one gravity tick: move down or lock. Never auto-spawns a new block,
   * so the field stays quiescent after a lock until `spawn*` is called (Req 19.2).
   */
  gravityStep(): void;
  /** Perform one full sweep traversal and return the aggregate result (Req 6, 7, 8). */
  fullSweep(): SweepResult;
  /** Advance the Timeline_Bar by `dtMs`, deleting any crossed columns (Req 19.4). */
  sweepProgress(dtMs: number): SweepResult;
  /** Composite grid: the settled Stack with the active block overlaid (Req 17.2). */
  compositeGrid(): Grid;
}

/**
 * Build a fresh `GameState`: an empty Stack, no active block, an all-false
 * ROWS x COLS marked matrix, zero score, not game over, the bar at 0, soft-drop
 * off, and the RNG seeded from `seedValue` (defaulting to 0).
 */
function buildInitialState(seedValue: number): GameState {
  const marked: boolean[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const rowFlags: boolean[] = [];
    for (let c = 0; c < COLS; c++) {
      rowFlags.push(false);
    }
    marked.push(rowFlags);
  }
  return {
    grid: emptyGrid(),
    active: null,
    marked,
    score: 0,
    gameOver: false,
    sweepX: 0,
    softDrop: false,
    rngState: rngSeed(seedValue),
  };
}

/**
 * Pure helper: return the composite grid for `state` — a clone of the settled
 * Stack with the active block's four footprint cells overlaid. The result is a
 * ROWS x COLS grid addressed `[row][col]`, row 0 at the top (Req 17.1, 17.2).
 *
 * Exposed standalone so it can be unit-tested directly; the engine's
 * `compositeGrid()` method simply calls it with the current state.
 */
export function compositeGrid(state: GameState): Grid {
  const grid = cloneGrid(state.grid);
  if (state.active !== null) {
    for (const { row, col, color } of blockCells(state.active)) {
      const gridRow = grid[row];
      if (gridRow !== undefined && col >= 0 && col < gridRow.length) {
        gridRow[col] = color;
      }
    }
  }
  return grid;
}

/**
 * Create a {@link GameEngine}. When `initialSeed` is provided the RNG is seeded
 * with it and that seed is also remembered as the reseed target for
 * `startNewGame()`; otherwise the engine starts from seed 0 and `startNewGame()`
 * preserves whatever seed was set via `seed()`.
 */
export function createEngine(initialSeed?: number): GameEngine {
  let state: GameState = buildInitialState(initialSeed ?? 0);
  // When an explicit initial seed is given, restarts reseed to it; otherwise the
  // current rngState is preserved across restart (so a later seed() persists).
  const reseedOnRestart = initialSeed;

  return {
    getState(): GameState {
      return state;
    },
    seed(n: number): void {
      state = { ...state, rngState: rngSeed(n) };
    },
    startNewGame(): void {
      const fresh = buildInitialState(0);
      // Reseed to the explicit initial seed when one was given at create-time;
      // otherwise preserve the current rngState so a prior seed() persists.
      state =
        reseedOnRestart !== undefined
          ? { ...fresh, rngState: rngSeed(reseedOnRestart) }
          : { ...fresh, rngState: state.rngState };
    },
    spawnRandom(): void {
      state = spawnRandom(state);
    },
    spawnPiece(p: Piece): void {
      // Mid-fall: lock the existing block into the Stack first, then spawn
      // (Req 18.3/18.4). Otherwise spawn directly.
      state = state.active !== null ? spawnPiece(lock(state), p) : spawnPiece(state, p);
    },
    moveLeft(): void {
      state = move(state, -1);
    },
    moveRight(): void {
      state = move(state, +1);
    },
    setSoftDrop(on: boolean): void {
      state = { ...state, softDrop: on };
    },
    rotate(): void {
      state = rotate(state);
    },
    hardDrop(): void {
      state = hardDrop(state);
    },
    gravityStep(): void {
      state = gravityStep(state);
    },
    fullSweep(): SweepResult {
      const { state: next, deletedCells, distinctSquares, scoreDelta } =
        fullSweep(state);
      state = next;
      return { deletedCells, distinctSquares, scoreDelta };
    },
    sweepProgress(dtMs: number): SweepResult {
      const { state: next, deletedCells, distinctSquares, scoreDelta } =
        sweepProgress(state, dtMs);
      state = next;
      return { deletedCells, distinctSquares, scoreDelta };
    },
    compositeGrid(): Grid {
      return compositeGrid(state);
    },
  };
}
