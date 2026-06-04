import { SPAWN_COL, SPAWN_ROW } from "../constants";
import { cloneGrid, inBounds } from "./grid";
import type { ActivePiece, Grid, Piece } from "./types";

/** Absolute (row, col) of each of the 4 sub-cells of a placed piece. */
export function pieceCells(
  piece: ActivePiece,
): { row: number; col: number; color: 0 | 1 }[] {
  const { cells, row, col } = piece;
  return [
    { row: row, col: col, color: cells[0][0] },
    { row: row, col: col + 1, color: cells[0][1] },
    { row: row + 1, col: col, color: cells[1][0] },
    { row: row + 1, col: col + 1, color: cells[1][1] },
  ];
}

/** True if the piece at its current position collides with walls/floor/stack. */
export function collides(grid: Grid, piece: ActivePiece): boolean {
  for (const { row, col } of pieceCells(piece)) {
    if (!inBounds(row, col)) return true;
    if (grid[row]![col] !== null) return true;
  }
  return false;
}

export function spawnPiece(cells: Piece): ActivePiece {
  return { cells, row: SPAWN_ROW, col: SPAWN_COL };
}

/** Try to shift the piece horizontally; returns the moved piece or null if blocked. */
export function tryMove(
  grid: Grid,
  piece: ActivePiece,
  dCol: number,
): ActivePiece | null {
  const moved: ActivePiece = { ...piece, col: piece.col + dCol };
  return collides(grid, moved) ? null : moved;
}

/** Try to move the piece down one row; null if it cannot fall further. */
export function tryFall(grid: Grid, piece: ActivePiece): ActivePiece | null {
  const moved: ActivePiece = { ...piece, row: piece.row + 1 };
  return collides(grid, moved) ? null : moved;
}

/** Rotate the 2x2 colour matrix 90 degrees clockwise. */
export function rotateCells(cells: Piece): Piece {
  const tl = cells[0][0];
  const tr = cells[0][1];
  const bl = cells[1][0];
  const br = cells[1][1];
  // CW: top-left<-bottom-left, top-right<-top-left, bottom-right<-top-right, bottom-left<-bottom-right
  return [
    [bl, tl],
    [br, tr],
  ];
}

/** Try to rotate in place (no wall-kick); null if the result does not fit. */
export function tryRotate(grid: Grid, piece: ActivePiece): ActivePiece | null {
  const rotated: ActivePiece = { ...piece, cells: rotateCells(piece.cells) };
  return collides(grid, rotated) ? null : rotated;
}

/** Write the piece's 4 cells into a fresh grid copy (lock). */
export function lockPiece(grid: Grid, piece: ActivePiece): Grid {
  const next = cloneGrid(grid);
  for (const { row, col, color } of pieceCells(piece)) {
    if (inBounds(row, col)) next[row]![col] = color;
  }
  return next;
}
