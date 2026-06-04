import { COLS, ROWS } from "./constants";
import type { Grid, MarkedCell } from "./types";

function isMonoSquare(g: Grid, r: number, c: number): boolean {
  const v = g[r]![c];
  return (
    v !== null &&
    g[r]![c + 1] === v &&
    g[r + 1]![c] === v &&
    g[r + 1]![c + 1] === v
  );
}

// Boolean grid: true where a cell belongs to any aligned monochrome 2x2.
export function computeMarkedGrid(g: Grid): boolean[][] {
  const m: boolean[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => false),
  );
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      if (isMonoSquare(g, r, c)) {
        m[r]![c] = true;
        m[r]![c + 1] = true;
        m[r + 1]![c] = true;
        m[r + 1]![c + 1] = true;
      }
    }
  }
  return m;
}

// distinct_squares multiplier: one per monochrome top-left corner.
export function countSquares(g: Grid): number {
  let n = 0;
  for (let r = 0; r < ROWS - 1; r++)
    for (let c = 0; c < COLS - 1; c++) if (isMonoSquare(g, r, c)) n++;
  return n;
}

export function markedList(g: Grid): MarkedCell[] {
  const m = computeMarkedGrid(g);
  const out: MarkedCell[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) if (m[r]![c]) out.push({ row: r, col: c });
  return out;
}
