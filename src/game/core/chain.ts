import { COLS, ROWS } from "./constants";
import type { Color, Grid, OrderedCell } from "./types";

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

export type { OrderedCell } from "./types";

/**
 * RECORD-ONLY companion to {@link floodFill}: a pure, deterministic BFS that
 * returns each cell of the same-colour 4-connected component reachable from
 * `origin`, paired with its BFS distance from `origin`. The origin is reported
 * at `dist: 0`; its same-colour orthogonal neighbours at `dist: 1`; and so on.
 *
 * Semantics vs {@link floodFill}: the SET of cells returned (their `cell`
 * values) is exactly the connected component {@link floodFill} would return from
 * the SAME origin with the SAME colour — this function only additionally tags
 * each cell with the graph distance. So `new Set(floodFillOrdered(g,o,c).map(x
 * => x.cell))` equals `floodFill(g,o,c)`. Used purely to RECORD the order a
 * chain flood cleared cells in, for a render-only travelling-wavefront effect.
 * It performs NO mutation and feeds NO gameplay/scoring/timing decision.
 *
 * The origin must itself be of `colour` and in bounds (callers chain-flood from
 * a cell that has already been confirmed of that colour). If the origin is empty
 * / a different colour / out of bounds, an empty array is returned.
 *
 * The result is returned in nondecreasing `dist` order (a BFS visit order); ties
 * within a distance ring follow the deterministic neighbour-enumeration order
 * (up, down, left, right), so the output is stable for a given grid + origin.
 */
export function floodFillOrdered(
  grid: Grid,
  origin: number,
  colour: Color,
): OrderedCell[] {
  const startRow = Math.floor(origin / COLS);
  const startCol = origin % COLS;
  if (
    startRow < 0 ||
    startRow >= ROWS ||
    startCol < 0 ||
    startCol >= COLS ||
    grid[startRow]![startCol] !== colour
  ) {
    return [];
  }

  const ordered: OrderedCell[] = [];
  const seen = new Set<number>([origin]);
  // BFS queue of [coord, dist]; FIFO via a moving cursor (no shift cost). The
  // queue grows during iteration, so this is a while loop, not a for-of.
  const queue: Array<[number, number]> = [[origin, 0]];
  let head = 0;
  while (head < queue.length) {
    const [c, dist] = queue[head]!;
    head++;
    ordered.push({ cell: c, dist });
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
      if (seen.has(ncoord)) continue;
      seen.add(ncoord);
      queue.push([ncoord, dist + 1]);
    }
  }
  return ordered;
}
