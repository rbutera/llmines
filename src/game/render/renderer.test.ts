import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canPlace, COLS, ROWS, type Cell, type Grid, type Piece } from "../core";
import type { RenderState } from "../engine/controller";
import { computeActivePieceYOffset } from "./renderer";

/**
 * Renderer offset tests for the bottom-row clip fix.
 *
 * The bug: `drawPiece` applied `yOff = fallProgress * CELL` unconditionally, so
 * a resting piece (one that cannot descend another row) was still pushed
 * downward — below its true grid row and, on the floor, below the canvas.
 *
 * Constants mirror the renderer module (CELL/BOARD_H are module-private there).
 */
const CELL = 40;
const BOARD_H = ROWS * CELL; // 400

/** An all-empty settled grid (active piece is drawn separately). */
function emptyGrid(): Grid {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => null as Cell),
  );
}

/** The four [row, col] cells a 2x2 active piece occupies at `pos`. */
function pieceCellCoords(rs: RenderState): [number, number][] {
  const { pos } = rs.active!;
  return [
    [pos.row, pos.col],
    [pos.row, pos.col + 1],
    [pos.row + 1, pos.col],
    [pos.row + 1, pos.col + 1],
  ];
}

/**
 * Bug condition (from design): active piece present, cannot descend one more
 * row, and a positive fall offset is being applied.
 */
function isBugCondition(rs: RenderState): boolean {
  if (!rs.active) return false;
  const { cells, pos } = rs.active;
  const resting = !canPlace(rs.grid, cells, { row: pos.row + 1, col: pos.col });
  return resting && rs.fallProgress > 0;
}

/** Generators -------------------------------------------------------------- */

const colorArb = fc.constantFrom<0 | 1>(0, 1);
const cellsArb: fc.Arbitrary<Piece> = fc.tuple(
  fc.tuple(colorArb, colorArb),
  fc.tuple(colorArb, colorArb),
);

/**
 * Resting RenderState on an empty grid: the piece's bottom cells sit on the
 * floor (row ROWS-1), so `pos.row = ROWS-2` and `canPlace` for the next row is
 * false. `fallProgress` is in the open interval (0, 1].
 */
const restingStateArb: fc.Arbitrary<RenderState> = fc.record({
  cells: cellsArb,
  col: fc.integer({ min: 0, max: COLS - 2 }),
  // (0, 1]: strictly positive so the unconditional offset is non-zero.
  fallProgress: fc.float({ min: Math.fround(0.001), max: 1, noNaN: true }),
}).map(({ cells, col, fallProgress }) => ({
  grid: emptyGrid(),
  active: { cells, pos: { row: ROWS - 2, col } },
  fallProgress,
  score: 0,
  gameOver: false,
  sweepX: 0,
  marked: [],
}));

