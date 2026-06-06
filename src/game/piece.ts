import { GRID_COLS, GRID_ROWS, SPAWN_COL, SPAWN_ROW } from "./constants";
import type { ActivePiece, GameState, Grid, PieceDef } from "./types";

/** Spawn a random piece at the spawn position. */
export function spawnPiece(rng: () => number): ActivePiece {
  const cells: PieceDef = [
    [rng() < 0.5 ? 0 : 1, rng() < 0.5 ? 0 : 1],
    [rng() < 0.5 ? 0 : 1, rng() < 0.5 ? 0 : 1],
  ];
  return { cells, row: SPAWN_ROW, col: SPAWN_COL };
}

/** Spawn a specific piece (for test mode). */
export function spawnSpecificPiece(piece: PieceDef): ActivePiece {
  return { cells: piece, row: SPAWN_ROW, col: SPAWN_COL };
}

/** Check if a piece can be placed at a given position. */
export function canPlace(
  grid: Grid,
  cells: PieceDef,
  row: number,
  col: number,
): boolean {
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const gr = row + r;
      const gc = col + c;
      // Bounds check
      if (gr < 0 || gr >= GRID_ROWS || gc < 0 || gc >= GRID_COLS) {
        return false;
      }
      // Collision check
      if (grid[gr]![gc] !== null) {
        return false;
      }
    }
  }
  return true;
}

/** Rotate piece 90° clockwise. */
export function rotateCW(cells: PieceDef): PieceDef {
  // Original: [tl, tr]   Rotated: [bl, tl]
  //           [bl, br]             [br, tr]
  const [top, bottom] = cells;
  return [
    [bottom[0], top[0]],
    [bottom[1], top[1]],
  ];
}

/** Try to move piece left. Returns new piece or null if blocked. */
export function moveLeft(
  grid: Grid,
  piece: ActivePiece,
): ActivePiece | null {
  const newCol = piece.col - 1;
  if (canPlace(grid, piece.cells, piece.row, newCol)) {
    return { ...piece, col: newCol };
  }
  return null;
}

/** Try to move piece right. Returns new piece or null if blocked. */
export function moveRight(
  grid: Grid,
  piece: ActivePiece,
): ActivePiece | null {
  const newCol = piece.col + 1;
  if (canPlace(grid, piece.cells, piece.row, newCol)) {
    return { ...piece, col: newCol };
  }
  return null;
}

/** Try to move piece down. Returns new piece or null if blocked. */
export function moveDown(
  grid: Grid,
  piece: ActivePiece,
): ActivePiece | null {
  const newRow = piece.row + 1;
  if (canPlace(grid, piece.cells, piece.row + 1, piece.col)) {
    return { ...piece, row: newRow };
  }
  return null;
}

/** Hard drop: find lowest valid row. */
export function hardDrop(
  grid: Grid,
  piece: ActivePiece,
): ActivePiece {
  let row = piece.row;
  while (canPlace(grid, piece.cells, row + 1, piece.col)) {
    row++;
  }
  return { ...piece, row };
}

/** Try to rotate piece. Returns new piece or null if blocked. */
export function tryRotate(
  grid: Grid,
  piece: ActivePiece,
): ActivePiece | null {
  const newCells = rotateCW(piece.cells);
  if (canPlace(grid, newCells, piece.row, piece.col)) {
    return { ...piece, cells: newCells };
  }
  return null;
}

/** Check if spawning would trigger game over. */
export function checkGameOver(state: GameState): boolean {
  if (!state.activePiece) return false;
  return !canPlace(
    state.grid,
    state.activePiece.cells,
    state.activePiece.row,
    state.activePiece.col,
  );
}
