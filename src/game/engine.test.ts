import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { COLS, ROWS, SPAWN_COLS, SPAWN_ROWS, SWEEP_MS_PER_COL } from "~/game/constants";
import { compositeGrid, createEngine } from "~/game/engine";
import { blockCells } from "~/game/grid";
import { randomPiece } from "~/game/piece";
import { detectMarked } from "~/game/squares";
import type { ActiveBlock, Cell, Color, GameState, Grid, Piece } from "~/game/types";

// --- Helpers -------------------------------------------------------------

/** Count occupied (non-null) cells across a grid. */
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

/** Wrap a grid + active block into a GameState. */
function stateWith(grid: Grid, active: ActiveBlock | null): GameState {
  return {
    grid,
    active,
    marked: detectMarked(grid),
    score: 0,
    gameOver: false,
    sweepX: 0,
    softDrop: false,
    rngState: 1,
  };
}

// Cluster-biased cell arbitrary, leaving the spawn region (cols 7-8, rows 0-1)
// clear so a freshly spawned active block can be placed legally.
const colorArb: fc.Arbitrary<Color> = fc.constantFrom<Color>(0, 1);
const cellArb: fc.Arbitrary<Cell> = fc.oneof(
  { weight: 2, arbitrary: fc.constant<Cell>(0) },
  { weight: 2, arbitrary: fc.constant<Cell>(1) },
  { weight: 1, arbitrary: fc.constant<Cell>(null) },
);

const gridArb: fc.Arbitrary<Grid> = fc.array(
  fc.array(cellArb, { minLength: COLS, maxLength: COLS }),
  { minLength: ROWS, maxLength: ROWS },
);

const pieceArb: fc.Arbitrary<Piece> = fc.tuple(
  fc.tuple(colorArb, colorArb),
  fc.tuple(colorArb, colorArb),
);

/** Find every legal top-left placement for a 2x2 block on `grid`. */
function legalPlacements(grid: Grid): { row: number; col: number }[] {
  const spots: { row: number; col: number }[] = [];
  for (let row = 0; row <= ROWS - 2; row++) {
    for (let col = 0; col <= COLS - 2; col++) {
      const cells = [
        grid[row]?.[col],
        grid[row]?.[col + 1],
        grid[row + 1]?.[col],
        grid[row + 1]?.[col + 1],
      ];
      if (cells.every((c) => c == null)) {
        spots.push({ row, col });
      }
    }
  }
  return spots;
}

// --- Unit examples (Task 9.5) -------------------------------------------

describe("engine - unit examples", () => {
  it("same seed produces the same piece sequence via spawnRandom (Req 2.3)", () => {
    const drawSequence = (seedValue: number): Piece[] => {
      const engine = createEngine();
      engine.seed(seedValue);
      const seq: Piece[] = [];
      for (let i = 0; i < 5; i++) {
        engine.spawnRandom();
        const active = engine.getState().active;
        expect(active).not.toBeNull();
        if (active) {
          seq.push(active.piece);
          // Spawn always lands at the spawn position.
          expect(active.row).toBe(SPAWN_ROWS[0]);
          expect(active.col).toBe(SPAWN_COLS[0]);
        }
        // Hard-drop to lock the block and keep the spawn region clear.
        engine.hardDrop();
      }
      return seq;
    };

    expect(drawSequence(12345)).toEqual(drawSequence(12345));
  });

  it("seeded sequences match the pure RNG draw order", () => {
    const engine = createEngine();
    engine.seed(999);
    let rngState = engine.getState().rngState;
    for (let i = 0; i < 4; i++) {
      const expected = randomPiece(rngState);
      engine.spawnRandom();
      const active = engine.getState().active;
      expect(active).not.toBeNull();
      expect(active?.piece).toEqual(expected.piece);
      rngState = expected.rngState;
      // Clear the spawn region for the next draw by hard-dropping.
      engine.hardDrop();
    }
  });

  it("startNewGame resets score to 0 and clears the grid (Req 7.2, 9.3)", () => {
    const engine = createEngine();
    engine.spawnPiece([
      [0, 0],
      [0, 0],
    ]);
    engine.hardDrop();
    engine.fullSweep(); // may add score
    engine.startNewGame();
    const s = engine.getState();
    expect(s.score).toBe(0);
    expect(s.gameOver).toBe(false);
    expect(s.active).toBeNull();
    expect(occupiedCount(s.grid)).toBe(0);
    expect(s.sweepX).toBe(0);
  });

  it("startNewGame preserves a prior seed's rngState when no initial seed was given", () => {
    const engine = createEngine();
    engine.seed(42);
    const seeded = engine.getState().rngState;
    engine.startNewGame();
    expect(engine.getState().rngState).toBe(seeded);
  });

  it("createEngine(seed) reseeds to that seed on startNewGame", () => {
    const engine = createEngine(7);
    engine.seed(123); // override
    engine.startNewGame();
    const fresh = createEngine(7);
    expect(engine.getState().rngState).toBe(fresh.getState().rngState);
  });

  it("spawning into an occupied spawn region sets gameOver (Req 9.1)", () => {
    const engine = createEngine();
    // Stack identical blocks straight down the spawn columns until the spawn
    // region itself is occupied and the next spawn is blocked.
    let blocked = false;
    for (let i = 0; i < 6 && !blocked; i++) {
      engine.spawnPiece([
        [0, 0],
        [0, 0],
      ]);
      if (engine.getState().gameOver) {
        blocked = true;
        break;
      }
      engine.hardDrop();
    }
    expect(blocked).toBe(true);
    expect(engine.getState().gameOver).toBe(true);
  });

  it("sweepProgress advances sweepX and wraps after 16 columns (Req 6.2)", () => {
    const engine = createEngine();
    engine.sweepProgress(SWEEP_MS_PER_COL); // one column
    expect(engine.getState().sweepX).toBeCloseTo(1, 9);
    // Advance the remaining 15 columns + a touch to force a wrap.
    engine.sweepProgress(SWEEP_MS_PER_COL * COLS);
    expect(engine.getState().sweepX).toBeCloseTo(1, 6);
  });

  it("compositeGrid method matches the standalone helper", () => {
    const engine = createEngine();
    engine.spawnPiece([
      [0, 1],
      [1, 0],
    ]);
    expect(engine.compositeGrid()).toEqual(compositeGrid(engine.getState()));
  });
});