describe("Property 1: Bug Condition - resting piece renders at true row", () => {
  it("computeActivePieceYOffset is 0 and all cells stay in bounds for every resting input", () => {
    // **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
    fc.assert(
      fc.property(restingStateArb, (rs) => {
        // sanity: every generated input is genuinely a bug-condition input
        expect(isBugCondition(rs)).toBe(true);

        const yOff = computeActivePieceYOffset(rs);
        // resting => no interpolation offset
        expect(yOff).toBe(0);

        // no cell drawn below the canvas bottom
        for (const [row] of pieceCellCoords(rs)) {
          expect(row * CELL + yOff + CELL).toBeLessThanOrEqual(BOARD_H);
          expect(row * CELL + yOff).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it("bottom-row rest with fallProgress=0.5 settles flush (no 20px below-floor clip)", () => {
    // Concrete counterexample from design: unfixed yOff = 0.5 * 40 = 20px,
    // drawing the bottom cells at row 9 -> 9*40 + 20 + 40 = 420px (>400 canvas).
    const rs: RenderState = {
      grid: emptyGrid(),
      active: {
        cells: [
          [0, 0],
          [0, 0],
        ],
        pos: { row: ROWS - 2, col: 7 },
      },
      fallProgress: 0.5,
      score: 0,
      gameOver: false,
      sweepX: 0,
      marked: [],
    };
    expect(isBugCondition(rs)).toBe(true);
    expect(computeActivePieceYOffset(rs)).toBe(0);
    // bottom cells flush on row 9, within the 400px canvas
    expect((ROWS - 1) * CELL + computeActivePieceYOffset(rs) + CELL).toBe(
      BOARD_H,
    );
  });

  it("stack-top rest with fallProgress=0.5 settles flush (no overlap into the stack)", () => {
    // Settled stack 2-high in cols 7-8; piece rests on top (bottom cells row 7).
    const grid = emptyGrid();
    for (const r of [ROWS - 1, ROWS - 2]) {
      grid[r]![7] = 0;
      grid[r]![8] = 0;
    }
    const rs: RenderState = {
      grid,
      active: {
        cells: [
          [1, 1],
          [1, 1],
        ],
        pos: { row: ROWS - 4, col: 7 }, // rows 6-7; row 8 is occupied -> resting
      },
      fallProgress: 0.5,
      score: 0,
      gameOver: false,
      sweepX: 0,
      marked: [],
    };
    expect(isBugCondition(rs)).toBe(true);
    expect(computeActivePieceYOffset(rs)).toBe(0);
  });
});

/**
 * Reference for today's (unfixed) behaviour: the active piece is offset by
 * `fallProgress * CELL`; no active piece means nothing is drawn (offset 0).
 * Property 2 asserts the helper matches this for every NON-bug-condition input.
 */
function originalYOffset(rs: RenderState): number {
  if (!rs.active) return 0;
  return rs.fallProgress * CELL;
}

/** Mid-fall: at least one free row below (pos.row <= ROWS-3 on an empty grid). */
const midFallStateArb: fc.Arbitrary<RenderState> = fc.record({
  cells: cellsArb,
  row: fc.integer({ min: 0, max: ROWS - 3 }),
  col: fc.integer({ min: 0, max: COLS - 2 }),
  fallProgress: fc.float({ min: Math.fround(0.001), max: 1, noNaN: true }),
}).map(({ cells, row, col, fallProgress }) => ({
  grid: emptyGrid(),
  active: { cells, pos: { row, col } },
  fallProgress,
  score: 0,
  gameOver: false,
  sweepX: 0,
  marked: [],
}));

/** Test mode: fallProgress === 0, any in-bounds position (resting or not). */
const testModeStateArb: fc.Arbitrary<RenderState> = fc.record({
  cells: cellsArb,
  row: fc.integer({ min: 0, max: ROWS - 2 }),
  col: fc.integer({ min: 0, max: COLS - 2 }),
}).map(({ cells, row, col }) => ({
  grid: emptyGrid(),
  active: { cells, pos: { row, col } },
  fallProgress: 0,
  score: 0,
  gameOver: false,
  sweepX: 0,
  marked: [],
}));

/** No active piece: drawPiece early-returns; offset is 0. */
const noActiveStateArb: fc.Arbitrary<RenderState> = fc.record({
  fallProgress: fc.float({ min: 0, max: 1, noNaN: true }),
}).map(({ fallProgress }) => ({
  grid: emptyGrid(),
  active: null,
  fallProgress,
  score: 0,
  gameOver: false,
  sweepX: 0,
  marked: [],
}));

describe("Property 2: Preservation - non-resting and non-active rendering unchanged", () => {
  it("mid-fall pieces keep the original fallProgress * CELL offset (Req 3.1)", () => {
    // **Validates: Requirements 3.1**
    fc.assert(
      fc.property(midFallStateArb, (rs) => {
        expect(isBugCondition(rs)).toBe(false);
        expect(computeActivePieceYOffset(rs)).toBe(originalYOffset(rs));
      }),
    );
  });

  it("test-mode (fallProgress=0) offset is unchanged at 0 (Req 3.4)", () => {
    // **Validates: Requirements 3.4**
    fc.assert(
      fc.property(testModeStateArb, (rs) => {
        expect(isBugCondition(rs)).toBe(false);
        expect(computeActivePieceYOffset(rs)).toBe(originalYOffset(rs));
        expect(computeActivePieceYOffset(rs)).toBe(0);
      }),
    );
  });

  it("no active piece draws nothing (offset 0), unchanged across the full 0..1 range", () => {
    // **Validates: Requirements 3.2, 3.3, 3.5**
    fc.assert(
      fc.property(noActiveStateArb, (rs) => {
        expect(isBugCondition(rs)).toBe(false);
        expect(computeActivePieceYOffset(rs)).toBe(originalYOffset(rs));
        expect(computeActivePieceYOffset(rs)).toBe(0);
      }),
    );
  });

  it("offset is preserved across the full fallProgress 0..1 range incl. boundaries (no off-by-one at lock)", () => {
    // **Validates: Requirements 3.1**
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: ROWS - 3 }),
        fc.integer({ min: 0, max: COLS - 2 }),
        (fallProgress, row, col) => {
          const rs: RenderState = {
            grid: emptyGrid(),
            active: {
              cells: [
                [0, 1],
                [1, 0],
              ],
              pos: { row, col },
            },
            fallProgress,
            score: 0,
            gameOver: false,
            sweepX: 0,
            marked: [],
          };
          // mid-fall (free row below) => never a bug condition
          expect(isBugCondition(rs)).toBe(false);
          expect(computeActivePieceYOffset(rs)).toBe(originalYOffset(rs));
        },
      ),
    );
  });
});

describe("computeActivePieceYOffset - example-based boundaries", () => {
  it("returns 0 when the piece rests on the bottom row (cells on row 9)", () => {
    const rs: RenderState = {
      grid: emptyGrid(),
      active: { cells: [[0, 0], [0, 0]], pos: { row: ROWS - 2, col: 5 } },
      fallProgress: 0.75,
      score: 0,
      gameOver: false,
      sweepX: 0,
      marked: [],
    };
    expect(computeActivePieceYOffset(rs)).toBe(0);
  });

  it("returns 0 when the piece rests atop a settled stack", () => {
    const grid = emptyGrid();
    // 3-high stack in cols 3-4 (rows 7,8,9)
    for (const r of [ROWS - 1, ROWS - 2, ROWS - 3]) {
      grid[r]![3] = 1;
      grid[r]![4] = 1;
    }
    const rs: RenderState = {
      grid,
      // piece occupies rows 5-6; row 7 below is occupied -> resting
      active: { cells: [[0, 0], [0, 0]], pos: { row: ROWS - 5, col: 3 } },
      fallProgress: 0.5,
      score: 0,
      gameOver: false,
      sweepX: 0,
      marked: [],
    };
    expect(computeActivePieceYOffset(rs)).toBe(0);
  });

  it("returns fallProgress * CELL when a free row exists below", () => {
    const rs: RenderState = {
      grid: emptyGrid(),
      active: { cells: [[0, 1], [1, 0]], pos: { row: 3, col: 6 } },
      fallProgress: 0.25,
      score: 0,
      gameOver: false,
      sweepX: 0,
      marked: [],
    };
    expect(computeActivePieceYOffset(rs)).toBe(0.25 * CELL); // 10
  });

  it("returns 0 when fallProgress === 0 (test mode), regardless of resting state", () => {
    const restingTestMode: RenderState = {
      grid: emptyGrid(),
      active: { cells: [[0, 0], [0, 0]], pos: { row: ROWS - 2, col: 0 } },
      fallProgress: 0,
      score: 0,
      gameOver: false,
      sweepX: 0,
      marked: [],
    };
    const fallingTestMode: RenderState = {
      ...restingTestMode,
      active: { cells: [[0, 0], [0, 0]], pos: { row: 0, col: 0 } },
    };
    expect(computeActivePieceYOffset(restingTestMode)).toBe(0);
    expect(computeActivePieceYOffset(fallingTestMode)).toBe(0);
  });

  it("resting detection handles the floor (row 9) and stack-top boundaries via canPlace", () => {
    // One row above the floor => can still descend (not resting).
    const oneAboveFloor: RenderState = {
      grid: emptyGrid(),
      active: { cells: [[0, 0], [0, 0]], pos: { row: ROWS - 3, col: 1 } },
      fallProgress: 0.5,
      score: 0,
      gameOver: false,
      sweepX: 0,
      marked: [],
    };
    expect(canPlace(oneAboveFloor.grid, oneAboveFloor.active!.cells, {
      row: oneAboveFloor.active!.pos.row + 1,
      col: oneAboveFloor.active!.pos.col,
    })).toBe(true);
    expect(computeActivePieceYOffset(oneAboveFloor)).toBe(0.5 * CELL);

    // On the floor => cannot descend (resting).
    const onFloor: RenderState = {
      ...oneAboveFloor,
      active: { cells: [[0, 0], [0, 0]], pos: { row: ROWS - 2, col: 1 } },
    };
    expect(canPlace(onFloor.grid, onFloor.active!.cells, {
      row: onFloor.active!.pos.row + 1,
      col: onFloor.active!.pos.col,
    })).toBe(false);
    expect(computeActivePieceYOffset(onFloor)).toBe(0);
  });
});
