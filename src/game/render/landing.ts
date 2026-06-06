import { ROWS, type ActivePiece, type Grid } from "../core";

function firstOccupiedRowBelow(grid: Grid, row: number, col: number): number {
  for (let r = row + 1; r < ROWS; r++) {
    if ((grid[r]![col] ?? null) !== null) return r;
  }
  return ROWS;
}

/**
 * Clamp active-piece interpolation to the space it can legally travel before
 * touching the floor or settled stack. This keeps rendering bounded without
 * changing core lock semantics.
 */
export function boundedActivePieceYOffset(
  grid: Grid,
  active: ActivePiece,
  requestedPx: number,
  cellPx: number,
): number {
  const { pos } = active;
  let maxPx = Number.POSITIVE_INFINITY;
  const coords = [
    { row: pos.row, col: pos.col },
    { row: pos.row, col: pos.col + 1 },
    { row: pos.row + 1, col: pos.col },
    { row: pos.row + 1, col: pos.col + 1 },
  ];

  for (const { row, col } of coords) {
    const stopRow = firstOccupiedRowBelow(grid, row, col);
    maxPx = Math.min(maxPx, Math.max(0, (stopRow - row - 1) * cellPx));
  }

  return Math.max(0, Math.min(requestedPx, maxPx));
}
