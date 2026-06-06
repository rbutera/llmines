import { floodFill } from "./chain";
import { COLS, ROWS } from "./constants";
import type { Color, Grid } from "./types";

/**
 * Resolve a chain activation as part of the sweep's single delete step.
 *
 * The triggering chain cell at `coord` has ALREADY been deleted by the caller
 * (its colour captured first and passed in as `colour`). This function clears
 * every same-colour cell orthogonally (4-) connected to the chain cell —
 * including cells in columns ahead of the bar — in the SAME step, and drops any
 * of those coordinates from the `specials` set. Multiple chain cells in one
 * connected region therefore resolve as a single flood (the second chain cell is
 * already cleared and removed from `specials` by the first flood, so it does not
 * re-trigger). Flooded-in extras contribute nothing to the score — the caller
 * never counts them toward `distinctSquares`.
 *
 * Mutates `grid` and `specials` in place. Order-independent in result (the
 * connected component is a set).
 */
export function chainFlood(
  grid: Grid,
  coord: number,
  colour: Color,
  specials: Set<number>,
): void {
  // Seed the flood from the chain cell's orthogonal neighbours, since the chain
  // cell itself is already null. Any neighbour of the chain colour anchors the
  // connected component.
  const row = Math.floor(coord / COLS);
  const col = coord % COLS;
  const component = new Set<number>();
  const seeds = [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
  ];
  for (const [nr, nc] of seeds) {
    if (nr! < 0 || nr! >= ROWS || nc! < 0 || nc! >= COLS) continue;
    if (grid[nr!]![nc!] !== colour) continue;
    const region = floodFill(grid, nr! * COLS + nc!, colour);
    for (const c of region) component.add(c);
  }

  for (const c of component) {
    const r = Math.floor(c / COLS);
    const cc = c % COLS;
    grid[r]![cc] = null;
    specials.delete(c);
  }
}
