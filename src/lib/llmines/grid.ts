import { GRID_COLUMNS, GRID_ROWS } from "./constants";
import type { ActivePiece, Cell, CollapseEvent, Coord, Grid } from "./types";

export function createEmptyGrid(): Grid {
  return Array.from({ length: GRID_ROWS }, (): Cell[] =>
    Array.from({ length: GRID_COLUMNS }, (): Cell => null),
  );
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => [...row]);
}

export function inBounds(row: number, col: number) {
  return row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLUMNS;
}

export function pieceCells(activePiece: ActivePiece): Coord[] {
  const cells: Coord[] = [];
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      cells.push({
        row: activePiece.row + row,
        col: activePiece.col + col,
      });
    }
  }
  return cells;
}

export function canPlacePiece(
  grid: Grid,
  activePiece: ActivePiece,
  ignoreAboveTop = false,
) {
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const targetRow = activePiece.row + row;
      const targetCol = activePiece.col + col;
      if (ignoreAboveTop && targetRow < 0) continue;
      if (!inBounds(targetRow, targetCol)) return false;
      if (grid[targetRow]?.[targetCol] !== null) return false;
    }
  }
  return true;
}

export function lockPiece(grid: Grid, activePiece: ActivePiece): Grid {
  const next = cloneGrid(grid);
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const targetRow = activePiece.row + row;
      const targetCol = activePiece.col + col;
      if (inBounds(targetRow, targetCol)) {
        next[targetRow]![targetCol] = activePiece.piece[row]![col]!;
      }
    }
  }
  return next;
}

export function overlayActivePiece(
  grid: Grid,
  activePiece: ActivePiece | null,
) {
  const next = cloneGrid(grid);
  if (!activePiece) return next;

  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const targetRow = activePiece.row + row;
      const targetCol = activePiece.col + col;
      if (inBounds(targetRow, targetCol)) {
        next[targetRow]![targetCol] = activePiece.piece[row]![col]!;
      }
    }
  }

  return next;
}

export function applyColumnGravity(grid: Grid, at = Date.now()) {
  const next = createEmptyGrid();
  const collapses: CollapseEvent[] = [];

  for (let col = 0; col < GRID_COLUMNS; col += 1) {
    let writeRow = GRID_ROWS - 1;
    for (let row = GRID_ROWS - 1; row >= 0; row -= 1) {
      const color = grid[row]?.[col] ?? null;
      if (color === null) continue;

      next[writeRow]![col] = color;
      if (writeRow !== row) {
        collapses.push({ fromRow: row, toRow: writeRow, col, color, at });
      }
      writeRow -= 1;
    }
  }

  return { grid: next, collapses };
}
