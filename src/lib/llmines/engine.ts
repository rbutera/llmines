import { SPAWN_COL, SPAWN_ROW } from "./constants";
import {
  applyColumnGravity,
  canPlacePiece,
  createEmptyGrid,
  lockPiece,
  overlayActivePiece,
} from "./grid";
import { rotatePieceClockwise } from "./piece";
import { normalizeSeed, randomPiece } from "./rng";
import { markedCellsFromSquares, detectSquares } from "./square-detection";
import { advanceSweepProgress, runFullSweep } from "./sweep";
import type {
  ActivePiece,
  EngineOptions,
  GameState,
  Grid,
  InputCommand,
  Piece,
} from "./types";

const DEFAULT_OPTIONS: EngineOptions = { autoSpawn: true };

export function createInitialState(seed = 1): GameState {
  return {
    grid: createEmptyGrid(),
    activePiece: null,
    score: 0,
    gameOver: false,
    sweep: {
      x: 0,
      deletedCellsThisSweep: 0,
      clearedSquareKeysThisSweep: [],
      lastPassedColumns: [],
    },
    rngSeed: normalizeSeed(seed),
    lastClears: [],
    lastCollapses: [],
  };
}

export function startRound(seed = 1): GameState {
  return spawnRandomPiece(createInitialState(seed), { autoSpawn: true });
}

export function restartRound(seed = 1): GameState {
  return startRound(seed);
}

export function setSeed(state: GameState, seed: number): GameState {
  return { ...state, rngSeed: normalizeSeed(seed) };
}

export function spawnRandomPiece(
  state: GameState,
  options: EngineOptions = DEFAULT_OPTIONS,
): GameState {
  const generated = randomPiece(state.rngSeed);
  return spawnPiece(
    { ...state, rngSeed: generated.seed },
    generated.piece,
    options,
  );
}

export function spawnPiece(
  state: GameState,
  piece: Piece,
  options: EngineOptions = DEFAULT_OPTIONS,
): GameState {
  const base = state.activePiece ? lockActivePiece(state, options) : state;
  if (base.gameOver) return base;

  const activePiece: ActivePiece = {
    piece,
    row: SPAWN_ROW,
    col: SPAWN_COL,
  };

  if (!canPlacePiece(base.grid, activePiece)) {
    return {
      ...base,
      activePiece: null,
      gameOver: true,
    };
  }

  return {
    ...base,
    activePiece,
    gameOver: false,
  };
}

export function movePiece(
  state: GameState,
  deltaCol: number,
  deltaRow = 0,
): GameState {
  if (!state.activePiece || state.gameOver) return state;
  const candidate = {
    ...state.activePiece,
    row: state.activePiece.row + deltaRow,
    col: state.activePiece.col + deltaCol,
  };
  if (!canPlacePiece(state.grid, candidate)) return state;
  return { ...state, activePiece: candidate };
}

export function rotateActivePiece(state: GameState): GameState {
  if (!state.activePiece || state.gameOver) return state;
  const candidate = {
    ...state.activePiece,
    piece: rotatePieceClockwise(state.activePiece.piece),
  };
  if (!canPlacePiece(state.grid, candidate)) return state;
  return { ...state, activePiece: candidate };
}

export function tick(
  state: GameState,
  options: EngineOptions = DEFAULT_OPTIONS,
): GameState {
  if (!state.activePiece || state.gameOver) return state;
  const moved = movePiece(state, 0, 1);
  if (moved !== state) return moved;
  return lockActivePiece(state, options);
}

export function hardDrop(
  state: GameState,
  options: EngineOptions = DEFAULT_OPTIONS,
): GameState {
  if (!state.activePiece || state.gameOver) return state;
  let next = state;
  while (next.activePiece) {
    const moved = movePiece(next, 0, 1);
    if (moved === next) break;
    next = moved;
  }
  return lockActivePiece(next, options);
}

export function applyCommand(
  state: GameState,
  command: InputCommand,
  options: EngineOptions = DEFAULT_OPTIONS,
): GameState {
  switch (command) {
    case "left":
      return movePiece(state, -1);
    case "right":
      return movePiece(state, 1);
    case "softDrop":
      return tick(state, options);
    case "rotate":
      return rotateActivePiece(state);
    case "hardDrop":
      return hardDrop(state, options);
  }
}

export function lockActivePiece(
  state: GameState,
  options: EngineOptions = DEFAULT_OPTIONS,
): GameState {
  if (!state.activePiece) return state;
  const locked = {
    ...state,
    grid: lockPiece(state.grid, state.activePiece),
    activePiece: null,
  };

  if (!options.autoSpawn) return locked;
  return spawnRandomPiece(locked, options);
}

export function visibleGrid(state: GameState): Grid {
  return overlayActivePiece(state.grid, state.activePiece);
}

export function markedCells(state: GameState) {
  return markedCellsFromSquares(detectSquares(state.grid));
}

export function sweepNow(state: GameState): GameState {
  return runFullSweep(state);
}

export function sweepProgress(state: GameState, dtMs: number): GameState {
  return advanceSweepProgress(state, dtMs);
}

export function forceColumnGravity(state: GameState): GameState {
  const gravity = applyColumnGravity(state.grid);
  return {
    ...state,
    grid: gravity.grid,
    lastCollapses: gravity.collapses,
  };
}
