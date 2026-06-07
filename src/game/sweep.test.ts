import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { COLS, ROWS, SWEEP_MS_PER_COL, SWEEP_PERIOD_MS } from "~/game/constants";
import { emptyGrid } from "~/game/grid";
import { countDistinctSquares, detectMarked } from "~/game/squares";
import {
  collapseColumn,
  fullSweep,
  scoreFor,
  sweepProgress,
} from "~/game/sweep";
import type { Cell, Color, GameState, Grid } from "~/game/types";

// --- Helpers -------------------------------------------------------------

/** Wrap a grid into a minimal GameState for sweep operations. */
function stateWith(grid: Grid, sweepX = 0, score = 0): GameState {
  return {
    grid,
    active: null,
    marked: detectMarked(grid),
    score,
    gameOver: false,
    sweepX,
    softDrop: false,
    rngState: 1,
  };
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

/** Count occupied (non-null) cells across the whole grid. */
function occupiedCount(grid: Grid): number {
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r]?.[c] != null) {
        n++;
      }
    }
  }
  return n;
}

/** Count flagged cells in a marked matrix. */
function markedCount(marked: boolean[][]): number {
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (marked[r]?.[c] === true) {
        n++;
      }
    }
  }
  return n;
}

/** Sorted multiset of the colours present in a single column. */
function columnColours(grid: Grid, col: number): Color[] {
  const out: Color[] = [];
  for (let r = 0; r < ROWS; r++) {
    const cell = grid[r]?.[col];
    if (cell != null) {
      out.push(cell);
    }
  }
  return out.sort((a, b) => a - b);
}

// Cluster-biased cell arbitrary so monochrome 2x2 squares form across grids.
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

describe("sweep - concrete examples", () => {
  it("scoreFor multiplies deleted cells by distinct squares", () => {
    expect(scoreFor(4, 1)).toBe(4);
    expect(scoreFor(6, 2)).toBe(12);
    expect(scoreFor(0, 5)).toBe(0);
  });

  it("single 2x2 monochrome block: deleted 4, distinct 1, score +4", () => {
    const grid = emptyGrid();
    fillRect(grid, 8, 5, 9, 6, 0); // 2x2 at the bottom
    const result = fullSweep(stateWith(grid, 3, 10));
    expect(result.deletedCells).toBe(4);
    expect(result.distinctSquares).toBe(1);
    expect(result.scoreDelta).toBe(4);
    expect(result.state.score).toBe(14);
    expect(result.state.sweepX).toBe(0);
    expect(occupiedCount(result.state.grid)).toBe(0);
  });

  it("2x3 monochrome block: deleted 6, distinct 2, score +12", () => {
    const grid = emptyGrid();
    fillRect(grid, 2, 4, 3, 6, 1); // 2 rows x 3 cols
    const result = fullSweep(stateWith(grid));
    expect(result.deletedCells).toBe(6);
    expect(result.distinctSquares).toBe(2);
    expect(result.scoreDelta).toBe(12);
  });

  it("no monochrome square: nothing deleted, no score change", () => {
    const grid = emptyGrid();
    const row0 = grid[0];
    const row1 = grid[1];
    if (row0 && row1) {
      row0[0] = 0;
      row0[1] = 1;
      row1[0] = 1;
      row1[1] = 0;
    }
    const result = fullSweep(stateWith(grid, 0, 7));
    expect(result.deletedCells).toBe(0);
    expect(result.scoreDelta).toBe(0);
    expect(result.state.score).toBe(7);
  });

  it("collapseColumn drops occupied cells to the bottom preserving order", () => {
    const grid = emptyGrid();
    const r1 = grid[1];
    const r4 = grid[4];
    const r7 = grid[7];
    if (r1 && r4 && r7) {
      r1[3] = 0; // top
      r4[3] = 1; // middle
      r7[3] = 0; // bottom
    }
    const next = collapseColumn(grid, 3);
    // Three cells fall to rows 7,8,9 keeping order 0,1,0.
    expect(next[7]?.[3]).toBe(0);
    expect(next[8]?.[3]).toBe(1);
    expect(next[9]?.[3]).toBe(0);
    // Above is empty.
    for (let r = 0; r < 7; r++) {
      expect(next[r]?.[3]).toBeNull();
    }
  });

  it("fullSweep does not mutate the input grid", () => {
    const grid = emptyGrid();
    fillRect(grid, 8, 5, 9, 6, 0);
    const state = stateWith(grid);
    fullSweep(state);
    expect(occupiedCount(grid)).toBe(4); // untouched
  });

  it("sweepProgress on empty grid advances sweepX with no deletions", () => {
    const result = sweepProgress(stateWith(emptyGrid(), 0, 0), SWEEP_MS_PER_COL);
    expect(result.state.sweepX).toBeCloseTo(1, 9);
    expect(result.deletedCells).toBe(0);
    expect(result.scoreDelta).toBe(0);
  });
});

