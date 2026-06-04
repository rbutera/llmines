import { GRID_COLUMNS, GRID_ROWS } from "./constants";
import type { Coord, Grid, MarkedSquare } from "./types";

function squareKey(row: number, col: number) {
  return `${row}:${col}`;
}

export function detectSquares(grid: Grid): MarkedSquare[] {
  const squares: MarkedSquare[] = [];

  for (let row = 0; row < GRID_ROWS - 1; row += 1) {
    for (let col = 0; col < GRID_COLUMNS - 1; col += 1) {
      const color = grid[row]?.[col] ?? null;
      if (color === null) continue;

      if (
        grid[row]![col + 1] === color &&
        grid[row + 1]![col] === color &&
        grid[row + 1]![col + 1] === color
      ) {
        squares.push({
          row,
          col,
          color,
          key: squareKey(row, col),
          cells: [
            { row, col },
            { row, col: col + 1 },
            { row: row + 1, col },
            { row: row + 1, col: col + 1 },
          ],
        });
      }
    }
  }

  return squares;
}

export function markedCellsFromSquares(squares: MarkedSquare[]): Coord[] {
  const seen = new Set<string>();
  const cells: Coord[] = [];

  for (const square of squares) {
    for (const cell of square.cells) {
      const key = `${cell.row}:${cell.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push(cell);
    }
  }

  return cells.sort((a, b) => a.row - b.row || a.col - b.col);
}

export function markedCellKeys(grid: Grid) {
  return new Set(
    markedCellsFromSquares(detectSquares(grid)).map(
      (cell) => `${cell.row}:${cell.col}`,
    ),
  );
}
