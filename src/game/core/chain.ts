import { COLS, ROWS } from "./constants";
import type { Color, Grid } from "./types";

/**
 * 4-connected flood fill from a starting coordinate over same-colour cells.
 * Returns the set of coordinates (`row * COLS + col`) in the connected component,
 * INCLUDING the start. The result is the connected component, so it is
 * order-independent; the visited set only prevents reprocessing a cell.
 *
 * `colour` is the chain cell's colour; the fill follows orthogonal neighbours of
 * exactly that colour. If the start cell is empty or a different colour from
 * `colour`, only the start is returned (callers pass the cell's own colour).
 */
export function floodFill(grid: Grid, coord: number, colour: Color): Set<number> {
  const result = new Set<number>();
  const startRow = Math.floor(coord / COLS);
  const startCol = coord % COLS;
  if (
    startRow < 0 ||
    startRow >= ROWS ||
    startCol < 0 ||
    startCol >= COLS ||
    grid[startRow]![startCol] !== colour
  ) {
    return result;
  }

  const stack: number[] = [coord];
  result.add(coord);
  while (stack.length > 0) {
    const c = stack.pop()!;
    const row = Math.floor(c / COLS);
    const col = c % COLS;
    const neighbours = [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1],
    ];
    for (const [nr, nc] of neighbours) {
      if (nr! < 0 || nr! >= ROWS || nc! < 0 || nc! >= COLS) continue;
      if (grid[nr!]![nc!] !== colour) continue;
      const ncoord = nr! * COLS + nc!;
      if (result.has(ncoord)) continue;
      result.add(ncoord);
      stack.push(ncoord);
    }
  }
  return result;
}