// --- Property tests ------------------------------------------------------

describe("sweep - property tests", () => {
  // Feature: llmines, Property 12: Post-deletion gravity leaves no floating gaps
  // Validates: Requirements 8.1
  it("Property 12: collapseColumn leaves no gap below an occupied cell and preserves colours", () => {
    fc.assert(
      fc.property(
        gridArb,
        fc.integer({ min: 0, max: COLS - 1 }),
        (grid, col) => {
          const before = columnColours(grid, col);
          const next = collapseColumn(grid, col);

          // No empty cell below an occupied cell: once a null appears scanning
          // bottom-up, everything above must also be null.
          let seenEmpty = false;
          for (let r = ROWS - 1; r >= 0; r--) {
            const cell = next[r]?.[col] ?? null;
            if (cell == null) {
              seenEmpty = true;
            } else {
              expect(seenEmpty).toBe(false);
            }
          }

          // The multiset of colours in the column is unchanged.
          expect(columnColours(next, col)).toEqual(before);

          // Other columns are untouched.
          for (let c = 0; c < COLS; c++) {
            if (c === col) continue;
            expect(columnColours(next, c)).toEqual(columnColours(grid, c));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: llmines, Property 10: Sweep deletes exactly the marked cells it crosses
  // Validates: Requirements 6.3
  it("Property 10: fullSweep deletes exactly the marked cells", () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const before = occupiedCount(grid);
        const expectedDeleted = markedCount(detectMarked(grid));
        const result = fullSweep(stateWith(grid));

        expect(result.deletedCells).toBe(expectedDeleted);
        expect(occupiedCount(result.state.grid)).toBe(before - expectedDeleted);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: llmines, Property 11: Scoring equals cells deleted times distinct squares cleared
  // Validates: Requirements 7.1
  it("Property 11: fullSweep scoreDelta === markedCount * distinctSquares(entryGrid)", () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const deleted = markedCount(detectMarked(grid));
        const distinct = countDistinctSquares(grid);
        const result = fullSweep(stateWith(grid));

        expect(result.scoreDelta).toBe(deleted * distinct);
        if (deleted === 0) {
          expect(result.scoreDelta).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: llmines, Property 9: Sweep period and per-column rate
  // Validates: Requirements 6.1, 19.4
  it("Property 9: sweepProgress advances sweepX by dt/250 columns (modulo wrap)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: COLS, noNaN: true }),
        fc.double({ min: 0, max: 20000, noNaN: true }),
        (startX, dtMs) => {
          const result = sweepProgress(stateWith(emptyGrid(), startX), dtMs);
          const expected = (startX + dtMs / SWEEP_MS_PER_COL) % COLS;
          expect(result.state.sweepX).toBeCloseTo(expected, 6);
          // Empty grid never deletes anything.
          expect(result.deletedCells).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("Property 9: a full 16-column traversal corresponds to 4000 ms", () => {
    expect(SWEEP_PERIOD_MS).toBe(4000);
    expect(SWEEP_MS_PER_COL * COLS).toBe(4000);
    const result = sweepProgress(stateWith(emptyGrid(), 0), SWEEP_PERIOD_MS);
    expect(result.state.sweepX).toBeCloseTo(0, 9); // wrapped back to start
  });

  // Feature: llmines, Property 13: Marking is re-evaluated after collapse
  // Validates: Requirements 5.1, 5.2, 8.2
  it("Property 13: fullSweep marked equals detectMarked of the post-collapse grid", () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const result = fullSweep(stateWith(grid));
        const recomputed = detectMarked(result.state.grid);
        expect(result.state.marked).toEqual(recomputed);
      }),
      { numRuns: 200 },
    );
  });
});
