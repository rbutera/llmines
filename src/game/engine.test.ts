import { describe, expect, it } from "vitest";

import { GRID_COLS, MS_PER_COL, SPAWN_COL } from "./constants";
import { detectSquares, GameEngine } from "./engine";
import type { Grid, Piece } from "./types";

const filledPiece = (color: 0 | 1): Piece => [
  [color, color],
  [color, color],
];

const lockAtFloor = (engine: GameEngine) => {
  for (let i = 0; i < 9; i++) engine.tick();
};

describe("GameEngine", () => {
  it("spawns a provided piece at the pinned top-center position", () => {
    const engine = new GameEngine({ autoSpawn: false });
    engine.spawn([
      [0, 1],
      [1, 0],
    ]);

    const state = engine.state();

    expect(state.grid[0]?.[SPAWN_COL]).toBe(0);
    expect(state.grid[0]?.[SPAWN_COL + 1]).toBe(1);
    expect(state.grid[1]?.[SPAWN_COL]).toBe(1);
    expect(state.grid[1]?.[SPAWN_COL + 1]).toBe(0);
  });

  it("moves, rotates, and locks a falling piece", () => {
    const engine = new GameEngine({ autoSpawn: false });
    engine.spawn([
      [0, 1],
      [1, 1],
    ]);

    expect(engine.move(-1)).toBe(true);
    expect(engine.rotate()).toBe(true);
    engine.hardDrop();

    const state = engine.state();

    expect(state.grid[8]?.[SPAWN_COL - 1]).toBe(1);
    expect(state.grid[8]?.[SPAWN_COL]).toBe(0);
    expect(state.grid[9]?.[SPAWN_COL - 1]).toBe(1);
    expect(state.grid[9]?.[SPAWN_COL]).toBe(1);
  });

  it("counts all aligned squares in larger monochrome regions", () => {
    const grid: Grid = Array.from({ length: 10 }, () =>
      Array.from({ length: 16 }, () => null),
    );

    for (let row = 2; row <= 4; row++) {
      for (let col = 5; col <= 7; col++) {
        grid[row]![col] = 0;
      }
    }

    const detected = detectSquares(grid);

    expect(detected.squares).toHaveLength(4);
    expect(detected.marked).toHaveLength(9);
  });

  it("clears a marked square, applies gravity, and scores with the pinned multiplier", () => {
    const engine = new GameEngine({ autoSpawn: false });

    engine.spawn(filledPiece(0));
    lockAtFloor(engine);
    engine.spawn([
      [1, 0],
      [1, 0],
    ]);
    for (let i = 0; i < 7; i++) engine.tick();

    expect(engine.marked()).toHaveLength(4);
    engine.sweepNow();

    const state = engine.state();

    expect(state.score).toBe(4);
    expect(state.grid[8]?.[SPAWN_COL]).toBe(1);
    expect(state.grid[9]?.[SPAWN_COL]).toBe(1);
    expect(state.grid[8]?.[SPAWN_COL + 1]).toBe(0);
    expect(state.grid[9]?.[SPAWN_COL + 1]).toBe(0);
  });

  it("does not auto-spawn after test-mode ticks lock a piece", () => {
    const engine = new GameEngine({ autoSpawn: false });

    engine.spawn(filledPiece(1));
    lockAtFloor(engine);

    const state = engine.snapshot();

    expect(state.active).toBeNull();
    expect(state.grid[0]?.[SPAWN_COL]).toBeNull();
  });

  it("advances the sweep at 0.25 seconds per column", () => {
    const engine = new GameEngine({ autoSpawn: false });

    engine.sweepProgress(MS_PER_COL);
    expect(engine.state().sweepX).toBeCloseTo(1);

    engine.sweepProgress(MS_PER_COL * (GRID_COLS - 1));
    expect(engine.state().sweepX).toBeCloseTo(0);
  });

  it("reports game over when spawn cells are occupied", () => {
    const engine = new GameEngine({ autoSpawn: false });

    engine.spawn(filledPiece(0));
    engine.spawn(filledPiece(1));

    expect(engine.state().gameOver).toBe(true);
  });
});
