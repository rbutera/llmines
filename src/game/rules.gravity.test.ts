import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { COLS, ROWS } from "~/game/constants";
import { blockCells, cloneGrid, emptyGrid } from "~/game/grid";
import {
  canPlace,
  gravityStep,
  hardDrop,
  lock,
  lowestLegalRow,
  move,
  rotate,
} from "~/game/rules";
import { rotatePiece } from "~/game/piece";
import type {
  ActiveBlock,
  Cell,
  Color,
  GameState,
  Grid,
  Piece,
} from "~/game/types";

// --- Helpers -------------------------------------------------------------

/** Build a minimal GameState wrapping the given grid and active block. */
function makeState(grid: Grid, active: ActiveBlock | null): GameState {
  return {
    grid,
    active,
    marked: grid.map((row) => row.map(() => false)),
    score: 7,
    gameOver: false,
    sweepX: 3,
    softDrop: true,
    rngState: 42,
  };
}

/** Arbitrary single colour (0 or 1). */
const colorArb: fc.Arbitrary<Color> = fc.constantFrom<Color>(0, 1);

/** Arbitrary 2x2 piece of independently-coloured cells. */
const pieceArb: fc.Arbitrary<Piece> = fc
  .tuple(colorArb, colorArb, colorArb, colorArb)
  .map(([a, b, c, d]): Piece => [
    [a, b],
    [c, d],
  ]);

/** Cell arbitrary biased toward occupancy so stacks form. */
const cellArb: fc.Arbitrary<Cell> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<Cell>(0) },
  { weight: 1, arbitrary: fc.constant<Cell>(1) },
  { weight: 3, arbitrary: fc.constant<Cell>(null) },
);

/** Arbitrary full ROWS x COLS grid (sparse, occupancy-biased). */
const gridArb: fc.Arbitrary<Grid> = fc.array(
  fc.array(cellArb, { minLength: COLS, maxLength: COLS }),
  { minLength: ROWS, maxLength: ROWS },
);

/**
 * Generate a random *reachable* GameState: a sparse stack plus an active block
 * placed legally at a random top-left position. We enumerate all legal
 * positions for the chosen piece on the chosen grid and pick one; if none
 * exists we fall back to an empty grid (where the spawn area is always legal).
 */
const reachableStateArb: fc.Arbitrary<GameState> = fc
  .record({
    grid: gridArb,
    piece: pieceArb,
    posSeed: fc.nat(),
  })
  .map(({ grid, piece, posSeed }): GameState => {
    const legal: { row: number; col: number }[] = [];
    for (let row = 0; row <= ROWS - 2; row++) {
      for (let col = 0; col <= COLS - 2; col++) {
        if (canPlace(grid, { piece, row, col })) {
          legal.push({ row, col });
        }
      }
    }
    if (legal.length === 0) {
      const empty = emptyGrid();
      return makeState(empty, { piece, row: 0, col: 7 });
    }
    const pos = legal[posSeed % legal.length]!;
    return makeState(grid, { piece, row: pos.row, col: pos.col });
  });

// --- Property 2 ----------------------------------------------------------

