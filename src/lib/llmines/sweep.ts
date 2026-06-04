import { COLUMN_SWEEP_MS, GRID_COLUMNS, SWEEP_PERIOD_MS } from "./constants";
import { applyColumnGravity, cloneGrid } from "./grid";
import { calculateSweepScore } from "./scoring";
import { detectSquares } from "./square-detection";
import type { ClearEvent, GameState } from "./types";

export function sweepXFromElapsedMs(elapsedMs: number) {
  if (elapsedMs <= 0) return 0;
  const wrapped = elapsedMs % SWEEP_PERIOD_MS;
  if (wrapped === 0 && elapsedMs > 0) return GRID_COLUMNS;
  return wrapped / COLUMN_SWEEP_MS;
}

export function runFullSweep(state: GameState, at = Date.now()): GameState {
  const squares = detectSquares(state.grid);
  const marked = new Map<string, { row: number; col: number }>();
  for (const square of squares) {
    for (const cell of square.cells) {
      marked.set(`${cell.row}:${cell.col}`, cell);
    }
  }

  if (marked.size === 0) {
    return {
      ...state,
      sweep: {
        x: 0,
        deletedCellsThisSweep: 0,
        clearedSquareKeysThisSweep: [],
        lastPassedColumns: Array.from(
          { length: GRID_COLUMNS },
          (_, col) => col,
        ),
      },
      lastClears: [],
      lastCollapses: [],
    };
  }

  const nextGrid = cloneGrid(state.grid);
  const clears: ClearEvent[] = [];

  for (const cell of marked.values()) {
    const color = nextGrid[cell.row]?.[cell.col] ?? null;
    if (color !== null) {
      clears.push({ row: cell.row, col: cell.col, color, at });
      nextGrid[cell.row]![cell.col] = null;
    }
  }

  const gravity = applyColumnGravity(nextGrid, at);
  const scoreDelta = calculateSweepScore(clears.length, squares.length);

  return {
    ...state,
    grid: gravity.grid,
    score: state.score + scoreDelta,
    sweep: {
      x: 0,
      deletedCellsThisSweep: clears.length,
      clearedSquareKeysThisSweep: squares.map((square) => square.key),
      lastPassedColumns: Array.from({ length: GRID_COLUMNS }, (_, col) => col),
    },
    lastClears: clears,
    lastCollapses: gravity.collapses,
  };
}

export function advanceSweepProgress(
  state: GameState,
  dtMs: number,
  at = Date.now(),
): GameState {
  if (dtMs <= 0) return state;

  const oldX = state.sweep.x >= GRID_COLUMNS ? 0 : state.sweep.x;
  const rawX = oldX + dtMs / COLUMN_SWEEP_MS;

  if (rawX >= GRID_COLUMNS) {
    const swept = runFullSweep(state, at);
    const overflowColumns = rawX - GRID_COLUMNS;
    return {
      ...swept,
      sweep: {
        ...swept.sweep,
        x:
          overflowColumns === 0 ? GRID_COLUMNS : overflowColumns % GRID_COLUMNS,
      },
    };
  }

  return {
    ...state,
    sweep: {
      ...state.sweep,
      x: rawX,
      lastPassedColumns: columnsBetween(oldX, rawX),
    },
  };
}

function columnsBetween(fromX: number, toX: number) {
  const cols: number[] = [];
  for (let col = Math.floor(fromX); col < Math.floor(toX); col += 1) {
    if (col >= 0 && col < GRID_COLUMNS) cols.push(col);
  }
  return cols;
}
