import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { COLS, ROWS, SPAWN_COLS, SPAWN_ROWS } from "~/game/constants";
import { emptyGrid } from "~/game/grid";
import { spawnPiece, spawnRandom } from "~/game/rules";
import type { Cell, Color, GameState, Grid, Piece } from "~/game/types";

/** Build a minimal base GameState for tests with the given grid and rng seed. */
function baseState(grid: Grid, rngState = 0): GameState {
  const marked: boolean[][] = grid.map((row) => row.map(() => false));
  return {
    grid,
    active: null,
    marked,
    score: 0,
    gameOver: false,
    sweepX: 0,
    softDrop: false,
    rngState,
  };
}

/** Arbitrary single colour (0 or 1). */
const colorArb: fc.Arbitrary<Color> = fc.constantFrom<Color>(0, 1);

/** Arbitrary 2x2 piece of independently-coloured cells. */
const pieceArb: fc.Arbitrary<Piece> = fc.tuple(
  colorArb,
  colorArb,
  colorArb,
  colorArb,
).map(([a, b, c, d]): Piece => [
  [a, b],
  [c, d],
]);

/** Arbitrary full ROWS x COLS grid with each cell null, 0, or 1. */
const gridArb: fc.Arbitrary<Grid> = fc.array(
  fc.array(fc.constantFrom<Cell>(null, 0, 1), {
    minLength: COLS,
    maxLength: COLS,
  }),
  { minLength: ROWS, maxLength: ROWS },
);

// Feature: llmines, Property 1: Spawn placement and colouring
// Validates: Requirements 2.1, 2.2, 18.2
describe("Property 1: Spawn placement and colouring", () => {
  it("places the four block cells at columns 7-8, rows 0-1 with valid colours (spawnPiece)", () => {
    fc.assert(
      fc.property(pieceArb, (piece) => {
        const next = spawnPiece(baseState(emptyGrid()), piece);

        expect(next.gameOver).toBe(false);
        expect(next.active).not.toBeNull();
        const active = next.active!;
        expect(active.row).toBe(SPAWN_ROWS[0]);
        expect(active.col).toBe(SPAWN_COLS[0]);
        expect(active.row).toBe(0);
        expect(active.col).toBe(7);
        // Footprint matches the piece colours, each a valid Color 0 or 1.
        expect(active.piece).toEqual(piece);
        for (const row of active.piece) {
          for (const cell of row) {
            expect(cell === 0 || cell === 1).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("places a randomly-generated block at the spawn position for any seed (spawnRandom)", () => {
    fc.assert(
      fc.property(fc.integer(), (seedInput) => {
        const next = spawnRandom(baseState(emptyGrid(), seedInput));

        expect(next.gameOver).toBe(false);
        expect(next.active).not.toBeNull();
        const active = next.active!;
        expect(active.row).toBe(0);
        expect(active.col).toBe(7);
        // Each of the four composite cells holds Color 0 or 1.
        for (const row of active.piece) {
          for (const cell of row) {
            expect(cell === 0 || cell === 1).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: llmines, Property 14: Game over exactly when spawn region is blocked
// Validates: Requirements 9.1
describe("Property 14: Game over exactly when spawn region is blocked", () => {
  it("sets gameOver true iff at least one spawn cell (cols 7-8, rows 0-1) is occupied", () => {
    fc.assert(
      fc.property(gridArb, pieceArb, (grid, piece) => {
        let blocked = false;
        for (const r of SPAWN_ROWS) {
          for (const c of SPAWN_COLS) {
            if (grid[r]![c] != null) {
              blocked = true;
            }
          }
        }

        const next = spawnPiece(baseState(grid), piece);

        expect(next.gameOver).toBe(blocked);
        if (blocked) {
          expect(next.active).toBeNull();
        } else {
          expect(next.active).not.toBeNull();
          expect(next.active!.row).toBe(0);
          expect(next.active!.col).toBe(7);
        }
      }),
      { numRuns: 100 },
    );
  });
});