// Feature: llmines, Property 2: Gravity moves down or locks, never overlaps
// Validates: Requirements 3.1, 3.2
describe("Property 2: Gravity moves down or locks, never overlaps", () => {
  it("one gravityStep moves down exactly one row or locks; never overlaps or leaves the field", () => {
    fc.assert(
      fc.property(reachableStateArb, (state) => {
        const active = state.active!;
        const canDescend = canPlace(state.grid, {
          ...active,
          row: active.row + 1,
        });

        const next = gravityStep(state);

        if (canDescend) {
          // Moved down exactly one row, same columns/orientation, stack intact.
          expect(next.active).not.toBeNull();
          expect(next.active!.row).toBe(active.row + 1);
          expect(next.active!.col).toBe(active.col);
          expect(next.active!.piece).toEqual(active.piece);
          expect(canPlace(next.grid, next.active!)).toBe(true);
          expect(next.grid).toEqual(state.grid);
        } else {
          // Locked: no active block remains.
          expect(next.active).toBeNull();
          // Every footprint cell of the original block is now occupied.
          for (const { row, col, color } of blockCells(active)) {
            expect(next.grid[row]![col]).toBe(color);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

// --- Property 3 ----------------------------------------------------------

// Feature: llmines, Property 3: Lock preserves block colours into the stack
// Validates: Requirements 3.3
describe("Property 3: Lock preserves block colours into the stack", () => {
  it("footprint stack cells equal block colours; no other stack cell changes", () => {
    fc.assert(
      fc.property(reachableStateArb, (state) => {
        const active = state.active!;
        const before = cloneGrid(state.grid);
        const footprint = new Set(
          blockCells(active).map(({ row, col }) => `${row},${col}`),
        );

        const next = lock(state);

        expect(next.active).toBeNull();

        // Footprint cells take the corresponding block colour.
        for (const { row, col, color } of blockCells(active)) {
          expect(next.grid[row]![col]).toBe(color);
        }

        // No non-footprint cell changes.
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (!footprint.has(`${r},${c}`)) {
              expect(next.grid[r]![c]).toBe(before[r]![c]);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

// --- Property 4 ----------------------------------------------------------

// Feature: llmines, Property 4: Horizontal move legality and reversibility
// Validates: Requirements 4.1, 4.2, 4.7
describe("Property 4: Horizontal move legality and reversibility", () => {
  it("shifts exactly one column when legal, else no-op", () => {
    fc.assert(
      fc.property(
        reachableStateArb,
        fc.constantFrom(-1, 1),
        (state, dCol) => {
          const active = state.active!;
          const dest: ActiveBlock = { ...active, col: active.col + dCol };
          const legal = canPlace(state.grid, dest);

          const next = move(state, dCol);

          if (legal) {
            expect(next.active!.col).toBe(active.col + dCol);
            expect(next.active!.row).toBe(active.row);
            expect(next.active!.piece).toEqual(active.piece);
          } else {
            expect(next.active!.col).toBe(active.col);
            expect(next.active!.row).toBe(active.row);
            expect(next.active!.piece).toEqual(active.piece);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("moving left then right (when both legal) returns to the original column", () => {
    fc.assert(
      fc.property(reachableStateArb, (state) => {
        const active = state.active!;
        const leftLegal = canPlace(state.grid, { ...active, col: active.col - 1 });
        const left = move(state, -1);
        // Only assert reversibility when the left move actually happened and the
        // return right move is legal from there.
        if (leftLegal) {
          const rightLegal = canPlace(left.grid, {
            ...left.active!,
            col: left.active!.col + 1,
          });
          if (rightLegal) {
            const back = move(left, 1);
            expect(back.active!.col).toBe(active.col);
            expect(back.active!.row).toBe(active.row);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

// --- Property 5 ----------------------------------------------------------

// Feature: llmines, Property 5: Rotation legality and bounds safety
// Validates: Requirements 4.4, 4.7
describe("Property 5: Rotation legality and bounds safety", () => {
  it("rotation yields a legal orientation or leaves the block unchanged; result always legal", () => {
    fc.assert(
      fc.property(reachableStateArb, (state) => {
        const active = state.active!;
        const rotatedBlock: ActiveBlock = {
          ...active,
          piece: rotatePiece(active.piece),
        };
        const legal = canPlace(state.grid, rotatedBlock);

        const next = rotate(state);

        // The resulting block is always within bounds and overlap-free.
        expect(canPlace(next.grid, next.active!)).toBe(true);

        if (legal) {
          expect(next.active!.piece).toEqual(rotatedBlock.piece);
        } else {
          expect(next.active!.piece).toEqual(active.piece);
        }
        expect(next.active!.row).toBe(active.row);
        expect(next.active!.col).toBe(active.col);
      }),
      { numRuns: 200 },
    );
  });
});

// --- Property 6 ----------------------------------------------------------

// Feature: llmines, Property 6: Hard drop lands at the lowest legal row and locks
// Validates: Requirements 4.5
describe("Property 6: Hard drop lands at the lowest legal row and locks", () => {
  it("locked cells are at the lowest legal position and active becomes null", () => {
    fc.assert(
      fc.property(reachableStateArb, (state) => {
        const active = state.active!;
        const landingRow = lowestLegalRow(state.grid, active);
        const landed: ActiveBlock = { ...active, row: landingRow };

        const next = hardDrop(state);

        // Active is cleared after a hard drop.
        expect(next.active).toBeNull();

        // The block could not have moved any further down.
        expect(
          canPlace(state.grid, { ...active, row: landingRow + 1 }),
        ).toBe(false);

        // The landed footprint cells now hold the block's colours.
        for (const { row, col, color } of blockCells(landed)) {
          expect(next.grid[row]![col]).toBe(color);
        }
      }),
      { numRuns: 200 },
    );
  });
});
