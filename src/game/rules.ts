// Game rules for LLMines: legality checks, spawning, gravity, movement,
// rotation, and hard drop.
//
// This module is part of the pure game core: it imports nothing from React or
// PixiJS. Every rule is a pure function over immutable state. Later tasks add
// more functions to this file (spawning, gravity, movement, rotation, hard
// drop); for now it holds the core placement-legality check used by all of
// them.

import { SPAWN_COLS, SPAWN_ROWS } from "~/game/constants";
import { blockCells, cloneGrid, inBounds, isOccupied } from "~/game/grid";
import { randomPiece, rotatePiece } from "~/game/piece";
import { detectMarked } from "~/game/squares";
import type { ActiveBlock, GameState, Grid, Piece } from "~/game/types";

/**
 * True iff `block` can legally occupy its current position: all four footprint
 * cells are within the Playfield bounds AND none overlaps an occupied Stack
 * cell in `grid` (Req 3.1, 4.7). This is the core legality check used by
 * movement, rotation, spawn, and gravity.
 */
export function canPlace(grid: Grid, block: ActiveBlock): boolean {
  for (const { row, col } of blockCells(block)) {
    if (!inBounds(row, col)) {
      return false;
    }
    if (isOccupied(grid, row, col)) {
      return false;
    }
  }
  return true;
}

/**
 * True iff any of the four Spawn_Position cells (columns 7-8, rows 0-1) is
 * occupied by a Stack cell in `grid`. When true, a newly spawned block cannot
 * be placed and the game ends (Req 9.1).
 */
