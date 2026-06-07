import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { COLS, ROWS } from "~/game/constants";
import { emptyGrid } from "~/game/grid";
import {
  countDistinctSquares,
  detectMarked,
  distinctSquaresInColumns,
} from "~/game/squares";
import type { Cell, Color, Grid } from "~/game/types";

// --- Helpers -------------------------------------------------------------

/** Build a grid from a list of placements: `(r, c) -> colour`. */
function gridWith(placements: { r: number; c: number; color: Color }[]): Grid {
  const grid = emptyGrid();
  for (const { r, c, color } of placements) {
    const row = grid[r];
    if (row !== undefined) {
      row[c] = color;
    }
  }
  return grid;
}

/** Fill an axis-aligned rectangle [r0..r1] x [c0..c1] (inclusive) with `color`. */
function fillRect(
  grid: Grid,
  r0: number,
  c0: number,
  r1: number,
  c1: number,
  color: Color,
): void {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const row = grid[r];
      if (row !== undefined) {
        row[c] = color;
      }
    }
  }
}

// Independent reference implementations used by the property tests below.

/** Reference: is there a monochrome 2x2 with top-left (tr, tc)? */
function refIsSquare(grid: Grid, tr: number, tc: number): boolean {
  if (tr < 0 || tc < 0 || tr > ROWS - 2 || tc > COLS - 2) return false;
  const a = grid[tr]?.[tc];
  const b = grid[tr]?.[tc + 1];
  const c = grid[tr + 1]?.[tc];
  const d = grid[tr + 1]?.[tc + 1];
  if (a == null || b == null || c == null || d == null) return false;
  return a === b && b === c && c === d;
}

/** Reference: cell (r, c) is a member of at least one monochrome 2x2. */
function refIsMarked(grid: Grid, r: number, c: number): boolean {
  // The four top-left corners that could include (r, c) as a member.
  const corners: [number, number][] = [
    [r, c],
    [r, c - 1],
    [r - 1, c],
    [r - 1, c - 1],
  ];
  return corners.some(([tr, tc]) => refIsSquare(grid, tr, tc));
}

/** Reference: total qualifying top-left corners. */
function refCount(grid: Grid): number {
  let n = 0;
  for (let tr = 0; tr <= ROWS - 2; tr++) {
    for (let tc = 0; tc <= COLS - 2; tc++) {
      if (refIsSquare(grid, tr, tc)) n++;
    }
  }
  return n;
}

// Cluster-biased cell arbitrary: weight toward non-null colours so that
// monochrome 2x2 squares actually form across random grids.
const cellArb: fc.Arbitrary<Cell> = fc.oneof(
  { weight: 2, arbitrary: fc.constant<Cell>(0) },
  { weight: 2, arbitrary: fc.constant<Cell>(1) },
  { weight: 1, arbitrary: fc.constant<Cell>(null) },
);

const gridArb: fc.Arbitrary<Grid> = fc.array(
  fc.array(cellArb, { minLength: COLS, maxLength: COLS }),
  { minLength: ROWS, maxLength: ROWS },
);

// --- Unit examples -------------------------------------------------------

describe("detectMarked / countDistinctSquares - concrete examples", () => {
  it("empty grid: nothing marked, zero squares", () => {
    const grid = emptyGrid();
    const marked = detectMarked(grid);
    expect(marked.flat().some(Boolean)).toBe(false);
    expect(countDistinctSquares(grid)).toBe(0);
  });

  it("single 2x2 monochrome block: count 1, four marked cells", () => {
    const grid = gridWith([
      { r: 3, c: 5, color: 0 },
      { r: 3, c: 6, color: 0 },
      { r: 4, c: 5, color: 0 },
      { r: 4, c: 6, color: 0 },
    ]);
    expect(countDistinctSquares(grid)).toBe(1);
    const marked = detectMarked(grid);
    expect(marked[3]?.[5]).toBe(true);
    expect(marked[3]?.[6]).toBe(true);
    expect(marked[4]?.[5]).toBe(true);
    expect(marked[4]?.[6]).toBe(true);
    expect(marked.flat().filter(Boolean).length).toBe(4);
  });

  it("a 2x2 block of mixed colours is not a square", () => {
    const grid = gridWith([
      { r: 0, c: 0, color: 0 },
      { r: 0, c: 1, color: 1 },
      { r: 1, c: 0, color: 0 },
      { r: 1, c: 1, color: 0 },
    ]);
    expect(countDistinctSquares(grid)).toBe(0);
    expect(detectMarked(grid).flat().some(Boolean)).toBe(false);
  });

  it("2x3 monochrome block: count 2, six marked cells", () => {
    const grid = emptyGrid();
    // rows 2..3, cols 4..6 (2 rows x 3 cols)
    fillRect(grid, 2, 4, 3, 6, 1);
    expect(countDistinctSquares(grid)).toBe(2);
    expect(detectMarked(grid).flat().filter(Boolean).length).toBe(6);
  });

  it("3x3 monochrome block: count 4, nine marked cells", () => {
    const grid = emptyGrid();
    // rows 5..7, cols 1..3 (3x3)
    fillRect(grid, 5, 1, 7, 3, 0);
    expect(countDistinctSquares(grid)).toBe(4);
    expect(detectMarked(grid).flat().filter(Boolean).length).toBe(9);
  });

  it("distinctSquaresInColumns: counts squares whose footprint touches given cols", () => {
    const grid = emptyGrid();
    // 2x3 monochrome block at rows 2..3, cols 4..6 -> top-lefts at cols 4 and 5.
    fillRect(grid, 2, 4, 3, 6, 1);
    // Square top-left col 4 spans cols {4,5}; top-left col 5 spans {5,6}.
    expect(distinctSquaresInColumns(grid, [4])).toBe(1); // only the col-4 square
    expect(distinctSquaresInColumns(grid, [6])).toBe(1); // only the col-5 square
    expect(distinctSquaresInColumns(grid, [5])).toBe(2); // both squares touch col 5
    expect(distinctSquaresInColumns(grid, [4, 5, 6])).toBe(2);
    expect(distinctSquaresInColumns(grid, [0, 1])).toBe(0);
  });
});

// --- Property tests ------------------------------------------------------

describe("squares - property tests", () => {
  // Feature: llmines, Property 7: Marking exactly covers monochrome 2x2 membership
  // Validates: Requirements 5.1, 5.2
  it("Property 7: a cell is marked iff it is a member of at least one Monochrome_2x2", () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const marked = detectMarked(grid);
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            expect(marked[r]?.[c]).toBe(refIsMarked(grid, r, c));
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: llmines, Property 8: Distinct square count equals qualifying top-left corners
  // Validates: Requirements 5.3
  it("Property 8: countDistinctSquares equals the number of qualifying top-left corners", () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        expect(countDistinctSquares(grid)).toBe(refCount(grid));
      }),
      { numRuns: 200 },
    );
  });
});
