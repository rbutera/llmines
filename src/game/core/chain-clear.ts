import { floodFill, type OrderedCell } from "./chain";
import { COLS, ROWS } from "./constants";
import type { Color, Grid } from "./types";

/**
 * RECORD-ONLY description of a single chain-flood clear, for the render layer's
 * travelling-wavefront effect. Pure data: the `origin` chain cell (`row*COLS+col`)
 * at `dist: 0`, then every flooded cell paired with its BFS distance from the
 * origin. The deletion this describes is byte-for-byte unchanged; this only
 * records the order in which the connected component was cleared. Never read by
 * gameplay/scoring/timing.
 */
export interface ChainClearRecord {
  /** The chain cell the flood radiated from (`row * COLS + col`). */
  origin: number;
  /**
   * The origin (dist 0) followed by each flooded cell with its BFS distance from
   * the origin, in nondecreasing-distance (BFS visit) order.
   */
  cells: OrderedCell[];
}

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
 * Mutates `grid`, `specials`, and (when supplied) the parallel `marks` grid in
 * place. Clearing flooded cells' marks is what keeps sweep deletion identity-
 * based: a snapshot square whose cells a flood pre-consumes loses its marks, so
 * when the bar later reaches that square's column there is nothing stale left to
 * delete. Order-independent in result (the connected component is a set).
 *
 * `record` (optional) is a RECORD-ONLY sink: when supplied, a {@link
 * ChainClearRecord} describing the order this flood cleared the component (origin
 * at dist 0, each cell tagged with its BFS distance from the origin) is pushed
 * onto it BEFORE deletion. This is the only addition for the render-layer
 * wavefront effect — it reads the still-intact component to compute distances and
 * mutates nothing but the sink. Passing no sink leaves behaviour byte-identical
 * to before (the deletion below is unchanged either way).
 */
export function chainFlood(
  grid: Grid,
  coord: number,
  colour: Color,
  specials: Set<number>,
  marks?: boolean[][],
  record?: ChainClearRecord[],
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

  // RECORD-ONLY: compute the origin-rooted BFS ordering over the still-intact
  // component for the render wavefront, then push it. Done before deletion so the
  // grid still holds the component's colours; reads nothing else and feeds no
  // gameplay/scoring/timing decision.
  if (record) record.push(orderComponentFromOrigin(grid, coord, colour));

  for (const c of component) {
    const r = Math.floor(c / COLS);
    const cc = c % COLS;
    grid[r]![cc] = null;
    specials.delete(c);
    if (marks) marks[r]![cc] = false;
  }
}

/**
 * RECORD-ONLY helper: origin-rooted BFS over the chain colour's connected
 * component, returning the origin (dist 0) then each flooded cell with its BFS
 * distance from the origin. The origin chain cell is already null by the time
 * `chainFlood` runs, so it cannot be a {@link floodFillOrdered} start; instead
 * the origin is reported at dist 0 and BFS radiates into its same-colour
 * neighbours (dist 1), matching the visual "clear travels out from the gem"
 * intent. The component membership (excluding the origin) equals what
 * `floodFillOrdered` would return from any seed neighbour — same 4-connected
 * region. Pure; no mutation.
 */
function orderComponentFromOrigin(
  grid: Grid,
  origin: number,
  colour: Color,
): ChainClearRecord {
  const cells: OrderedCell[] = [{ cell: origin, dist: 0 }];
  const seen = new Set<number>([origin]);
  const queue: Array<[number, number]> = [[origin, 0]];
  // BFS via a moving cursor; `queue` grows as we discover cells, so this cannot
  // be a for-of (the length changes during iteration).
  let head = 0;
  while (head < queue.length) {
    const [c, dist] = queue[head]!;
    head++;
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
      if (grid[nr!]![nc!] !== colour) continue; // origin itself is null -> skipped
      const ncoord = nr! * COLS + nc!;
      if (seen.has(ncoord)) continue;
      seen.add(ncoord);
      cells.push({ cell: ncoord, dist: dist + 1 });
      queue.push([ncoord, dist + 1]);
    }
  }
  return { origin, cells };
}