function spawnRegionBlocked(grid: Grid): boolean {
  for (const row of SPAWN_ROWS) {
    for (const col of SPAWN_COLS) {
      if (isOccupied(grid, row, col)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Place `piece` as the Active_Block at the Spawn_Position: top-left at
 * `(SPAWN_ROWS[0], SPAWN_COLS[0])` = `(0, 7)`, occupying columns 7-8, rows 0-1
 * (Req 2.1, 18.2). Pure: returns a new state and never mutates `state`.
 *
 * Game-over rule (Req 9.1): if any of the four spawn cells is already occupied
 * by a Stack cell, the returned state has `gameOver = true` and `active = null`
 * (no block is placed). The Stack and `marked` are preserved unchanged.
 * Otherwise the returned state has the new Active_Block and `gameOver = false`.
 */
export function spawnPiece(state: GameState, piece: Piece): GameState {
  if (spawnRegionBlocked(state.grid)) {
    return {
      ...state,
      grid: cloneGrid(state.grid),
      active: null,
      gameOver: true,
    };
  }
  const active: ActiveBlock = {
    piece,
    row: SPAWN_ROWS[0],
    col: SPAWN_COLS[0],
  };
  return {
    ...state,
    grid: cloneGrid(state.grid),
    active,
    gameOver: false,
  };
}

/**
 * Draw a random {@link Piece} from the seeded RNG (Req 2.2), thread the advanced
 * `rngState` onto the returned state, then place the piece exactly like
 * {@link spawnPiece} (same Spawn_Position and game-over rule). Pure: returns a
 * new state and never mutates `state`.
 *
 * The RNG always advances (the piece is always drawn) even when the spawn
 * region is blocked, so determinism does not depend on the game-over outcome.
 */
export function spawnRandom(state: GameState): GameState {
  const { piece, rngState } = randomPiece(state.rngState);
  const withPiece: GameState = { ...state, rngState };
  return spawnPiece(withPiece, piece);
}

/**
 * Lock the Active_Block into the Stack (Req 3.3). Writes each of the block's
 * four footprint cells into a fresh copy of the grid (each Stack cell takes the
 * colour of the corresponding block cell), clears `active`, and recomputes
 * `marked` from the new grid so the marked designation stays consistent with
 * the settled Stack (Req 5). All other fields (score, sweepX, gameOver,
 * rngState, softDrop) are preserved.
 *
 * If there is no Active_Block, the state is returned with a cloned grid and no
 * other change (a no-op lock). Pure: never mutates `state`.
 */
export function lock(state: GameState): GameState {
  const { active } = state;
  if (active === null) {
    return { ...state, grid: cloneGrid(state.grid) };
  }
  const grid = cloneGrid(state.grid);
  for (const { row, col, color } of blockCells(active)) {
    const gridRow = grid[row];
    if (gridRow !== undefined && col >= 0 && col < gridRow.length) {
      gridRow[col] = color;
    }
  }
  return {
    ...state,
    grid,
    active: null,
    marked: detectMarked(grid),
  };
}

/**
 * Advance the Active_Block by one Gravity_Tick (Req 3.1, 3.2).
 *
 * If there is no Active_Block, the state is returned unchanged. Otherwise the
 * block is tentatively moved down one row: if that destination is legal (in
 * bounds and not overlapping the Stack), the returned state has the block moved
 * down (Req 3.1). If the block cannot move down — blocked by the floor or by
 * Stack cells — it is locked into the Stack via {@link lock} (Req 3.2).
 *
 * Pure: never mutates `state`.
 */
export function gravityStep(state: GameState): GameState {
  const { active } = state;
  if (active === null) {
    return state;
  }
  const moved: ActiveBlock = { ...active, row: active.row + 1 };
  if (canPlace(state.grid, moved)) {
    return { ...state, active: moved };
  }
  return lock(state);
}

/**
 * Shift the Active_Block horizontally by `dCol` columns (Req 4.1, 4.2, 4.7).
 *
 * If there is no Active_Block, or the destination is not legal (would leave the
 * Playfield or overlap Stack cells), the state is returned unchanged (a no-op).
 * Otherwise the returned state has the block shifted by `dCol`.
 *
 * Pure: never mutates `state`.
 */
export function move(state: GameState, dCol: number): GameState {
  const { active } = state;
  if (active === null) {
    return state;
  }
  const dest: ActiveBlock = { ...active, col: active.col + dCol };
  if (canPlace(state.grid, dest)) {
    return { ...state, active: dest };
  }
  return state;
}

/**
 * Rotate the Active_Block's piece 90 degrees clockwise, keeping the same row
 * and column (Req 4.4, 4.7). No wall-kicks are applied.
 *
 * If there is no Active_Block, or the rotated orientation is not legal (would
 * leave the Playfield or overlap Stack cells), the state is returned unchanged
 * (a no-op). Otherwise the returned state has the rotated block.
 *
 * Pure: never mutates `state`.
 */
export function rotate(state: GameState): GameState {
  const { active } = state;
  if (active === null) {
    return state;
  }
  const rotated: ActiveBlock = { ...active, piece: rotatePiece(active.piece) };
  if (canPlace(state.grid, rotated)) {
    return { ...state, active: rotated };
  }
  return state;
}

/**
 * Compute the lowest row value the block's top cells can occupy such that
 * {@link canPlace} still holds — i.e. how far down the block can legally drop
 * (Req 4.5). Scans downward from `block.row`, stopping at the last row before a
 * move down would become illegal (blocked by the floor or Stack cells).
 *
 * Pure: never mutates `grid` or `block`.
 */
export function lowestLegalRow(grid: Grid, block: ActiveBlock): number {
  let row = block.row;
  while (canPlace(grid, { ...block, row: row + 1 })) {
    row++;
  }
  return row;
}

/**
 * Hard-drop the Active_Block: move it straight down to its lowest legal row and
 * Lock it immediately (Req 4.5). The returned state has `active = null`, the
 * Stack updated with the block's colours, and `marked` recomputed.
 *
 * If there is no Active_Block, the state is returned unchanged. Pure: never
 * mutates `state`.
 */
export function hardDrop(state: GameState): GameState {
  const { active } = state;
  if (active === null) {
    return state;
  }
  const row = lowestLegalRow(state.grid, active);
  const dropped: ActiveBlock = { ...active, row };
  return lock({ ...state, active: dropped });
}
