import { COLS, ROWS } from "./constants";
import type { ActivePiece, Grid } from "./types";

export function createGrid(): Grid {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => null),
  );
}

export function cloneGrid(g: Grid): Grid {
  return g.map((row) => row.slice());
}

// Compact each column so non-null cells fall to the bottom, preserving order.
export function applyGravity(g: Grid): void {
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (g[r]![c] !== null) {
        g[write]![c] = g[r]![c]!;
        if (write !== r) g[r]![c] = null;
        write--;
      }
    }
    for (let r = write; r >= 0; r--) g[r]![c] = null;
  }
}

// True if a 2x2 footprint at (row,col) is fully in-bounds and unoccupied.
export function footprintValid(g: Grid, row: number, col: number): boolean {
  for (let dr = 0; dr < 2; dr++) {
    for (let dc = 0; dc < 2; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
      if (g[r]![c] !== null) return false;
    }
  }
  return true;
}

export function stampPiece(g: Grid, p: ActivePiece): void {
  g[p.row]![p.col] = p.cells[0][0];
  g[p.row]![p.col + 1] = p.cells[0][1];
  g[p.row + 1]![p.col] = p.cells[1][0];
  g[p.row + 1]![p.col + 1] = p.cells[1][1];
}

// Settled grid with the active piece overlaid (for rendering / state()).
export function mergeActive(settled: Grid, active: ActivePiece | null): Grid {
  const g = cloneGrid(settled);
  if (active) stampPiece(g, active);
  return g;
}
