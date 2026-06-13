import { COLS, ROWS } from "./constants";
import type { Grid, MarkResult } from "./types";

/**
 * Is the aligned 2x2 square whose TOP-LEFT (anchor) corner is `(row, col)`
 * complete — i.e. all four cells the same non-null colour? The single per-window
 * predicate shared by {@link computeMarked} (the whole-grid scan) and the
 * incremental sweep marker (`markColumn`), so both ask the identical question and
 * can never diverge. Returns false for any anchor whose 2x2 would run off the
 * bottom/right edge.
 */
export function isSquareAt(grid: Grid, row: number, col: number): boolean {
  if (row < 0 || col < 0 || row >= ROWS - 1 || col >= COLS - 1) return false;
  const a = grid[row]![col];
  if (a === null) return false;
  return (
    a === grid[row]![col + 1] &&
    a === grid[row + 1]![col] &&
    a === grid[row + 1]![col + 1]
  );
}

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
      if (isSquareAt(grid, row, col)) {
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