// --- Property tests ------------------------------------------------------

describe("engine - property tests", () => {
  // Feature: llmines, Property 15: Composite state grid reflects stack plus active block
  // Validates: Requirements 17.1, 17.2
  it("Property 15: compositeGrid equals the stack with the active block overlaid", () => {
    fc.assert(
      fc.property(
        gridArb,
        pieceArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (grid, piece, pick) => {
          const spots = legalPlacements(grid);
          const active: ActiveBlock | null =
            spots.length === 0
              ? null
              : {
                  piece,
                  ...spots[Math.min(spots.length - 1, Math.floor(pick * spots.length))]!,
                };
          const state = stateWith(grid, active);
          const composite = compositeGrid(state);

          // Correct dimensions, ordered [row][col].
          expect(composite.length).toBe(ROWS);
          for (const row of composite) {
            expect(row.length).toBe(COLS);
          }

          // The active footprint cells equal the block colours; every other
          // cell equals the settled stack.
          const overlay = new Map<string, Color>();
          if (active) {
            for (const { row, col, color } of blockCells(active)) {
              overlay.set(`${row},${col}`, color);
            }
          }
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              const key = `${r},${c}`;
              if (overlay.has(key)) {
                expect(composite[r]?.[c]).toBe(overlay.get(key));
              } else {
                expect(composite[r]?.[c] ?? null).toBe(grid[r]?.[c] ?? null);
              }
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: llmines, Property 17: Spawn while mid-fall locks the existing block first
  // Validates: Requirements 18.3, 18.4
  it("Property 17: spawn mid-fall locks the previous block then places a new one, deterministically", () => {
    fc.assert(
      fc.property(
        pieceArb,
        pieceArb,
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        (first, second, downSteps, leftMoves) => {
          const run = (): GameState => {
            const engine = createEngine();
            engine.spawnPiece(first);
            // Drop the first block clear of the spawn region (rows 0-1) so that
            // locking it does not block the next spawn.
            for (let i = 0; i < downSteps; i++) {
              engine.gravityStep();
            }
            for (let i = 0; i < leftMoves; i++) {
              engine.moveLeft();
            }
            const beforeActive = engine.getState().active;
            expect(beforeActive).not.toBeNull();
            engine.spawnPiece(second);
            return engine.getState();
          };

          const stateA = run();

          // The first block's cells are now settled in the stack.
          expect(occupiedCount(stateA.grid)).toBe(4);
          // A new active block exists at the spawn position.
          expect(stateA.gameOver).toBe(false);
          expect(stateA.active).not.toBeNull();
          expect(stateA.active?.row).toBe(SPAWN_ROWS[0]);
          expect(stateA.active?.col).toBe(SPAWN_COLS[0]);
          expect(stateA.active?.piece).toEqual(second);

          // Determinism: the same sequence on a second engine yields identical grids.
          const stateB = run();
          expect(stateB.grid).toEqual(stateA.grid);
          expect(stateB.active).toEqual(stateA.active);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: llmines, Property 18: Tick locks leave the field quiescent
  // Validates: Requirements 19.2
  it("Property 18: once a tick locks the active block, it stays null with no auto-spawn", () => {
    fc.assert(
      fc.property(pieceArb, (piece) => {
        const engine = createEngine();
        engine.spawnPiece(piece);
        // Drive gravity until the block locks (active becomes null).
        let locked = false;
        for (let i = 0; i < ROWS + 2; i++) {
          engine.gravityStep();
          if (engine.getState().active === null) {
            locked = true;
            break;
          }
        }
        expect(locked).toBe(true);
        // Further ticks never spawn a new block.
        for (let i = 0; i < 5; i++) {
          engine.gravityStep();
          expect(engine.getState().active).toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });
});
