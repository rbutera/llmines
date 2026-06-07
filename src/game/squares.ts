// Square detection, marking, and Distinct_Square counting for LLMines.
// This module is part of the pure game core: it imports nothing from React or PixiJS.

import { COLS, ROWS } from "~/game/constants";
import type { Grid } from "~/game/types";

/**
 * True iff a Monochrome_2x2 exists with top-left corner at `(tr, tc)`: all four
 * aligned cells `grid[tr][tc]`, `grid[tr][tc+1]`, `grid[tr+1][tc]`,
 * `grid[tr+1][tc+1]` are non-null AND hold the same colour.
 *
 * Returns `false` when the 2x2 would extend past the grid bounds, or when any
 * of the four cells is missing (guards undefined for `noUncheckedIndexedAccess`).
 */
function isMonochromeSquare(grid: Grid, tr: number, tc: number): boolean {
  if (tr < 0 || tc < 0 || tr > ROWS - 2 || tc > COLS - 2) {
    return false;
  }
  const topRow = grid[tr];
  const bottomRow = grid[tr + 1];
  if (topRow === undefined || bottomRow === undefined) {
    return false;
  }
  const a = topRow[tc];
  const b = topRow[tc + 1];
  const c = bottomRow[tc];
  const d = bottomRow[tc + 1];
  if (a == null || b == null || c == null || d == null) {
    return false;
  }
  return a === b && b === c && c === d;
}

/**
 * Compute the marked designation for every Stack cell (Req 5.1, 5.2).
 *
 * Returns a ROWS x COLS boolean matrix addressed `[row][col]`. A cell `(r, c)`
 * is `true` iff it is a member of at least one Monochrome_2x2 — i.e. it is the
 * top-left, top-right, bottom-left, or bottom-right cell of some monochrome 2x2.
 * Every other cell is `false`.
 *
 * Pure: does not mutate `grid`.
 */
export function detectMarked(grid: Grid): boolean[][] {
  const marked: boolean[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const rowFlags: boolean[] = [];
    for (let c = 0; c < COLS; c++) {
      rowFlags.push(false);
    }
    marked.push(rowFlags);
  }

  const setMarked = (r: number, c: number): void => {
    const row = marked[r];
    if (row !== undefined && c >= 0 && c < COLS) {
      row[c] = true;
    }
  };

  // For every qualifying top-left corner, mark all four member cells.
  for (let tr = 0; tr <= ROWS - 2; tr++) {
    for (let tc = 0; tc <= COLS - 2; tc++) {
      if (isMonochromeSquare(grid, tr, tc)) {
        setMarked(tr, tc);
        setMarked(tr, tc + 1);
        setMarked(tr + 1, tc);
        setMarked(tr + 1, tc + 1);
      }
    }
  }

  return marked;
}

/**
 * Count one Distinct_Square per qualifying top-left corner (Req 5.3).
 *
 * Iterates every valid top-left `(tr, tc)` with `0 <= tr <= ROWS-2` and
 * `0 <= tc <= COLS-2` and counts 1 for each whose four aligned cells are all
 * non-null and share a single colour. Thus a 2x3 monochrome block yields 2,
 * and a 3x3 yields 4.
 *
 * Pure: does not mutate `grid`.
 */
export function countDistinctSquares(grid: Grid): number {
  let count = 0;
  for (let tr = 0; tr <= ROWS - 2; tr++) {
    for (let tc = 0; tc <= COLS - 2; tc++) {
      if (isMonochromeSquare(grid, tr, tc)) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Count qualifying Distinct_Square top-left corners whose 2x2 footprint
 * intersects the provided set of columns (useful for per-column sweep scoring,
 * Task 8).
 *
 * Semantics: a qualifying top-left `(tr, tc)` is counted iff at least one of the
 * square's two columns `{tc, tc+1}` is present in `cols`. Each qualifying
 * top-left is counted at most once regardless of how many of its columns are in
 * `cols`. Out-of-range column values in `cols` are ignored (they simply never
 * match a square's footprint).
 *
 * Pure: does not mutate `grid` or `cols`.
 */
export function distinctSquaresInColumns(grid: Grid, cols: number[]): number {
  const colSet = new Set(cols);
  let count = 0;
  for (let tr = 0; tr <= ROWS - 2; tr++) {
    for (let tc = 0; tc <= COLS - 2; tc++) {
      if (!isMonochromeSquare(grid, tr, tc)) {
        continue;
      }
      if (colSet.has(tc) || colSet.has(tc + 1)) {
        count++;
      }
    }
  }
  return count;
}
