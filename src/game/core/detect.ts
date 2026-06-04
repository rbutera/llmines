import { COLS, ROWS } from "./constants";
import type { Grid, MarkResult } from "./types";

/**
 * Corner-anchored 2x2 scan (pinned semantics).
 *
 * Every aligned 2x2 whose four cells are the same non-null colour is one
 * distinct completed square, counted by its top-left corner. All four of its
 * cells are marked for deletion. Overlapping squares share cells but each
 * top-left corner counts once:
 *   - mono 2x2  -> 1 square, 4 marked
 *   - mono 2x3  -> 2 squares, 6 marked
 *   - mono 3x3  -> 4 squares, 9 marked
 */
export function computeMarked(grid: Grid): MarkResult {
  const markedSet = new Set<number>();
  let distinctSquares = 0;

  for (let row = 0; row < ROWS - 1; row++) {
    for (let col = 0; col < COLS - 1; col++) {
      const a = grid[row]![col];
      if (a === null) continue;
      const b = grid[row]![col + 1];
      const c = grid[row + 1]![col];
      const d = grid[row + 1]![col + 1];
      if (a === b && a === c && a === d) {
        distinctSquares++;
        markedSet.add(row * COLS + col);
        markedSet.add(row * COLS + col + 1);
        markedSet.add((row + 1) * COLS + col);
        markedSet.add((row + 1) * COLS + col + 1);
      }
    }
  }

  const marked = Array.from(markedSet)
    .sort((x, y) => x - y)
    .map((idx) => ({ row: Math.floor(idx / COLS), col: idx % COLS }));

  return { marked, distinctSquares };
}
